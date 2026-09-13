import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// Devuelve UNA fila de `new_orders` por id, usando la service_role key del
// lado del servidor -- igual que get-client, pero para new_orders.
//
// Reemplaza los GET directos a /rest/v1/new_orders que hacia el mini-program
// con la anon key: esa tabla no tiene (ni debe tener) SELECT abierto a anon,
// porque un GET sin filtro forzado por RLS deja leer TODOS los pedidos
// (nombre, telefono, direccion, alergias, objetivo) a cualquiera con la
// anon key (publica, esta en el bundle del mini-program).
//
// Body esperado: { orderId: number }

Deno.serve(async (req: Request) => {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  };

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { orderId } = await req.json();
    if (!orderId) {
      return new Response(JSON.stringify({ error: 'Missing orderId' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    const res = await fetch(`${supabaseUrl}/rest/v1/new_orders?id=eq.${orderId}`, {
      headers: { apikey: serviceKey!, Authorization: `Bearer ${serviceKey}` },
    });
    const rows = await res.json();

    return new Response(JSON.stringify(rows), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('get-order error:', err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
