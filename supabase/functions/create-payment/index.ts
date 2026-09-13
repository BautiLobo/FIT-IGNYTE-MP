import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// Crea una orden de pago JSAPI real en WeChat Pay (APIv3) para un cliente
// del mini-program, y devuelve los parametros firmados que el cliente le
// pasa directo a wx.requestPayment().
//
// Body esperado:
// {
//   type: 'new' | 'renewal',
//   clientId, pendingOrderId?, planId,
//   startDate, expiryDate, cutlery?, referralCode?
// }
//
// Secrets requeridos (Project Settings -> Edge Functions -> Secrets):
//   WECHAT_APPID (ya existe, compartido con wx-login)
//   WX_MCH_ID, WX_API_V3_KEY, WX_CERT_SERIAL_NO, WX_PRIVATE_KEY
// SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY ya vienen inyectados.

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function randomNonce(len = 32): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let out = '';
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  for (let i = 0; i < len; i++) out += chars[bytes[i] % chars.length];
  return out;
}

// Misma logica que app.getRealStatus() del mini-program, para que el status
// que se guarde en clients cuando el webhook confirme el pago sea correcto.
function getRealStatus(startDate: string, expiryDate: string): string {
  if (!startDate || !expiryDate) return 'Inactive';
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const start = new Date(startDate + 'T00:00:00');
  const expiry = new Date(expiryDate + 'T00:00:00');
  if (today < start) return 'Upcoming';
  if (today > expiry) return 'Inactive';
  return 'Active';
}

async function importPrivateKey(pem: string): Promise<CryptoKey> {
  const body = pem
    .replace('-----BEGIN PRIVATE KEY-----', '')
    .replace('-----END PRIVATE KEY-----', '')
    .replace(/\s+/g, '');
  const der = Uint8Array.from(atob(body), (c) => c.charCodeAt(0));
  return await crypto.subtle.importKey(
    'pkcs8',
    der,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  );
}

async function signRSA(privateKey: CryptoKey, message: string): Promise<string> {
  const sig = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    privateKey,
    new TextEncoder().encode(message),
  );
  return btoa(String.fromCharCode(...new Uint8Array(sig)));
}

// Firma una request para la API v3 de WeChat Pay y arma el header Authorization.
async function wechatPayAuthHeader(
  privateKey: CryptoKey,
  mchId: string,
  serialNo: string,
  method: string,
  urlPath: string,
  body: string,
): Promise<{ header: string; timestamp: string; nonceStr: string }> {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const nonceStr = randomNonce();
  const message = `${method}\n${urlPath}\n${timestamp}\n${nonceStr}\n${body}\n`;
  const signature = await signRSA(privateKey, message);
  const header =
    `WECHATPAY2-SHA256-RSA2048 mchid="${mchId}",nonce_str="${nonceStr}",signature="${signature}",timestamp="${timestamp}",serial_no="${serialNo}"`;
  return { header, timestamp, nonceStr };
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const {
      type, clientId, pendingOrderId, planId,
      startDate, expiryDate, cutlery, referralCode,
    } = await req.json();

    if (!type || !clientId || !planId || !startDate || !expiryDate) {
      return json({ error: 'Missing required fields' }, 400);
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const appId = Deno.env.get('WECHAT_APPID')!;
    const mchId = Deno.env.get('WX_MCH_ID')!;
    const apiV3Key = Deno.env.get('WX_API_V3_KEY')!;
    const serialNo = Deno.env.get('WX_CERT_SERIAL_NO')!;
    const privatePem = Deno.env.get('WX_PRIVATE_KEY')!;

    const dbHeaders = {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
    };

    // Renovacion anticipada duplicada (ver RENEWAL_PLAN.md, decisiones 6 y
    // 7): si ya hay un pago de este cliente confirmado (`status='paid'`)
    // pero todavia sin aplicar (`applied=false` -- el plan actual sigue
    // activo, esperando a que el cron lo aplique el dia que corresponde),
    // no dejar generar un segundo pago. Ademas de evitar la renovacion
    // duplicada, esto cierra de paso la ventana para reusar un codigo de
    // referido antes de que el primer pago se termine de aplicar: no se
    // puede ni siquiera llegar a la validacion de referral_code de mas
    // abajo sin pasar por este guard primero.
    if (type === 'renewal') {
      const pendingRes = await fetch(
        `${supabaseUrl}/rest/v1/payments?client_id=eq.${clientId}&status=eq.paid&applied=eq.false&select=out_trade_no&limit=1`,
        { headers: dbHeaders },
      );
      const pendingRows = await pendingRes.json();
      if (pendingRows && pendingRows.length > 0) {
        return json({ error: 'duplicate_pending_renewal', existingOutTradeNo: pendingRows[0].out_trade_no }, 409);
      }
    }

    // 1) Cliente (para el openid que exige el pago JSAPI)
    const clientRes = await fetch(`${supabaseUrl}/rest/v1/clients?id=eq.${clientId}`, { headers: dbHeaders });
    const clientRows = await clientRes.json();
    if (!clientRows || clientRows.length === 0) return json({ error: 'Client not found' }, 404);
    const client = clientRows[0];
    const openid = client.wechat_openid;
    if (!openid) return json({ error: 'Client has no wechat_openid captured yet' }, 400);

    // Fee de delivery: ya no es un constante global -- lo define el admin
    // por cliente al aprobar su orden (ver approveOrder en el panel admin,
    // FIT-IGNYTE), y queda guardado en clients.delivery_fee. El fallback a
    // 35 es solo por si algun cliente viejo quedara sin el campo seteado.
    const deliveryFee = client.delivery_fee ?? 35;

    // 2) Plan (precio recalculado server-side, no confiamos en el total del cliente)
    const planRes = await fetch(`${supabaseUrl}/rest/v1/plans?id=eq.${planId}`, { headers: dbHeaders });
    const planRows = await planRes.json();
    if (!planRows || planRows.length === 0) return json({ error: 'Plan not found' }, 404);
    const plan = planRows[0];

    const planPrice = plan.price || 0;
    const discount = type === 'new' ? Math.round(planPrice * 0.25) : 0;
    let total = planPrice - discount + deliveryFee;

    // 3) Referral: se re-valida server-side, nunca se confia en el descuento
    // del cliente. Solo aplica en alta nueva (type==='new') -- no en
    // renovaciones, a pedido del negocio.
    let normalizedReferral = '';
    if (referralCode && type === 'new') {
      const code = String(referralCode).trim().toLowerCase();
      const coachRes = await fetch(`${supabaseUrl}/rest/v1/coaches?code=eq.${encodeURIComponent(code)}`, { headers: dbHeaders });
      const coachRows = await coachRes.json();
      if (coachRows && coachRows.length > 0 && !client.referral_used) {
        normalizedReferral = code;
        total = total - Math.round(total * 0.10);
      }
    }

    const amountFen = Math.round(total * 100);
    const outTradeNo = `fitignyte${clientId}${Date.now()}`;
    const clientStatus = getRealStatus(startDate, expiryDate);

    // 4) Registrar el intento de pago (fuente de verdad para el webhook)
    const paymentPayload = {
      out_trade_no: outTradeNo,
      type,
      client_id: clientId,
      pending_order_id: pendingOrderId || null,
      plan_id: planId,
      amount_fen: amountFen,
      referral_code: normalizedReferral,
      start_date: startDate,
      expiry_date: expiryDate,
      cutlery: cutlery === true,
      client_status: clientStatus,
      status: 'pending',
    };
    const insertRes = await fetch(`${supabaseUrl}/rest/v1/payments`, {
      method: 'POST',
      headers: { ...dbHeaders, Prefer: 'return=representation' },
      body: JSON.stringify(paymentPayload),
    });
    if (!insertRes.ok) {
      const errBody = await insertRes.text();
      return json({ error: `payments insert failed: ${errBody}` }, 500);
    }

    // 5) Crear la orden JSAPI en WeChat Pay
    const privateKey = await importPrivateKey(privatePem);
    const notifyUrl = `${supabaseUrl}/functions/v1/wx-pay-webhook`;
    const orderBody = JSON.stringify({
      appid: appId,
      mchid: mchId,
      description: 'FIT IGNYTE Meal Plan',
      out_trade_no: outTradeNo,
      notify_url: notifyUrl,
      amount: { total: amountFen, currency: 'CNY' },
      payer: { openid },
    });

    const urlPath = '/v3/pay/transactions/jsapi';
    const { header: authHeader } = await wechatPayAuthHeader(
      privateKey, mchId, serialNo, 'POST', urlPath, orderBody,
    );

    const wxRes = await fetch(`https://api.mch.weixin.qq.com${urlPath}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: authHeader,
      },
      body: orderBody,
    });
    const wxData = await wxRes.json();

    if (!wxRes.ok || !wxData.prepay_id) {
      console.error('WeChat Pay order creation failed:', wxData);
      await fetch(`${supabaseUrl}/rest/v1/payments?out_trade_no=eq.${outTradeNo}`, {
        method: 'PATCH',
        headers: dbHeaders,
        body: JSON.stringify({ status: 'failed' }),
      });
      return json({ error: 'WeChat Pay order creation failed', detail: wxData }, 500);
    }

    // 6) Firmar los parametros que el mini-program pasa a wx.requestPayment()
    const timeStamp = Math.floor(Date.now() / 1000).toString();
    const nonceStr = randomNonce();
    const pkg = `prepay_id=${wxData.prepay_id}`;
    const payMessage = `${appId}\n${timeStamp}\n${nonceStr}\n${pkg}\n`;
    const paySign = await signRSA(privateKey, payMessage);

    return json({
      ok: true,
      outTradeNo,
      amount: total,
      timeStamp,
      nonceStr,
      package: pkg,
      signType: 'RSA',
      paySign,
    });
  } catch (err) {
    console.error('create-payment error:', err);
    return json({ error: String(err) }, 500);
  }
});
