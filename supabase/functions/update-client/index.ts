import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// Actualiza campos propios de un cliente (perfil + captura de openid) usando
// la service_role key del lado del servidor.
//
// Reemplaza los PATCH directos a /rest/v1/clients que hacia el mini-program
// con la anon key: esa tabla no tiene (ni debe tener) una policy de UPDATE
// abierta a anon, porque permitiria a cualquiera con la anon key (publica,
// esta en el bundle del mini-program) marcar CUALQUIER cliente como pagado,
// extender su expiry_date, o pisarle la direccion/telefono a otro.
//
// Esta funcion sólo permite tocar columnas de perfil no sensibles -- nunca
// paid, start_date, expiry_date, plan_id, status, referral_used, etc.
//
// Body esperado: { clientId: number, patch: { ...campos permitidos } }

const ALLOWED_FIELDS = ['wechat_openid', 'name', 'phone', 'access', 'allergies', 'goal'];

Deno.serve(async (req: Request) => {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  };

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { clientId, patch } = await req.json();
    if (!clientId || !patch || typeof patch !== 'object') {
      return new Response(JSON.stringify({ error: 'Missing clientId or patch' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const safePatch: Record<string, unknown> = {};
    for (const key of ALLOWED_FIELDS) {
      if (Object.prototype.hasOwnProperty.call(patch, key)) safePatch[key] = patch[key];
    }
    if (Object.keys(safePatch).length === 0) {
      return new Response(JSON.stringify({ error: 'No allowed fields in patch' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    const res = await fetch(`${supabaseUrl}/rest/v1/clients?id=eq.${clientId}`, {
      method: 'PATCH',
      headers: {
        apikey: serviceKey!,
        Authorization: `Bearer ${serviceKey}`,
        'Content-Type': 'application/json',
        Prefer: 'return=representation',
      },
      body: JSON.stringify(safePatch),
    });

    if (!res.ok) {
      const errBody = await res.text();
      return new Response(JSON.stringify({ error: `clients update failed: ${errBody}` }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const rows = await res.json();
    return new Response(JSON.stringify({ ok: true, client: rows[0] || null }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('update-client error:', err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
