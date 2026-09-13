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
// `payments` marcada `paid` con `applied=false`, y un cron diario (a
// implementar) la aplica el dia que arranca el ciclo nuevo. Para pagos que
// no caen en ese caso (plan ya vencido, o alta nueva) el comportamiento es
// exactamente el de antes: se aplica todo de inmediato.
//
// Body esperado: { out_trade_no: string }

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

    const { type, client_id: clientId, pending_order_id: pendingOrderId, plan_id, start_date, expiry_date, cutlery, referral_code: referralCode, client_status: status } = payment;

    // Ya se aplico (por este mismo llamado antes, o por el cron mas
    // adelante) -- responder ok sin volver a tocar nada (idempotente).
    if (payment.applied) {
      return new Response(JSON.stringify({ ok: true, alreadyApplied: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Se necesita el ltv actual del cliente para poder incrementarlo (ver
    // clientPayload mas abajo) -- se aprovecha el mismo fetch para el
    // chequeo de renovacion anticipada (expiry_date), que antes solo se
    // hacia para type==='renewal'.
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
      // No tocar `clients` ni `meal_selections` todavia -- el pago ya quedo
      // registrado como `paid` en `payments`, que alcanza como fuente de
      // verdad. El cron diario lo aplica el dia que arranca `start_date` y
      // marca `applied=true` (y ahi tambien incrementa `ltv`, ver
      // apply_pending_renewals()).
      return new Response(JSON.stringify({ ok: true, deferred: true, applyDate: start_date }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (type === 'new') {
      if (!pendingOrderId) {
        return new Response(JSON.stringify({ error: 'Missing pendingOrderId on payment' }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

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
    // 1/100 de yuan) al total historico que ya tenia el cliente. No existia
    // ningun lugar que tocara esta columna -- quedaba en 0 para siempre.
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

    // Marcar la fila de payments como aplicada -- misma logica que usara el
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
