import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// Envía un WeChat Subscribe Message (订阅消息) a un cliente puntual.
// Secrets requeridos (ya configurados para wx-login): WECHAT_APPID, WECHAT_APPSECRET
// SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY los inyecta el runtime de Edge Functions.
//
// Body esperado: { client_id: number, template_id: string, data: { <key>: { value: string }, ... }, page?: string }
// Las keys de `data` deben coincidir EXACTO con las que muestra WeChat en el
// detalle del template (ej. thing1, thing8, time4) — no son configurables acá,
// las define WeChat por template.

let cachedToken: { token: string; expiresAt: number } | null = null;

async function getAccessToken(appid: string, secret: string): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now()) return cachedToken.token;

  const url = `https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid=${appid}&secret=${secret}`;
  const res = await fetch(url);
  const data = await res.json();
  if (!data.access_token) throw new Error(`Failed to get access_token: ${JSON.stringify(data)}`);

  cachedToken = { token: data.access_token, expiresAt: Date.now() + (data.expires_in - 60) * 1000 };
  return data.access_token;
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
    const { client_id, template_id, data, page } = await req.json();
    if (!client_id || !template_id || !data) {
      return new Response(JSON.stringify({ error: 'Missing client_id, template_id or data' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const appid = Deno.env.get('WECHAT_APPID');
    const secret = Deno.env.get('WECHAT_APPSECRET');

    // Buscar el openid guardado para este cliente
    const clientRes = await fetch(
      `${supabaseUrl}/rest/v1/clients?id=eq.${client_id}&select=wechat_openid`,
      { headers: { apikey: serviceKey!, Authorization: `Bearer ${serviceKey}` } }
    );
    const clientRows = await clientRes.json();
    const openid = clientRows && clientRows[0] ? clientRows[0].wechat_openid : null;

    if (!openid) {
      // No tiene openid guardado o nunca otorgó permiso — no es un error, simplemente no se puede empujar.
      return new Response(JSON.stringify({ sent: false, reason: 'no_openid' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const token = await getAccessToken(appid!, secret!);

    const sendRes = await fetch(
      `https://api.weixin.qq.com/cgi-bin/message/subscribe/send?access_token=${token}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          touser: openid,
          template_id,
          page: page || 'pages/home/index',
          data,
          miniprogram_state: 'formal',
        }),
      }
    );
    const sendData = await sendRes.json();

    if (sendData.errcode && sendData.errcode !== 0) {
      console.error('wx-notify send error:', sendData);
      // errcode 43101: el usuario no otorgó permiso para este template — no es un fallo del servidor.
      return new Response(JSON.stringify({ sent: false, wxError: sendData }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ sent: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('wx-notify error:', err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
