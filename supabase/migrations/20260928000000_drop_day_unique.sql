-- Borra UNIQUE(client_id, day, slot) en meal_selections/pending_meal_selections.
--
-- Con ese indice, dos entregas el mismo dia de semana en semanas distintas
-- (el caso "dos lunes" que permite la app nueva) chocan: el trigger les pone
-- day = 'Monday' a las dos. La unicidad real ya la da
-- UNIQUE(client_id, delivery_date, slot) desde la Fase 1.
--
-- ORDEN: aplicar DESPUES de que el panel nuevo este en produccion -- el panel
-- viejo hace upsert con onConflict "client_id,day,slot" y sin este indice
-- falla al aprobar pedidos. Y ANTES de publicar el mini-program nuevo.
--
-- Rollback: volver a crearlo falla si ya existe algun "dos lunes".
-- En dev no existe (no-op).

alter table meal_selections drop constraint if exists meal_selections_client_id_day_slot_key;
alter table pending_meal_selections drop constraint if exists pending_meal_selections_client_id_day_slot_key;
