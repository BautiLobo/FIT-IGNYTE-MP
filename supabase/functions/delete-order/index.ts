import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// Borra una fila de `new_orders` por id, usando la service_role key del
// lado del servidor -- mismo motivo que get-order/update-order: esa tabla
// no tiene (ni debe tener) DELETE abierto a anon.
//
// Se usa desde pages/rejected/index.js y pages/payment/index.js (ambos
// "Start over"): el usuario abandona un pedido (rechazado, o ya aprobado
// pero todavia sin pagar) y vuelve a discovery para empezar de cero, en vez
// de corregir y reenviar el mismo pedido a revision.
//
// Solo borra si el status actual es 'draft', 'rejected' o 'approved' --
// nunca deja borrar un pedido 'pending' (todavia en revision del admin) ni
// 'paid' por mas que alguien mande ese orderId, mismo criterio defensivo
// que BLOCKED_STATUS en update-order. 'approved' se agrega a proposito: el
// mini-program llega a payment.js con la orden ya en approved, y el cliente
// puede arrepentirse ahi antes de pagar -- borrar el pedido en ese caso NO
// borra al cliente que approveOrder ya creo en `clients` (tablas
// independientes), pero saca el pedido de Orders -> Approved en el panel
// admin para no dejarlo dando vueltas ahi.
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

    const res = await fetch(
      `${supabaseUrl}/rest/v1/new_orders?id=eq.${orderId}&status=in.(draft,rejected,approved)`,
      {
        method: 'DELETE',
        headers: {
          apikey: serviceKey!,
          Authorization: `Bearer ${serviceKey}`,
          Prefer: 'return=representation',
        },
      },
    );

    if (!res.ok) {
      const errBody = await res.text();
      return new Response(JSON.stringify({ error: `new_orders delete failed: ${errBody}` }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const rows = await res.json();
    if (!rows || rows.length === 0) {
      // No existia, o su status no era draft/rejected/approved -- no es un
      // error de red, pero el caller (rejected.js / payment.js) igual debe
      // seguir adelante y limpiar el storage local, para no dejar al
      // usuario trabado.
      return new Response(JSON.stringify({ ok: false, reason: 'not_found_or_not_deletable' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('delete-order error:', err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
