import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// Corre una vez al día (vía pg_cron, ver migración add_wx_notify_cron_job) y
// manda los pushes de WeChat que dependen de fecha, no de una acción del admin:
//   1) Plan que vence mañana          (clients.status = Active, expiry_date = mañana)
//   2) Plan que arranca mañana        (clients.status = Upcoming, start_date = mañana)
//   3) Feriado mañana → sin delivery  (si mañana es Lun-Vie Y está en PUBLIC_HOLIDAYS)
//
// Protegido con un secret compartido (header x-cron-secret) porque el endpoint
// no requiere JWT — solo pg_cron lo debe poder llamar.
//
// IMPORTANTE: esta lista de feriados debe mantenerse igual a
// pages/start-date/holidays.js (son dos copias porque el mini-programa y el
// Edge Function no comparten build).
const PUBLIC_HOLIDAYS = [
  '2026-01-01', '2026-01-02', '2026-01-03',
  '2026-02-15', '2026-02-16', '2026-02-17', '2026-02-18', '2026-02-19',
  '2026-02-20', '2026-02-21', '2026-02-22', '2026-02-23',
  '2026-04-04', '2026-04-05', '2026-04-06',
  '2026-05-01', '2026-05-02', '2026-05-03', '2026-05-04', '2026-05-05',
  '2026-06-19', '2026-06-20', '2026-06-21',
  '2026-09-25', '2026-09-26', '2026-09-27',
  '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04',
  '2026-10-05', '2026-10-06', '2026-10-07',
];

const WX_TEMPLATE_ID = 'A7o5PTcftFBe1nYsidWchFofz2z_DN9Whn_96H60x2M';

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

function shanghaiTomorrow(): { iso: string; isWeekday: boolean } {
  // Asia/Shanghai es UTC+8 fijo, sin horario de verano.
  const now = new Date(Date.now() + 8 * 60 * 60 * 1000);
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const dow = tomorrow.getDay(); // en UTC "local" del objeto, pero como ya corrimos el offset, sirve
  const pad = (n: number) => String(n).padStart(2, '0');
  const iso = `${tomorrow.getFullYear()}-${pad(tomorrow.getMonth() + 1)}-${pad(tomorrow.getDate())}`;
  return { iso, isWeekday: dow >= 1 && dow <= 5 };
}

function formatPushTime(): string {
  const now = new Date(Date.now() + 8 * 60 * 60 * 1000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
}

Deno.serve(async (req: Request) => {
  const cronSecret = Deno.env.get('CRON_SECRET');
  if (!cronSecret || req.headers.get('x-cron-secret') !== cronSecret) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const appid = Deno.env.get('WECHAT_APPID');
    const secret = Deno.env.get('WECHAT_APPSECRET');
    const headers = { apikey: serviceKey!, Authorization: `Bearer ${serviceKey}` };

    const { iso: tomorrow, isWeekday } = shanghaiTomorrow();
    const time = formatPushTime();
    const token = await getAccessToken(appid!, secret!);

    async function sendTo(openid: string, content: string) {
      const res = await fetch(
        `https://api.weixin.qq.com/cgi-bin/message/subscribe/send?access_token=${token}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            touser: openid,
            template_id: WX_TEMPLATE_ID,
            page: 'pages/home/index',
            data: {
              name1: { value: 'FIT IGNYTE' },
              thing2: { value: content },
              time4: { value: time },
            },
            miniprogram_state: 'formal',
          }),
        }
      );
      return res.json();
    }

    const results = { expiring: 0, starting: 0, holiday: 0, errors: [] as string[] };

    // 1) Planes que vencen mañana
    const expiringRes = await fetch(
      `${supabaseUrl}/rest/v1/clients?status=eq.Active&expiry_date=eq.${tomorrow}&select=id,wechat_openid`,
      { headers }
    );
    const expiringClients = await expiringRes.json();
    for (const c of expiringClients || []) {
      if (!c.wechat_openid) continue;
      const r = await sendTo(c.wechat_openid, 'Plan expires soon');
      if (r.errcode && r.errcode !== 0) results.errors.push(`expiring ${c.id}: ${JSON.stringify(r)}`);
      else results.expiring++;
    }

    // 2) Planes que arrancan mañana
    const startingRes = await fetch(
      `${supabaseUrl}/rest/v1/clients?status=eq.Upcoming&start_date=eq.${tomorrow}&select=id,wechat_openid`,
      { headers }
    );
    const startingClients = await startingRes.json();
    for (const c of startingClients || []) {
      if (!c.wechat_openid) continue;
      const r = await sendTo(c.wechat_openid, 'Plan starts tomorrow');
      if (r.errcode && r.errcode !== 0) results.errors.push(`starting ${c.id}: ${JSON.stringify(r)}`);
      else results.starting++;
    }

    // 3) Feriado mañana (solo si cae en día hábil — fines de semana ya no tienen delivery)
    if (isWeekday && PUBLIC_HOLIDAYS.includes(tomorrow)) {
      const activeRes = await fetch(
        `${supabaseUrl}/rest/v1/clients?status=eq.Active&select=id,wechat_openid`,
        { headers }
      );
      const activeClients = await activeRes.json();
      for (const c of activeClients || []) {
        if (!c.wechat_openid) continue;
        const r = await sendTo(c.wechat_openid, 'No delivery tomorrow');
        if (r.errcode && r.errcode !== 0) results.errors.push(`holiday ${c.id}: ${JSON.stringify(r)}`);
        else results.holiday++;
      }
    }

    return new Response(JSON.stringify(results), { headers: { 'Content-Type': 'application/json' } });
  } catch (err) {
    console.error('wx-notify-cron error:', err);
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 });
  }
});
