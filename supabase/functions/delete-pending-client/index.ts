import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// Borra una fila de `clients` por id, usando la service_role key del lado
// del servidor -- mismo motivo que delete-order: esa tabla no tiene (ni debe
// tener) DELETE abierto a anon.
//
// Se usa desde "Start over" en pages/rejected/index.js y
// pages/payment/index.js: approveOrder (panel admin) crea la fila en
// `clients` apenas se aprueba un pedido, ANTES de que el cliente pague. Si
// el cliente se arrepiente ahi y aprieta "Start over", borrar solo la orden
// (delete-order) no alcanza -- la fila de `clients` sigue existiendo, y
// register.js/discovery.js la encuentran despues por openid/clientId y lo
// dejan trabado para siempre en "ya tenes cuenta", sin forma de volver a
// registrarse desde la app.
//
// Solo borra si el status actual es 'Pending Payment' -- nunca deja borrar
// un cliente que ya pago (Active/Upcoming/Inactive/etc.), por mas que
// alguien mande ese clientId. Mismo criterio defensivo que delete-order.
//
// `address_changes`, `meal_selections`, `notifications` y
// `pending_meal_selections` tienen ON DELETE CASCADE hacia `clients.id`, asi
// que se limpian solas. `payments.client_id` NO tiene FK (columna suelta,
// sin CASCADE) -- si el cliente llego a intentar pagar y abandono antes de
// que el webhook confirmara, quedaria una fila huerfana ahi, asi que se
// borra aparte, despues de borrar el cliente. Como solo se permite borrar
// clientes en 'Pending Payment' (nunca pagaron de verdad), no hace falta
// filtrar por status: ningun pago de este cliente pudo haber quedado
// 'paid'+applied, o el cliente ya no estaria en 'Pending Payment'.
//
// Solo el dueño puede borrar: el body trae un código fresco de wx.login, el
// openid se resuelve ACA contra WeChat (jscode2session, igual que wx-login)
// y el DELETE exige que coincida con clients.wechat_openid. Sin esto,
// cualquiera con la anon key podía borrar cualquier cliente en 'Pending
// Payment' probando ids. Un cliente sin wechat_openid guardado no se puede
// borrar por acá.
//
// Body esperado: { clientId: number, code: string }

Deno.serve(async (req: Request) => {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  };
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const code = body.code;
    // Puede llegar como texto desde el storage del mini-program.
    const clientId = Number(body.clientId);
    if (!Number.isInteger(clientId) || clientId <= 0) {
      return json({ error: 'clientId must be a positive integer' }, 400);
    }
    if (typeof code !== 'string' || !code) {
      return json({ error: 'Missing code' }, 400);
    }

    const appid = Deno.env.get('WECHAT_APPID');
    const secret = Deno.env.get('WECHAT_APPSECRET');
    const wxRes = await fetch(
      `https://api.weixin.qq.com/sns/jscode2session?appid=${appid}&secret=${secret}&js_code=${encodeURIComponent(code)}&grant_type=authorization_code`,
    );
    const wxData = await wxRes.json();
    const openid: string | undefined = wxData && wxData.openid;
    if (!openid) {
      console.error('delete-pending-client: jscode2session sin openid:', wxData && wxData.errcode);
      return json({ error: 'invalid_code' }, 403);
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    const res = await fetch(
      `${supabaseUrl}/rest/v1/clients?id=eq.${clientId}&status=eq.${encodeURIComponent('Pending Payment')}&wechat_openid=eq.${encodeURIComponent(openid)}`,
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
      return new Response(JSON.stringify({ error: `clients delete failed: ${errBody}` }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const rows = await res.json();
    if (!rows || rows.length === 0) {
      // No existia, su status ya no era 'Pending Payment' (por ejemplo, se
      // llego a pagar mientras tanto) o no es de este openid -- no es un
      // error de red, pero el
      // caller (rejected.js / payment.js) igual debe seguir adelante y
      // limpiar el storage local, para no dejar al usuario trabado.
      return new Response(JSON.stringify({ ok: false, reason: 'not_found_or_not_deletable' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Best-effort: si esto falla no revertimos el borrado del cliente (ya
    // hecho e irreversible) -- solo lo logueamos. Una fila de payments
    // huerfana no rompe nada, un cliente a medio borrar si.
    try {
      await fetch(
        `${supabaseUrl}/rest/v1/payments?client_id=eq.${clientId}&status=neq.paid`,
        {
          method: 'DELETE',
          headers: { apikey: serviceKey!, Authorization: `Bearer ${serviceKey}` },
        },
      );
    } catch (err) {
      console.error('delete-pending-client: no se pudieron borrar payments huerfanos:', err);
    }

    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('delete-pending-client error:', err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
