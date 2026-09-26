-- Re-deriva delivery_date cuando cambia clients.start_date.
--
-- Con la version vieja del mini-program las comidas se escriben al APROBAR el
-- pedido (solo `day`), cuando clients.start_date todavia es provisorio (la
-- fecha de aprobacion). sync_meal_selection_dates deriva delivery_date desde
-- ese valor, y cuando el pago escribe el start_date real nadie lo recalcula:
-- la app vieja no se entera (lee `day`), pero todo lo que lee delivery_date
-- (panel, app nueva) ve al cliente en la semana equivocada.
--
-- Solo se tocan las filas cuya fecha coincide con la derivada del start_date
-- VIEJO: esas son las que salieron de una etiqueta. Una fecha explicita de la
-- app nueva que no calza con esa formula queda intacta.
--
-- Si el recalculo choca contra el UNIQUE, se deja todo como estaba: nunca
-- puede hacer fallar el UPDATE de clients (lo usan pagos y renovaciones).

create or replace function public.resync_delivery_dates_on_start_change()
returns trigger
language plpgsql
set search_path to 'public'
as $$
begin
  if new.start_date is not distinct from old.start_date then
    return null;
  end if;
  begin
    update meal_selections ms
       set delivery_date = public.delivery_date_for_label(new.start_date, ms.day)
     where ms.client_id = new.id
       and ms.delivery_date is not distinct from public.delivery_date_for_label(old.start_date, ms.day);
  exception when others then
    raise warning 'resync_delivery_dates_on_start_change client %: %', new.id, sqlerrm;
  end;
  return null;
end;
$$;

drop trigger if exists resync_delivery_dates_on_start_change on clients;
create trigger resync_delivery_dates_on_start_change
  after update of start_date on clients
  for each row execute function public.resync_delivery_dates_on_start_change();

-- Recalculo unico de lo que se haya desfasado entre la Fase 1 y este trigger
-- (0 filas al 2026-09-27). Seguro SOLO mientras la app nueva no este
-- publicada: hasta entonces toda fila de prod sale de una etiqueta. Despues
-- de publicar, esto pisaria fechas explicitas -- no re-correr. Por la misma
-- razon NO se aplico en dev (ahi ya hay fechas explicitas de la app nueva):
-- en dev solo existe la funcion + el trigger de arriba.
update meal_selections ms
   set delivery_date = public.delivery_date_for_label(c.start_date, ms.day)
  from clients c
 where c.id = ms.client_id
   and ms.delivery_date is distinct from public.delivery_date_for_label(c.start_date, ms.day);
