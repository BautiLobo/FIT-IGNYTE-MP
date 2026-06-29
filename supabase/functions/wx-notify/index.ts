import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// Devuelve UNA fila de `clients` por id o por phone, usando la service_role key
// del lado del servidor — el mini-program nunca recibe esa key.
// Esto reemplaza los GET directos a /rest/v1/clients que hacía el mini-program
// con la anon key, que (con RLS abierto a SELECT) permitían leer la tabla entera.
//
// Body esperado: { clientId?: number, phone?: string } — al menos uno de los dos.

Deno.serve(async (req: Request) => {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  };

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { clientId, phone } = await req.json();
    if (!clientId && !phone) {
      return new Response(JSON.stringify({ error: 'Missing clientId or phone' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    const filter = clientId ? `id=eq.${clientId}` : `phone=eq.${encodeURIComponent(phone)}`;
    const res = await fetch(
      `${supabaseUrl}/rest/v1/clients?${filter}`,
      { headers: { apikey: serviceKey!, Authorization: `Bearer ${serviceKey}` } }
    );
    const rows = await res.json();

    return new Response(JSON.stringify(rows), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('get-client error:', err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
