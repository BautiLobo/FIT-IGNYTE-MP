import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// SOLO PARA DESARROLLO LOCAL. Simula lo que hace `wx-pay-webhook` cuando
// WeChat confirma un pago real (marca `payments.status='paid'` y llama a
// `complete-payment`), sin pasar por WeChat Pay de verdad -- para poder
// probar el flujo de renovación/alta sin cobrar plata real mientras se
// prueba en el simulador de WeChat DevTools.
//
// Apagado por default: si el secret ALLOW_PAYMENT_SIMULATION no está
// seteado a exactamente 'true' en Project Settings -> Edge Functions ->
// Secrets, esta función devuelve 403 sin tocar nada. Acordarse de
// DESACTIVAR ese secret (borrarlo o ponerlo en cualquier otro valor) antes
// de mandar la beta a testers reales -- mientras esté en 'true', cualquiera
// que sepa el out_trade_no de un pago 'pending' propio podría marcarlo
// pagado sin pagar. En 'draft'/producción normal no representa un agujero
// porque el secret no existe.
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

  const allowed = Deno.env.get('ALLOW_PAYMENT_SIMULATION') === 'true';
  if (!allowed) {
    return new Response(JSON.stringify({ error: 'Payment simulation is disabled' }), {
      status: 403,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  try {
    const { out_trade_no } = await req.json();
    if (!out_trade_no) {
      return new Response(JSON.stringify({ error: 'Missing out_trade_no' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const dbHeaders = {
      apikey: serviceKey!,
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
    };

    const payRes = await fetch(
      `${supabaseUrl}/rest/v1/payments?out_trade_no=eq.${encodeURIComponent(out_trade_no)}`,
      { headers: dbHeaders },
    );
    const payRows = await payRes.json();
    if (!payRows || payRows.length === 0) {
      return new Response(JSON.stringify({ error: 'Unknown out_trade_no' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Idempotente: si ya estaba paid (doble tap, reintento), no reprocesar
    // el PATCH -- pero igual llamamos a complete-payment, que también es
    // idempotente (ver `if (payment.applied) return alreadyApplied`).
    if (payRows[0].status !== 'paid') {
      await fetch(`${supabaseUrl}/rest/v1/payments?out_trade_no=eq.${encodeURIComponent(out_trade_no)}`, {
        method: 'PATCH',
        headers: dbHeaders,
        body: JSON.stringify({
          status: 'paid',
          wx_transaction_id: `SIMULATED_${Date.now()}`,
          paid_at: new Date().toISOString(),
        }),
      });
    }

    const completeRes = await fetch(`${supabaseUrl}/functions/v1/complete-payment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ out_trade_no }),
    });
    const completeData = await completeRes.json();

    return new Response(JSON.stringify({ ok: true, simulated: true, complete: completeData }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('dev-simulate-payment error:', err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
