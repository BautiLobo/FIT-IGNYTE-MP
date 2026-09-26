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
//
// Si ALLOW_PAYMENT_SIMULATION='true' (solo para proyectos de dev/test, ver
// config.dev.js del mini-program), se saltea por completo el paso de crear
// y firmar la orden real en WeChat Pay -- no hacen falta los 4 secrets
// WX_* de arriba. El mini-program en modo simulado nunca lee los campos
// firmados de la respuesta (timeStamp/nonceStr/package/paySign), solo
// `outTradeNo` para llamar a dev-simulate-payment después.

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
//
// "Hoy" en hora de Shanghai (shanghaiNow(), definida mas abajo) y no la del
// servidor (UTC): entre las 16:00 y las 24:00 UTC, la fecha en Shanghai ya
// es un dia distinta a la de UTC -- new Date() a secas guardaba un
// client_status equivocado en ese margen de 8hs todos los dias.
function getRealStatus(startDate: string, expiryDate: string): string {
  if (!startDate || !expiryDate) return 'Inactive';
  const todayStr = toDateString(shanghaiNow());
  if (todayStr < startDate) return 'Upcoming';
  if (todayStr > expiryDate) return 'Inactive';
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

// ── Validacion de fechas (server-side) ───────────────────────────────
// Hasta ahora esta funcion tomaba startDate/expiryDate del body sin mirarlos.
// El corte de las 23 vivia solo en el mini-program, o sea que alcanzaba con
// un telefono con la hora cambiada -- o con quedarse en la pantalla de pago
// mientras pasaban las 23 -- para crear un pago con una fecha que la cocina
// ya no puede preparar.

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

// "Ahora" en hora de China. China no usa horario de verano desde 1991, asi
// que UTC+8 fijo es exacto. Devuelve un Date corrido a proposito: sus
// getters UTC leen la hora de pared de Shanghai.
function shanghaiNow(): Date {
  return new Date(Date.now() + 8 * 60 * 60 * 1000);
}

function toDateString(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

function isNonWorkingDay(d: Date, holidays: string[]): boolean {
  if (holidays.includes(toDateString(d))) return true;
  const day = d.getUTCDay();
  return day === 0 || day === 6;
}

// Mismo algoritmo que utils/business-days.js del mini-program.
function getMinStartDate(holidays: string[], currentExpiryDate?: string | null): string {
  const now = shanghaiNow();
  const cutoffPassed = now.getUTCHours() >= 23;
  const d = new Date(now);
  d.setUTCDate(d.getUTCDate() + (cutoffPassed ? 2 : 1));
  while (isNonWorkingDay(d, holidays)) d.setUTCDate(d.getUTCDate() + 1);

  let min = toDateString(d);

  if (currentExpiryDate) {
    const e = new Date(currentExpiryDate + 'T00:00:00Z');
    e.setUTCDate(e.getUTCDate() + 1);
    while (isNonWorkingDay(e, holidays)) e.setUTCDate(e.getUTCDate() + 1);
    const minAfterExpiry = toDateString(e);
    if (minAfterExpiry > min) min = minAfterExpiry;
  }

  return min;
}

// La lista de feriados vive en settings.public_holidays (una sola fuente para
// el servidor). Si no se puede leer NO se bloquea el pago: se valida igual el
// corte y los fines de semana, que es lo que mas importa, y se loguea.
async function loadHolidays(supabaseUrl: string, headers: Record<string, string>): Promise<string[]> {
  try {
    const res = await fetch(`${supabaseUrl}/rest/v1/settings?key=eq.public_holidays&select=value`, { headers });
    const rows = await res.json();
    const raw = rows && rows.length > 0 ? rows[0].value : null;
    const parsed = raw ? JSON.parse(raw) : null;
    if (Array.isArray(parsed)) return parsed.filter((x) => typeof x === 'string');
  } catch (err) {
    console.error('create-payment: no se pudo leer public_holidays, se valida sin feriados:', err);
  }
  return [];
}

// Las comidas elegidas viajan CON el pago: se guardan en payments.selections
// y las escribe quien aplica el pago (complete-payment o
// apply_pending_renewals), en la misma operacion en que cambia el plan.
//
// Antes el mini-program las escribia por su cuenta DESPUES de que el pago se
// confirmaba, o sea despues de que el servidor ya habia aplicado el ciclo
// nuevo: en esa ventana el cliente quedaba con el plan nuevo y las comidas
// del viejo. Y un pago abandonado dejaba comidas escritas igual.
//
// Se guarda solo lo que tenga forma valida -- el resto se descarta aca, para
// que nunca llegue basura a la fila del pago.
function normalizeSelections(raw: unknown): Record<string, unknown> | null {
  if (!raw || typeof raw !== 'object') return null;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw as Record<string, any>)) {
    const sel = value || {};
    if (!Array.isArray(sel.meal_ids) || sel.meal_ids.length === 0) continue;
    const day = typeof sel.date === 'string' && sel.date ? sel.date : key;
    if (!ISO_DATE.test(day)) continue;
    out[key] = {
      meal_ids: sel.meal_ids.filter((m: unknown) => typeof m === 'string'),
      time: typeof sel.time === 'string' ? sel.time : '',
      notes: typeof sel.notes === 'string' ? sel.notes : '',
      date: day,
      slot: Number.isInteger(sel.slot) ? sel.slot : 1,
    };
  }
  return Object.keys(out).length > 0 ? out : null;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const {
      type, clientId, pendingOrderId, planId,
      startDate, expiryDate, cutlery, referralCode, selections,
    } = await req.json();

    if (!type || !clientId || !planId || !startDate || !expiryDate) {
      return json({ error: 'Missing required fields' }, 400);
    }
    if (!ISO_DATE.test(startDate) || !ISO_DATE.test(expiryDate)) {
      return json({ error: 'startDate/expiryDate must be YYYY-MM-DD' }, 400);
    }
    if (expiryDate < startDate) {
      return json({ error: 'expiryDate cannot be before startDate' }, 400);
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const appId = Deno.env.get('WECHAT_APPID')!;
    const isSimulating = Deno.env.get('ALLOW_PAYMENT_SIMULATION') === 'true';

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

    // Corte de las 23 (hora de China) y dia habil, validados aca y no solo
    // en el cliente. Se hace despues de traer al cliente porque una
    // renovacion no puede arrancar antes del dia siguiente a su expiry.
    const holidays = await loadHolidays(supabaseUrl, dbHeaders);
    const minStart = getMinStartDate(holidays, type === 'renewal' ? client.expiry_date : null);
    if (startDate < minStart) {
      return json({ error: 'start_date_too_early', minStartDate: minStart, sent: startDate }, 409);
    }
    // No alcanza con estar despues del minimo: la fecha tiene que ser un dia
    // de reparto. El calendario del cliente ya saltea findes y feriados, pero
    // el servidor no puede confiar en eso -- sin este chequeo se podia pagar
    // un plan que arranca un domingo o en pleno Mid-Autumn.
    if (isNonWorkingDay(new Date(startDate + 'T00:00:00Z'), holidays)) {
      return json({ error: 'start_date_not_a_delivery_day', sent: startDate }, 409);
    }

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

    // Alta nueva: las comidas ya viven en la orden que aprobo el admin, asi
    // que se toman de ahi en vez de confiar en lo que mande el cliente.
    let finalSelections = normalizeSelections(selections);
    if (!finalSelections && type === 'new' && pendingOrderId) {
      try {
        const ordRes = await fetch(
          `${supabaseUrl}/rest/v1/new_orders?id=eq.${pendingOrderId}&select=meals`,
          { headers: dbHeaders },
        );
        const ordRows = await ordRes.json();
        finalSelections = normalizeSelections(ordRows?.[0]?.meals);
      } catch (err) {
        console.error('create-payment: no se pudieron leer las comidas de la orden:', err);
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
      selections: finalSelections,
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

    // 5) Crear la orden JSAPI en WeChat Pay -- salteado por completo en modo
    // simulado (ver nota arriba): no hace falta la clave privada del
    // comercio para un pago que nunca se va a cobrar de verdad.
    if (isSimulating) {
      return json({
        ok: true,
        outTradeNo,
        amount: total,
        timeStamp: '',
        nonceStr: '',
        package: '',
        signType: 'RSA',
        paySign: '',
        simulated: true,
      });
    }

    const mchId = Deno.env.get('WX_MCH_ID')!;
    const apiV3Key = Deno.env.get('WX_API_V3_KEY')!;
    const serialNo = Deno.env.get('WX_CERT_SERIAL_NO')!;
    const privatePem = Deno.env.get('WX_PRIVATE_KEY')!;
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
