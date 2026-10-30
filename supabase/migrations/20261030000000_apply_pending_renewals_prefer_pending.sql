-- apply_pending_renewals(): el ciclo que arranca sale de pending_meal_selections
-- cuando esta completo, y de payments.selections solo como respaldo.
--
-- Parte de la definicion que corre en prod (2026-10-30), NO de
-- 20260926000000: prod ya copiaba cook_time en la rama de pendientes.
--
-- Antes, si el pago traia `selections`, el cron copiaba eso e ignoraba los
-- pendientes. Pero pending_meal_selections es lo que el cliente ve y edita
-- (Home, edit-meals) y donde el staff carga el cooking time del proximo
-- ciclo (panel: updatePendingCookTime). Resultado: las ediciones hechas
-- antes del arranque se perdian (cliente #422, 2026-10-28) y el cooking
-- time del staff tambien, en todas las renovaciones con `selections`.
--
-- Por que es seguro preferir los pendientes: complete-payment, al cobrar una
-- renovacion diferida, reescribe pending_meal_selections desde
-- payments.selections, asi que desde ese momento arrancan iguales. Despues
-- solo los tocan save-meal-selections (que tambien actualiza el pago) y el
-- cooking time del panel. La condicion `>=` deja el respaldo para un
-- pendiente incompleto (un guardado viejo que borro un dia): ahi se aplica
-- el pago completo en vez de un ciclo con menos entregas.

create or replace function public.apply_pending_renewals()
returns table(out_client_id integer, out_trade_no text, ok boolean, error_message text)
language plpgsql
set search_path to 'public'
as $function$
declare
  r record;
  v_error text;
  v_sel_count integer;
  v_pend_count integer;
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

      v_sel_count := 0;
      if r.selections is not null and jsonb_typeof(r.selections) = 'object' then
        select count(*) into v_sel_count
        from jsonb_each(r.selections) as t(k, v)
        where jsonb_typeof(v->'meal_ids') = 'array'
          and jsonb_array_length(v->'meal_ids') > 0;
      end if;

      select count(*) into v_pend_count
      from pending_meal_selections where client_id = r.client_id;

      if v_pend_count > 0 and v_pend_count >= v_sel_count then
        -- Filas legacy con delivery_date NULL (editadas antes de existir el
        -- pago) se re-derivan aca, ya con clients.start_date del ciclo nuevo.
        -- Si una derivada choca con una fila con fecha explicita gana la
        -- explicita: un conflicto no puede tirar abajo la renovacion entera.
        delete from meal_selections where client_id = r.client_id;
        insert into meal_selections (client_id, delivery_date, slot, meals_json, delivery_time, cook_time, snack_id, note, sauce_ids)
        select client_id,
               coalesce(delivery_date, public.delivery_date_for_label(r.start_date, day)),
               slot, meals_json, delivery_time, coalesce(cook_time, ''), snack_id, note, sauce_ids
        from pending_meal_selections where client_id = r.client_id
        order by delivery_date nulls last
        on conflict (client_id, delivery_date, slot) do nothing;
        delete from pending_meal_selections where client_id = r.client_id;

      elsif v_sel_count > 0 then
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
