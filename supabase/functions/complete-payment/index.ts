import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// Marca el pago de un cliente (renovacion o cliente nuevo) usando la
// service_role key del lado del servidor.
//
// Antes esta funcion confiaba ciegamente en el clientId/status/fechas que
// mandaba quien la llamaba -- como no requiere JWT (verify_jwt=false, igual
// que el resto de las funciones de este proyecto), cualquiera que conociera
// la URL podia invocarla directo y activar CUALQUIER cliente como pagado sin
// pasar por WeChat Pay. Ahora exige un out_trade_no de un pago que la tabla
// `payments` ya tenga marcado status='paid' (eso solo lo hace wx-pay-webhook,
// despues de desencriptar la notificacion real de WeChat Pay con la API v3
// Key), y toma clientId/plan/fechas/etc. de esa fila -- nunca del body.
//
// Renovacion anticipada (ver RENEWAL_PLAN.md): si el pago es una renovacion
// y el plan ACTUAL del cliente (el de antes de este pago) todavia no vencio,
// no se pisa `clients` en el momento del pago -- se deja la fila de
// `payments` marcada `paid` con `applied=false`, y el cron diario la aplica
// el dia que arranca el ciclo nuevo. Para pagos que no caen en ese caso
// (plan ya vencido, o alta nueva) se aplica todo de inmediato.
//
// LAS COMIDAS VIAJAN EN LA FILA DE `payments` (columna `selections`, la
// escribe create-payment). Antes las escribia el mini-program por su cuenta,
// DESPUES de que el pago se confirmaba -- o sea despues de que esta funcion
// ya habia aplicado el ciclo nuevo. En esa ventana el cliente quedaba con el
// plan nuevo y las comidas del viejo, y si ahi se cortaba la señal quedaba
// asi para siempre. Ahora plan y comidas se escriben en el mismo paso, desde
// la misma fuente, asi que ese desfase no puede existir -- por eso tampoco
// hace falta el registro en meal_plan_alerts que tenia esta funcion.
//
// Body esperado: { out_trade_no: string }

type Sel = {
  meal_ids?: unknown;
  time?: unknown;
  notes?: unknown;
  date?: unknown;
  slot?: unknown;
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

// Convierte el objeto `selections` del pago en filas para meal_selections /
// pending_meal_selections. Descarta lo que no tenga comidas o no tenga una
// fecha valida: mejor escribir de menos que escribir basura.
function selectionsToRows(clientId: number, selections: unknown): Record<string, unknown>[] {
  if (!selections || typeof selections !== 'object') return [];
  const rows: Record<string, unknown>[] = [];
  for (const [key, raw] of Object.entries(selections as Record<string, Sel>)) {
    const sel = raw || {};
    if (!Array.isArray(sel.meal_ids) || sel.meal_ids.length === 0) continue;
    const day = typeof sel.date === 'string' && sel.date ? sel.date : key;
    if (!ISO_DATE.test(day)) continue;
    rows.push({
      client_id: clientId,
      delivery_date: day,
      slot: Number.isInteger(sel.slot) ? sel.slot : 1,
      meals_json: sel.meal_ids,
      delivery_time: typeof sel.time === 'string' ? sel.time : '',
      note: typeof sel.notes === 'string' ? sel.notes : '',
    });
  }
  return rows;
}

Deno.serve(async (req: Request) => {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  };

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const { out_trade_no } = body;

    if (!out_trade_no) {
      return new Response(JSON.stringify({ error: 'Missing out_trade_no' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const baseHeaders = {
      apikey: serviceKey!,
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    };
    const noReturnHeaders = {
      apikey: serviceKey!,
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
    };
    // Mismo criterio que apply_pending_renewals(): un duplicado de
    // (client_id, delivery_date, slot) se descarta en vez de tirar abajo el
    // insert entero y dejar al cliente sin comidas.
    const mealInsertUrl = `${supabaseUrl}/rest/v1/meal_selections?on_conflict=client_id,delivery_date,slot`;
    const mealInsertHeaders = { ...noReturnHeaders, Prefer: 'resolution=ignore-duplicates' };

    // La unica fuente de verdad: una fila de `payments` que wx-pay-webhook ya
    // marco como pagada tras validar la notificacion real de WeChat Pay.
    const payRes = await fetch(
      `${supabaseUrl}/rest/v1/payments?out_trade_no=eq.${encodeURIComponent(out_trade_no)}`,
      { headers: baseHeaders },
    );
    const payRows = await payRes.json();
    if (!payRows || payRows.length === 0) {
      return new Response(JSON.stringify({ error: 'Unknown out_trade_no' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const payment = payRows[0];
    if (payment.status !== 'paid') {
      return new Response(JSON.stringify({ error: 'Payment not confirmed yet' }), {
        status: 409,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { type, client_id: clientId, pending_order_id: pendingOrderId, plan_id, start_date, expiry_date, cutlery, referral_code: referralCode, client_status: status, selections } = payment;

    // Ya se aplico (por este mismo llamado antes, o por el cron mas
    // adelante) -- responder ok sin volver a tocar nada (idempotente).
    if (payment.applied) {
      return new Response(JSON.stringify({ ok: true, alreadyApplied: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const mealRows = selectionsToRows(clientId, selections);

    // Se necesita el ltv actual del cliente para poder incrementarlo (ver
    // clientPayload mas abajo) -- se aprovecha el mismo fetch para el
    // chequeo de renovacion anticipada (expiry_date).
    const currentClientRes = await fetch(
      `${supabaseUrl}/rest/v1/clients?id=eq.${clientId}&select=expiry_date,ltv`,
      { headers: baseHeaders },
    );
    const currentClientRows = await currentClientRes.json();
    const currentClient = currentClientRows?.[0];

    // Renovacion anticipada: mirar el plan ACTUAL del cliente (antes de este
    // pago) para decidir si hay que diferir la aplicacion.
    let deferApply = false;
    if (type === 'renewal' && currentClient?.expiry_date) {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const currentExpiryDate = new Date(currentClient.expiry_date + 'T00:00:00');
      deferApply = today <= currentExpiryDate;
    }

    if (deferApply) {
      // No tocar `clients` ni `meal_selections` todavia -- el ciclo viejo
      // sigue corriendo y la cocina lo esta preparando. El cron aplica el
      // pago el dia que arranca `start_date`.
      //
      // Pero SI se dejan las comidas elegidas en pending_meal_selections: es
      // lo que muestra Home durante el hueco entre ciclos, y de donde sale el
      // reparto del panel admin si el cron todavia no corrio.
      if (mealRows.length > 0) {
        await fetch(
          `${supabaseUrl}/rest/v1/pending_meal_selections?client_id=eq.${clientId}`,
          { method: 'DELETE', headers: noReturnHeaders },
        );
        const insPendRes = await fetch(
          `${supabaseUrl}/rest/v1/pending_meal_selections`,
          { method: 'POST', headers: noReturnHeaders, body: JSON.stringify(mealRows) },
        );
        if (!insPendRes.ok) {
          const errBody = await insPendRes.text();
          return new Response(JSON.stringify({ error: `pending_meal_selections insert failed: ${errBody}` }), {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
      }

      return new Response(JSON.stringify({ ok: true, deferred: true, applyDate: start_date }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // pendingOrderId falta cuando el pago es de un cliente que YA existe en
    // `clients` (aprobado, Pending Payment) pero llega a pagar sin una
    // `new_orders` asociada en este dispositivo -- ver payment.js/
    // order-summary.js (camino "repay" sin orden: se re-registra por
    // openid, o vuelve a elegir fecha/comidas porque la vieja quedó
    // vencida). Antes esto exigia pendingOrderId siempre para type==='new'
    // y cortaba ahi con error 500 -- el pago quedaba 'paid' pero
    // applied=false para siempre (nada lo reintenta: apply_pending_renewals
    // solo corre para fechas ya vencidas, y esta nunca lo estaria si el
    // cliente nunca vuelve a intentar). El cliente pagaba de verdad y jamas
    // recibia su plan. Si no hay pendingOrderId, no hay nada que marcar en
    // new_orders -- se sigue de largo y se aplica igual el resto (clients +
    // meal_selections, mas abajo).
    if (type === 'new' && pendingOrderId) {
      const orderPayload: Record<string, unknown> = { status: 'paid' };
      if (referralCode) orderPayload.referral_code = referralCode;

      const orderRes = await fetch(
        `${supabaseUrl}/rest/v1/new_orders?id=eq.${pendingOrderId}`,
        { method: 'PATCH', headers: baseHeaders, body: JSON.stringify(orderPayload) }
      );
      if (!orderRes.ok) {
        const errBody = await orderRes.text();
        return new Response(JSON.stringify({ error: `new_orders update failed: ${errBody}` }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    // LTV: suma lo que este pago realmente cobro (amount_fen esta en fen,
    // 1/100 de yuan) al total historico que ya tenia el cliente.
    const paidYuan = Math.round((payment.amount_fen || 0) / 100);

    const clientPayload: Record<string, unknown> = {
      status, start_date, expiry_date, paid: true,
      ltv: (currentClient?.ltv || 0) + paidYuan,
    };
    if (plan_id) clientPayload.plan_id = plan_id;
    if (cutlery !== undefined) clientPayload.cutlery = cutlery;
    if (referralCode) {
      clientPayload.referral_used = true;
      clientPayload.referral_code_used = referralCode;
    }

    const clientRes = await fetch(
      `${supabaseUrl}/rest/v1/clients?id=eq.${clientId}`,
      { method: 'PATCH', headers: baseHeaders, body: JSON.stringify(clientPayload) }
    );

    if (!clientRes.ok) {
      const errBody = await clientRes.text();
      return new Response(JSON.stringify({ error: `clients update failed: ${errBody}` }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const updatedRows = await clientRes.json();
    if (!updatedRows || updatedRows.length === 0) {
      return new Response(JSON.stringify({ error: `No client row matched id=${clientId}` }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Las comidas del ciclo que se acaba de aplicar, escritas en el mismo
    // paso que el plan. Reemplazan el set completo del cliente.
    if (mealRows.length > 0) {
      await fetch(
        `${supabaseUrl}/rest/v1/meal_selections?client_id=eq.${clientId}`,
        { method: 'DELETE', headers: noReturnHeaders },
      );
      const insRes = await fetch(
        mealInsertUrl,
        { method: 'POST', headers: mealInsertHeaders, body: JSON.stringify(mealRows) },
      );
      if (!insRes.ok) {
        const errBody = await insRes.text();
        return new Response(JSON.stringify({ error: `meal_selections insert failed: ${errBody}` }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      // Lo que hubiera quedado en pendientes es de este mismo ciclo y ya no
      // corresponde.
      await fetch(
        `${supabaseUrl}/rest/v1/pending_meal_selections?client_id=eq.${clientId}`,
        { method: 'DELETE', headers: noReturnHeaders },
      );
    } else {
      // Fallback para pagos creados antes de que las comidas viajaran en la
      // fila (`selections` nulo): migrar lo que haya en pendientes.
      const pendingRes = await fetch(
        `${supabaseUrl}/rest/v1/pending_meal_selections?client_id=eq.${clientId}`,
        { headers: baseHeaders },
      );
      const pendingRows = await pendingRes.json();
      if (pendingRows && pendingRows.length > 0) {
        await fetch(
          `${supabaseUrl}/rest/v1/meal_selections?client_id=eq.${clientId}`,
          { method: 'DELETE', headers: noReturnHeaders },
        );
        // Las filas con fecha explicita primero: ante un duplicado, gana esa.
        const ordered = [...pendingRows].sort((a: Record<string, unknown>, b: Record<string, unknown>) =>
          (a.delivery_date ? 0 : 1) - (b.delivery_date ? 0 : 1));
        const newSelections = ordered.map((r: Record<string, unknown>) => ({
          client_id: r.client_id,
          // delivery_date NULL = fila legacy: el trigger la re-deriva desde
          // `day` con el start_date que se acaba de escribir arriba.
          delivery_date: r.delivery_date,
          day: r.day,
          slot: r.slot,
          meals_json: r.meals_json,
          delivery_time: r.delivery_time,
          snack_id: r.snack_id,
          note: r.note,
          sauce_ids: r.sauce_ids,
        }));
        const fbRes = await fetch(
          mealInsertUrl,
          { method: 'POST', headers: mealInsertHeaders, body: JSON.stringify(newSelections) },
        );
        if (!fbRes.ok) {
          // No cortar: el pago y el plan ya quedaron aplicados. Las
          // pendientes se conservan (no se borran abajo) para rescate manual.
          console.error('complete-payment: fallback meal_selections insert failed:', await fbRes.text());
        } else {
          await fetch(
            `${supabaseUrl}/rest/v1/pending_meal_selections?client_id=eq.${clientId}`,
            { method: 'DELETE', headers: noReturnHeaders },
          );
        }
      }
    }

    // Marcar la fila de payments como aplicada -- misma logica que usa el
    // cron para las renovaciones anticipadas, asi `applied` siempre refleja
    // si `clients` ya quedo al dia con este pago.
    await fetch(
      `${supabaseUrl}/rest/v1/payments?out_trade_no=eq.${encodeURIComponent(out_trade_no)}`,
      { method: 'PATCH', headers: noReturnHeaders, body: JSON.stringify({ applied: true }) }
    );

    return new Response(JSON.stringify({ ok: true, client: updatedRows[0] }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('complete-payment error:', err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
