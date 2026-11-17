import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// Crea (o actualiza, si ya hay una pendiente) una solicitud de cambio de
// direccion para un cliente, usando la service_role key del lado del servidor.
//
// Reemplaza el INSERT/PATCH directo a /rest/v1/address_changes que hacia el
// mini-program con la anon key. Mueve toda la logica "si ya hay una pendiente,
// actualizarla; si no, crear una nueva" al servidor, para que el cliente no
// tenga que hacer 2 requests separados ni dependa de SELECT abierto a anon.
//
// Un cliente en 'Pending Payment' (alta aprobada sin pagar) no puede pedir
// cambios de direccion: todavia no es cliente activo.
//
// Body esperado: { clientId, oldDistrict, oldAddress, newDistrict, newAddress, code? }

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
    const { clientId, oldDistrict, oldAddress, newDistrict, newAddress, code } = await req.json();
    if (!clientId || !newAddress) {
      return new Response(JSON.stringify({ error: 'Missing clientId or newAddress' }), {
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
      Prefer: 'return=representation',
    };
    const jsonHeaders = { ...corsHeaders, 'Content-Type': 'application/json' };

    const clientRes = await fetch(
      `${supabaseUrl}/rest/v1/clients?id=eq.${encodeURIComponent(String(clientId))}&select=id,status,wechat_openid`,
      { headers: dbHeaders },
    );
    const clientRows = await clientRes.json();
    if (!Array.isArray(clientRows) || clientRows.length === 0) {
      return new Response(JSON.stringify({ error: 'Client not found' }), { status: 404, headers: jsonHeaders });
    }
    const owner = await checkOwner(clientRows[0].wechat_openid, code);
    if (!owner.ok) {
      return new Response(JSON.stringify({ error: owner.error }), { status: owner.status, headers: jsonHeaders });
    }
    if (clientRows[0].status === 'Pending Payment') {
      return new Response(JSON.stringify({ error: 'pending_payment' }), { status: 403, headers: jsonHeaders });
    }

    const existingRes = await fetch(
      `${supabaseUrl}/rest/v1/address_changes?client_id=eq.${clientId}&status=eq.pending`,
      { headers: dbHeaders },
    );
    const existingRows = await existingRes.json();

    let res: Response;
    if (existingRows && existingRows.length > 0) {
      res = await fetch(
        `${supabaseUrl}/rest/v1/address_changes?id=eq.${existingRows[0].id}`,
        {
          method: 'PATCH',
          headers: dbHeaders,
          body: JSON.stringify({ new_district: newDistrict || '', new_address: newAddress }),
        },
      );
    } else {
      res = await fetch(`${supabaseUrl}/rest/v1/address_changes`, {
        method: 'POST',
        headers: dbHeaders,
        body: JSON.stringify({
          client_id: clientId,
          old_district: oldDistrict || '',
          old_address: oldAddress || '',
          new_district: newDistrict || '',
          new_address: newAddress,
          status: 'pending',
        }),
      });
    }

    if (!res.ok) {
      const errBody = await res.text();
      return new Response(JSON.stringify({ error: `address_changes write failed: ${errBody}` }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const rows = await res.json();
    return new Response(JSON.stringify({ ok: true, change: rows[0] || null }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('submit-address-change error:', err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
