import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// Actualiza campos de un `new_orders` propio (datos personales, comidas,
// o pasar a status 'pending' al confirmar) usando la service_role key del
// lado del servidor.
//
// Reemplaza los PATCH directos a /rest/v1/new_orders que hacia el
// mini-program con la anon key: dejaba a cualquiera con esa key (publica)
// editar CUALQUIER pedido, de cualquier cliente.
//
// Nunca permite pasar status a 'approved' / 'rejected' / 'paid' -- esas
// transiciones son exclusivas del panel de admin y de complete-payment.
//
// Body esperado: { orderId: number, patch: { ...campos permitidos } }

const ALLOWED_FIELDS = [
  'name', 'phone', 'district', 'address', 'access', 'allergies', 'goal',
  'plan_id', 'start_date', 'expiry_date', 'meals', 'status',
];
const BLOCKED_STATUS = ['approved', 'rejected', 'paid'];

Deno.serve(async (req: Request) => {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  };

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { orderId, patch } = await req.json();
    if (!orderId || !patch || typeof patch !== 'object') {
      return new Response(JSON.stringify({ error: 'Missing orderId or patch' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (patch.status && BLOCKED_STATUS.includes(patch.status)) {
      return new Response(JSON.stringify({ error: `status "${patch.status}" not allowed here` }), {
        status: 403,
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

    const res = await fetch(`${supabaseUrl}/rest/v1/new_orders?id=eq.${orderId}`, {
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
      return new Response(JSON.stringify({ error: `new_orders update failed: ${errBody}` }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const rows = await res.json();

    // Orden pasa a 'pending' -- el cliente acaba de tocar "Place Order" y ahora
    // le toca revisarla al admin. Best-effort: nunca debe romper la respuesta
    // al mini-program si el push falla (VAPID sin configurar, etc.).
    if (safePatch.status === 'pending') {
      try {
        await fetch(`${supabaseUrl}/functions/v1/send-order-push`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ orderId }),
        });
      } catch (pushErr) {
        console.error('send-order-push call failed:', pushErr);
      }
    }

    return new Response(JSON.stringify({ ok: true, order: rows[0] || null }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('update-order error:', err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
