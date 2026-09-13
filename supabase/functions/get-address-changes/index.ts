import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// Devuelve el historial de address_changes de un cliente (mas reciente primero),
// usando la service_role key del lado del servidor.
//
// Reemplaza el GET directo a /rest/v1/address_changes que hacia el mini-program
// con la anon key: esa tabla no tiene (ni debe tener) SELECT abierto a anon,
// porque dejaba leer las direcciones (vieja y nueva) de CUALQUIER cliente a
// cualquiera con la anon key (publica, va en el bundle del mini-program).
//
// Body esperado: { clientId: number }

Deno.serve(async (req: Request) => {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  };

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { clientId } = await req.json();
    if (!clientId) {
      return new Response(JSON.stringify({ error: 'Missing clientId' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    const res = await fetch(
      `${supabaseUrl}/rest/v1/address_changes?client_id=eq.${clientId}&order=created_at.desc`,
      { headers: { apikey: serviceKey!, Authorization: `Bearer ${serviceKey}` } }
    );
    const rows = await res.json();

    return new Response(JSON.stringify(rows), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('get-address-changes error:', err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
