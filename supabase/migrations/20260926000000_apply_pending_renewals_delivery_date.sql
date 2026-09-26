-- Fase 2: apply_pending_renewals() escribe delivery_date explicito.
--
-- Requiere la Fase 1 (20260917000000_add_delivery_date.sql) ya aplicada.
-- En produccion el trigger sync_meal_selection_dates deriva `day` desde
-- delivery_date; si se insertara solo `day`, un patron "dos lunes" colapsaria
-- en una misma fecha y la renovacion fallaria contra el UNIQUE (test 35-38,
-- sesion 2026-09-18).
--
-- Tambien trae a produccion la rama que lee payments.selections (las comidas
-- elegidas al pagar), que hasta ahora existia solo en dev.

create or replace function public.apply_pending_renewals()
returns table(out_client_id integer, out_trade_no text, ok boolean, error_message text)
language plpgsql
set search_path to 'public'
as $function$
declare
  r record;
  v_error text;
begin
  for r in
    select * from payments
    where status = 'paid' and applied = false
      and start_date <= (now() at time zone 'Asia/Shanghai')::date
    order by paid_at
  loop
    begin
      update clients set
        plan_id = r.plan_id,
        start_date = r.start_date,
        expiry_date = r.expiry_date,
        status = 'Active',
        paid = true,
        ltv = coalesce(ltv, 0) + round(r.amount_fen / 100.0)::integer,
        cutlery = coalesce(r.cutlery, cutlery),
        referral_used = case when r.referral_code is not null and r.referral_code <> '' then true else referral_used end,
        referral_code_used = case when r.referral_code is not null and r.referral_code <> '' then r.referral_code else referral_code_used end
      where id = r.client_id;

      if r.selections is not null
         and jsonb_typeof(r.selections) = 'object'
         and r.selections <> '{}'::jsonb then
        delete from meal_selections where client_id = r.client_id;
        insert into meal_selections (client_id, delivery_date, slot, meals_json, delivery_time, note)
        select r.client_id,
               (coalesce(v->>'date', k))::date,
               coalesce(nullif(v->>'slot','')::int, 1),
               v->'meal_ids',
               coalesce(v->>'time', ''),
               coalesce(v->>'notes', '')
        from jsonb_each(r.selections) as t(k, v)
        where jsonb_typeof(v->'meal_ids') = 'array'
          and jsonb_array_length(v->'meal_ids') > 0
        on conflict (client_id, delivery_date, slot) do nothing;

        delete from pending_meal_selections where client_id = r.client_id;

      elsif exists (select 1 from pending_meal_selections where client_id = r.client_id) then
        -- Filas legacy con delivery_date NULL (editadas antes de existir el
        -- pago) se re-derivan aca, ya con clients.start_date del ciclo nuevo.
        -- Si una derivada choca con una fila con fecha explicita (mismo
        -- cliente escribiendo desde app vieja y nueva) gana la explicita: un
        -- conflicto no puede tirar abajo la renovacion entera.
        delete from meal_selections where client_id = r.client_id;
        insert into meal_selections (client_id, delivery_date, slot, meals_json, delivery_time, snack_id, note, sauce_ids)
        select client_id,
               coalesce(delivery_date, public.delivery_date_for_label(r.start_date, day)),
               slot, meals_json, delivery_time, snack_id, note, sauce_ids
        from pending_meal_selections where client_id = r.client_id
        order by delivery_date nulls last
        on conflict (client_id, delivery_date, slot) do nothing;
        delete from pending_meal_selections where client_id = r.client_id;
      end if;

      update payments set applied = true where id = r.id;

      insert into notifications (client_id, title, message)
      values (
        r.client_id,
        'Plan renewed',
        'Your renewal is confirmed and your new cycle has started today.'
      );

      out_client_id := r.client_id;
      out_trade_no := r.out_trade_no;
      ok := true;
      error_message := null;
      return next;
    exception when others then
      get stacked diagnostics v_error = message_text;
      out_client_id := r.client_id;
      out_trade_no := r.out_trade_no;
      ok := false;
      error_message := v_error;
      return next;
    end;
  end loop;
  return;
end;
$function$;

-- La version vieja del mini-program escribe pending_meal_selections (solo
-- `day`) antes de que el webhook marque el pago como 'paid', asi que
-- pending_cycle_start() todavia no encuentra el ciclo y delivery_date queda
-- NULL. Apenas el pago pasa a 'paid' la fecha ya se puede resolver: se
-- completa aca para que la app nueva pueda mostrar esas filas.
--
-- Nunca debe hacer fallar la escritura del pago: ante cualquier error deja
-- las filas en NULL, que apply_pending_renewals/complete-payment ya manejan.
create or replace function public.backfill_pending_dates_on_paid()
returns trigger
language plpgsql
set search_path to 'public'
as $$
begin
  if new.status = 'paid' and new.applied = false and new.start_date is not null
     and (tg_op = 'INSERT' or old.status is distinct from 'paid') then
    begin
      update pending_meal_selections
         set delivery_date = public.delivery_date_for_label(new.start_date, day)
       where client_id = new.client_id and delivery_date is null;
    exception when others then
      raise warning 'backfill_pending_dates_on_paid client %: %', new.client_id, sqlerrm;
    end;
  end if;
  return null;
end;
$$;

drop trigger if exists backfill_pending_dates_on_paid on payments;
create trigger backfill_pending_dates_on_paid
  after insert or update of status on payments
  for each row execute function public.backfill_pending_dates_on_paid();
