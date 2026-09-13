import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// Crea un `new_orders` nuevo (alta de cliente, antes de aprobar/pagar) usando
// la service_role key del lado del servidor.
//
// El INSERT anonimo directo (insert_anon_new_orders, WITH CHECK status='draft')
// sigue funcionando a nivel RLS, pero el helper generico app.supabase() pide
// Prefer: return=representation -- y Postgres exige que el rol que inserta
// tambien pueda LEER la fila devuelta. Como select_auth_new_orders ahora es
// solo admin (is_admin()), ese INSERT+RETURNING con la anon key rompe con
// "new row violates row-level security policy", aunque el WITH CHECK en si
// sea valido. Esta funcion evita el problema por completo: usa service_role,
// no depende de ninguna policy para el RETURNING.
//
// Dedupe por wechat_openid: el chequeo de "ya tenes una cuenta" en register.js
// solo miraba la tabla `clients` -- pero esa fila recien existe despues de que
// el admin aprueba el pedido. Si alguien manda un pedido y todavia esta en
// draft/pending (sin aprobar), el mismo usuario de WeChat podia mandar OTRO
// pedido duplicado, porque `clients` seguia vacio para el. Ahora este chequeo
// vive aca, atomico con el insert, y cubre ese hueco.
//
// Body esperado: los mismos campos que antes se mandaban directo a POST
// /rest/v1/new_orders (name, phone, district, address, access, allergies,
// goal, plan_id, meals, wechat_openid, start_date, expiry_date, ...).
// El status siempre se fuerza a 'draft' del lado del servidor, se ignora
// cualquier status que venga en el body.

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
    if (!body || typeof body !== 'object') {
      return new Response(JSON.stringify({ error: 'Missing body' }), {
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

    if (body.wechat_openid) {
      const dupRes = await fetch(
        `${supabaseUrl}/rest/v1/new_orders?wechat_openid=eq.${encodeURIComponent(body.wechat_openid)}&status=in.(draft,pending)&select=id&limit=1`,
        { headers: dbHeaders },
      );
      const dupRows = await dupRes.json();
      if (dupRows && dupRows.length > 0) {
        return new Response(JSON.stringify({ ok: false, reason: 'duplicate_pending_order', existingOrderId: dupRows[0].id }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    const orderPayload = { ...body, status: 'draft' };

    const res = await fetch(`${supabaseUrl}/rest/v1/new_orders`, {
      method: 'POST',
      headers: { ...dbHeaders, Prefer: 'return=representation' },
      body: JSON.stringify(orderPayload),
    });

    if (!res.ok) {
      const errBody = await res.text();
      return new Response(JSON.stringify({ error: `new_orders insert failed: ${errBody}` }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const rows = await res.json();
    return new Response(JSON.stringify({ ok: true, order: rows[0] || null }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('create-order error:', err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
