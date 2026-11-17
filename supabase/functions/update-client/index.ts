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
// Un cliente en 'Pending Payment' (alta aprobada sin pagar) no puede editar
// su perfil: lo unico permitido es la captura de wechat_openid, que hace
// payment.js antes de pagar.
//
// Body esperado: { clientId: number, patch: { ...campos permitidos }, code?: string }

const ALLOWED_FIELDS = ['wechat_openid', 'name', 'phone', 'access', 'allergies', 'goal'];

// ── Dueño del cliente ─────────────────────────────────────────────
// Antes esta funcion usaba el clientId del body sin mas: con el id de otro
// cliente (y la anon key, que es publica) se le pisaban los datos. Ahora el
// mini-program manda un codigo fresco de wx.login (`code`), el openid se
// resuelve ACA contra WeChat (jscode2session, igual que wx-login y
// delete-pending-client) y tiene que coincidir con clients.wechat_openid.
// Un cliente sin wechat_openid guardado (cargado a mano) no se puede
// verificar y pasa.
//
// Transicion: la version del mini-program publicada hoy no manda `code`.
// Mientras REQUIRE_OWNER_CODE sea false, un pedido SIN code pasa (como
// antes); uno CON code invalido o de otro dueño se rechaza. Pasar a true
// cuando la version nueva este aprobada en WeChat y no queden paquetes
// viejos en los celulares.
const REQUIRE_OWNER_CODE = false;

type OwnerCheck = { ok: true; openid: string | null } | { ok: false; status: number; error: string };

async function checkOwner(storedOpenid: string | null | undefined, code: unknown): Promise<OwnerCheck> {
  if (typeof code !== 'string' || !code) {
    return REQUIRE_OWNER_CODE ? { ok: false, status: 401, error: 'missing_code' } : { ok: true, openid: null };
  }
  const appid = Deno.env.get('WECHAT_APPID');
  const secret = Deno.env.get('WECHAT_APPSECRET');
  const wxRes = await fetch(
    `https://api.weixin.qq.com/sns/jscode2session?appid=${appid}&secret=${secret}&js_code=${encodeURIComponent(code)}&grant_type=authorization_code`,
  );
  const wxData = await wxRes.json();
  const openid: string | undefined = wxData && wxData.openid;
  if (!openid) {
    console.error('checkOwner: jscode2session sin openid:', wxData && wxData.errcode);
    return { ok: false, status: 403, error: 'invalid_code' };
  }
  if (storedOpenid && storedOpenid !== openid) return { ok: false, status: 403, error: 'not_owner' };
  return { ok: true, openid };
}

Deno.serve(async (req: Request) => {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  };

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { clientId, patch, code } = await req.json();
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
    const jsonHeaders = { ...corsHeaders, 'Content-Type': 'application/json' };

    const clientRes = await fetch(
      `${supabaseUrl}/rest/v1/clients?id=eq.${encodeURIComponent(String(clientId))}&select=id,status,wechat_openid`,
      { headers: { apikey: serviceKey!, Authorization: `Bearer ${serviceKey}` } },
    );
    const clientRows = await clientRes.json();
    if (!Array.isArray(clientRows) || clientRows.length === 0) {
      return new Response(JSON.stringify({ error: 'Client not found' }), { status: 404, headers: jsonHeaders });
    }
    const current = clientRows[0];

    const owner = await checkOwner(current.wechat_openid, code);
    if (!owner.ok) {
      return new Response(JSON.stringify({ error: owner.error }), { status: owner.status, headers: jsonHeaders });
    }
    // Con code verificado, el openid que se guarda es el que resolvio WeChat,
    // no el que mando el cliente.
    if ('wechat_openid' in safePatch && owner.openid) safePatch.wechat_openid = owner.openid;

    const onlyOpenid = Object.keys(safePatch).length === 1 && 'wechat_openid' in safePatch;
    if (current.status === 'Pending Payment' && !onlyOpenid) {
      return new Response(JSON.stringify({ error: 'pending_payment' }), { status: 403, headers: jsonHeaders });
    }

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
