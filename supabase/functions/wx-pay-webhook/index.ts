import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// Webhook de WeChat Pay (APIv3): recibe la notificacion server-to-server
// cuando un pago se confirma de verdad, desencripta el resource (AEAD_AES_256_GCM
// con la API v3 Key) y, si el pago fue exitoso, llama a complete-payment para
// activar al cliente -- exactamente igual que el flujo simulado anterior, pero
// disparado por WeChat en vez de por el cliente.
//
// Secrets requeridos: WX_API_V3_KEY (compartido con create-payment)
// SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY ya vienen inyectados.

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function wxJson(code: string, message: string, status = 200) {
  // WeChat espera exactamente este formato de respuesta para dar la
  // notificacion por recibida; si no, reintenta la entrega varias veces.
  return new Response(JSON.stringify({ code, message }), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

async function decryptResource(
  ciphertextB64: string,
  nonce: string,
  associatedData: string,
  apiV3Key: string,
): Promise<string> {
  const keyBytes = new TextEncoder().encode(apiV3Key);
  const cryptoKey = await crypto.subtle.importKey('raw', keyBytes, { name: 'AES-GCM' }, false, ['decrypt']);
  const ciphertext = Uint8Array.from(atob(ciphertextB64), (c) => c.charCodeAt(0));
  const iv = new TextEncoder().encode(nonce);
  const aad = new TextEncoder().encode(associatedData);
  const plainBuf = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv, additionalData: aad, tagLength: 128 },
    cryptoKey,
    ciphertext,
  );
  return new TextDecoder().decode(plainBuf);
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const raw = await req.json();
    const resource = raw.resource;
    if (!resource) return wxJson('FAIL', 'missing resource', 400);

    const apiV3Key = Deno.env.get('WX_API_V3_KEY')!;
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    const decrypted = await decryptResource(
      resource.ciphertext,
      resource.nonce,
      resource.associated_data || '',
      apiV3Key,
    );
    const event = JSON.parse(decrypted);
    // event: { out_trade_no, transaction_id, trade_state, ... }

    if (event.trade_state !== 'SUCCESS') {
      // Notificacion de un estado que no es pago exitoso (ej. cerrado, error) --
      // la reconocemos igual para que WeChat no siga reintentando.
      return wxJson('SUCCESS', 'noted (not a success state)');
    }

    const dbHeaders = {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
    };

    const payRes = await fetch(
      `${supabaseUrl}/rest/v1/payments?out_trade_no=eq.${event.out_trade_no}`,
      { headers: dbHeaders },
    );
    const payRows = await payRes.json();
    if (!payRows || payRows.length === 0) {
      console.error('wx-pay-webhook: no payment row for out_trade_no', event.out_trade_no);
      return wxJson('SUCCESS', 'no matching payment record (ignored)');
    }
    const payment = payRows[0];

    // Idempotencia: si WeChat reenvia la misma notificacion, no reprocesar.
    if (payment.status === 'paid') {
      return wxJson('SUCCESS', 'already processed');
    }

    // Marca el pago como pagado en nuestra tabla
    await fetch(`${supabaseUrl}/rest/v1/payments?out_trade_no=eq.${event.out_trade_no}`, {
      method: 'PATCH',
      headers: dbHeaders,
      body: JSON.stringify({
        status: 'paid',
        wx_transaction_id: event.transaction_id || null,
        paid_at: new Date().toISOString(),
      }),
    });

    // complete-payment ahora solo confia en filas de `payments` con
    // status='paid' -- justo la que acabamos de escribir arriba -- y toma
    // clientId/plan/fechas de ahi, no de lo que le mandemos nosotros.
    const completeRes = await fetch(`${supabaseUrl}/functions/v1/complete-payment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ out_trade_no: event.out_trade_no }),
    });

    if (!completeRes.ok) {
      const errBody = await completeRes.text();
      console.error('wx-pay-webhook: complete-payment failed:', errBody);
      return wxJson('FAIL', 'complete-payment failed', 500);
    }

    return wxJson('SUCCESS', 'ok');
  } catch (err) {
    console.error('wx-pay-webhook error:', err);
    return wxJson('FAIL', String(err), 500);
  }
});
