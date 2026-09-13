import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// Resuelve un wx.login() code contra la API de WeChat (code2Session) y
// devuelve si el openid resultante esta en la lista de admins. Si es admin,
// ademas firma una sesion real de Supabase Auth (con una cuenta de servicio
// dedicada, solo conocida por este Edge Function) y devuelve el JWT, para
// que el mini-program pueda hacer escrituras autenticadas via RLS.
//
// Secrets requeridos (Project Settings -> Edge Functions -> Secrets):
//   WECHAT_APPID, WECHAT_APPSECRET, ADMIN_OPENIDS (coma-separado)
//   ADMIN_AUTH_EMAIL, ADMIN_AUTH_PASSWORD (cuenta de servicio Supabase Auth)
// SUPABASE_URL y SUPABASE_ANON_KEY ya vienen inyectados automaticamente.

Deno.serve(async (req: Request) => {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  };

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { code } = await req.json();
    if (!code) {
      return new Response(JSON.stringify({ error: 'Missing code' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const appid = Deno.env.get('WECHAT_APPID');
    const secret = Deno.env.get('WECHAT_APPSECRET');
    const adminOpenids = (Deno.env.get('ADMIN_OPENIDS') || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    const url = `https://api.weixin.qq.com/sns/jscode2session?appid=${appid}&secret=${secret}&js_code=${code}&grant_type=authorization_code`;
    const wxRes = await fetch(url);
    const wxData = await wxRes.json();

    if (wxData.errcode) {
      console.error('WeChat code2Session error:', wxData);
      return new Response(JSON.stringify({ error: 'WeChat auth failed', detail: wxData }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const openid = wxData.openid;
    const isAdmin = adminOpenids.includes(openid);

    let accessToken: string | null = null;

    if (isAdmin) {
      const adminEmail = Deno.env.get('ADMIN_AUTH_EMAIL');
      const adminPassword = Deno.env.get('ADMIN_AUTH_PASSWORD');
      const supabaseUrl = Deno.env.get('SUPABASE_URL');
      const anonKey = Deno.env.get('SUPABASE_ANON_KEY');

      if (adminEmail && adminPassword && supabaseUrl && anonKey) {
        try {
          const authRes = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
            method: 'POST',
            headers: {
              'apikey': anonKey,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ email: adminEmail, password: adminPassword }),
          });
          const authData = await authRes.json();
          if (authRes.ok && authData.access_token) {
            accessToken = authData.access_token;
          } else {
            console.error('Admin sign-in failed:', authData);
          }
        } catch (signInErr) {
          console.error('Admin sign-in error:', signInErr);
        }
      } else {
        console.error('Missing ADMIN_AUTH_EMAIL/ADMIN_AUTH_PASSWORD secrets');
      }
    }

    return new Response(JSON.stringify({ openid, isAdmin, accessToken }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('wx-login error:', err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
