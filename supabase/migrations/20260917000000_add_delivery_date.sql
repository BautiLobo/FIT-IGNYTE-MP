-- Fase 1 de la migracion al calendario de entregas (expand/contract).
--
-- Agrega meal_selections.delivery_date / pending_meal_selections.delivery_date
-- (fechas reales) al lado de la columna legacy `day` (nombre de dia de semana),
-- y mantiene las dos sincronizadas con triggers BEFORE, para que la version del
-- mini-program que esta hoy en la calle (que solo conoce `day`) y la version
-- nueva del calendario (que solo conoce `delivery_date`) puedan convivir sobre
-- las mismas filas mientras dure la transicion.
--
-- La etiqueta legacy nunca fue posicional: 'Monday' significaba el lunes
-- calendario real de la semana del ciclo del cliente, corriendose a la semana
-- siguiente cuando ese dia caia antes del start_date (ver getWeekIndexForDay en
-- app.js antes de este cambio). delivery_date_for_label reproduce exactamente
-- esa regla -- por eso el backfill es matematica de calendario pura y no
-- necesita la lista de feriados.
--
-- Nada de esto es destructivo: `day` conserva sus valores y su NOT NULL.
-- La Fase 5 borra `day` y estos triggers cuando ya no quede ningun cliente
-- corriendo la version vieja.

-- REVERSIBILIDAD (verificado en el ensayo del 2026-09-18, test 44/45):
-- el rollback (drop de los triggers, las constraints y las columnas) es
-- sin perdida SOLO mientras ningun cliente haya usado todavia el calendario
-- nuevo. Apenas exista un patron que `day` no sabe expresar -- dos entregas
-- el mismo dia de semana en semanas distintas, el caso "dos lunes" -- al
-- dropear delivery_date las dos filas colapsan en una sola fecha derivada y
-- el dato se pierde: re-aplicar esta migracion despues de eso ya falla en el
-- ADD CONSTRAINT por duplicado.
--
-- En la practica: reversible sin drama entre la Fase 1 y la publicacion del
-- mini-program nuevo. Despues de publicar, el rollback deja de ser una salida
-- limpia y hay que arreglar los duplicados a mano.
--
-- Esta migracion NO es re-corrible tal cual (el ADD CONSTRAINT no tiene
-- IF NOT EXISTS). El backfill por si solo si es idempotente por valor.

begin;

-- ── columnas nuevas ──────────────────────────────────────────────────────
alter table meal_selections
  add column if not exists delivery_date date;

alter table pending_meal_selections
  add column if not exists delivery_date date;

-- ── helpers de conversion (puros, sin tocar tablas) ──────────────────────

-- fecha -> etiqueta. CASE explicito en vez de to_char(d,'FMDay') para no
-- depender del lc_time del servidor.
create or replace function public.day_label_for_date(p_date date)
returns text
language sql
immutable
set search_path to 'public'
as $$
  select case extract(isodow from p_date)::int
    when 1 then 'Monday'
    when 2 then 'Tuesday'
    when 3 then 'Wednesday'
    when 4 then 'Thursday'
    when 5 then 'Friday'
    when 6 then 'Saturday'
    else 'Sunday'
  end
$$;

-- etiqueta + inicio de ciclo -> fecha real.
create or replace function public.delivery_date_for_label(p_start_date date, p_day text)
returns date
language plpgsql
immutable
set search_path to 'public'
as $$
declare
  v_dow int;
  v_date date;
begin
  if p_start_date is null or p_day is null then
    return null;
  end if;

  v_dow := case lower(btrim(p_day))
    when 'monday' then 1
    when 'tuesday' then 2
    when 'wednesday' then 3
    when 'thursday' then 4
    when 'friday' then 5
    else null
  end;

  if v_dow is null then
    return null;
  end if;

  -- lunes de la semana del start_date, + (n-1) dias
  v_date := p_start_date - (extract(isodow from p_start_date)::int - 1) + (v_dow - 1);

  -- si ese dia cae antes del inicio del ciclo, es el de la semana siguiente
  if v_date < p_start_date then
    v_date := v_date + 7;
  end if;

  return v_date;
end;
$$;

-- ── backfill (antes de crear los triggers, para no pisarse con ellos) ────

update meal_selections ms
set delivery_date = public.delivery_date_for_label(c.start_date, ms.day)
from clients c
where c.id = ms.client_id
  and ms.delivery_date is null;

-- pending_meal_selections es el ciclo SIGUIENTE, asi que su fecha base es la
-- del pago de renovacion, NO la del ciclo actual del cliente.
--
-- Ojo: en produccion pending_meal_selections.out_trade_no esta SIEMPRE en null
-- (ningun insert del mini-program ni de las Edge Functions lo setea: la columna
-- existe pero quedo muerta). Verificado el 2026-09-18: 35/35 filas con null.
-- Por eso el join por out_trade_no nunca matchea y hay que resolver el pago por
-- client_id (el pago cobrado que todavia no se aplico).
--
-- Cuando no hay pago pendiente -- el cliente edito comidas durante el gap de
-- renovacion pero todavia no pago -- la fecha del ciclo nuevo es genuinamente
-- desconocida y queda en NULL a proposito. NULL es el valor seguro: el UNIQUE
-- trata los NULL como distintos entre si, y apply_pending_renewals() re-deriva
-- la fecha desde `day` recien despues de haber actualizado clients.start_date
-- al ciclo nuevo, que es el unico momento en que el dato existe.
-- NUNCA caer a clients.start_date aca: da el ciclo actual, una semana temprano.
create or replace function public.pending_cycle_start(p_client_id integer, p_out_trade_no text)
returns date
language sql
stable
set search_path to 'public'
as $$
  select coalesce(
    (select pay.start_date from payments pay
      where p_out_trade_no is not null and pay.out_trade_no = p_out_trade_no),
    (select min(pay.start_date) from payments pay
      where pay.client_id = p_client_id
        and pay.status = 'paid'
        and pay.applied = false)
  )
$$;

update pending_meal_selections p
set delivery_date = public.delivery_date_for_label(
      public.pending_cycle_start(p.client_id, p.out_trade_no), p.day)
where p.delivery_date is null;

-- ── triggers de sincronizacion ──────────────────────────────────────────
-- Precedencia: si vino delivery_date (codigo nuevo) manda la fecha; si vino
-- solo `day` (codigo viejo) se deriva la fecha. Un UPDATE que no toca ninguna
-- de las dos no recalcula nada.

create or replace function public.sync_meal_selection_dates()
returns trigger
language plpgsql
set search_path to 'public'
as $$
declare
  v_start date;
begin
  if new.delivery_date is not null
     and (tg_op = 'INSERT' or new.delivery_date is distinct from old.delivery_date) then
    new.day := public.day_label_for_date(new.delivery_date);
    return new;
  end if;

  if new.day is not null
     and (tg_op = 'INSERT' or new.day is distinct from old.day) then
    select start_date into v_start from clients where id = new.client_id;
    new.delivery_date := public.delivery_date_for_label(v_start, new.day);
  end if;

  return new;
end;
$$;

create or replace function public.sync_pending_meal_selection_dates()
returns trigger
language plpgsql
set search_path to 'public'
as $$
declare
  v_start date;
begin
  if new.delivery_date is not null
     and (tg_op = 'INSERT' or new.delivery_date is distinct from old.delivery_date) then
    new.day := public.day_label_for_date(new.delivery_date);
    return new;
  end if;

  if new.day is not null
     and (tg_op = 'INSERT' or new.day is distinct from old.day) then
    -- misma regla que el backfill: el ciclo del pago pendiente, o NULL.
    v_start := public.pending_cycle_start(new.client_id, new.out_trade_no);

    new.delivery_date := public.delivery_date_for_label(v_start, new.day);
  end if;

  return new;
end;
$$;

drop trigger if exists sync_meal_selection_dates on meal_selections;
create trigger sync_meal_selection_dates
  before insert or update on meal_selections
  for each row execute function public.sync_meal_selection_dates();

drop trigger if exists sync_pending_meal_selection_dates on pending_meal_selections;
create trigger sync_pending_meal_selection_dates
  before insert or update on pending_meal_selections
  for each row execute function public.sync_pending_meal_selection_dates();

-- ── unicidad real sobre la fecha ────────────────────────────────────────
-- Nunca existio una constraint equivalente sobre (client_id, day, slot): la
-- unicidad la garantizaba el codigo a mano (GET y despues PATCH-o-POST),
-- mientras el panel admin ya asumia que existia via
-- upsert(..., {onConflict:"client_id,day,slot"}).
-- Las filas con delivery_date NULL (clientes sin start_date) no se ven
-- afectadas: en un UNIQUE los NULL cuentan como distintos entre si.

alter table meal_selections
  add constraint meal_selections_client_delivery_slot_key
  unique (client_id, delivery_date, slot);

alter table pending_meal_selections
  add constraint pending_meal_selections_client_delivery_slot_key
  unique (client_id, delivery_date, slot);

commit;
