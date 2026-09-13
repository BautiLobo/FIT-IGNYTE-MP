import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// Chequeo liviano del estado de un pago, usando la service_role key del
// lado del servidor. Existe para que el mini-program pueda confirmar que
// un pago se proceso sin depender de `clients.paid` -- necesario para
// renovaciones anticipadas (ver RENEWAL_PLAN.md), donde `complete-payment`
// deja `clients` sin tocar hasta que el cron diario lo aplica el dia que
// corresponde. No expone nada de PII, solo `status`/`applied` de la fila
// de `payments`.
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
    const { out_trade_no } = await req.json();
    if (!out_trade_no) {
      return new Response(JSON.stringify({ error: 'Missing out_trade_no' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    const res = await fetch(
      `${supabaseUrl}/rest/v1/payments?out_trade_no=eq.${encodeURIComponent(out_trade_no)}&select=status,applied`,
      { headers: { apikey: serviceKey!, Authorization: `Bearer ${serviceKey}` } },
    );
    const rows = await res.json();
    if (!rows || rows.length === 0) {
      return new Response(JSON.stringify({ error: 'Unknown out_trade_no' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify(rows[0]), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('get-payment-status error:', err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
