import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import webpush from "npm:web-push@3.6.7";

// Manda una notificacion Web Push a todos los navegadores suscriptos
// (push_subscriptions) cuando llega una orden nueva. Body: { orderId: number }
// -- nunca confia en texto libre del caller, arma el mensaje leyendo la orden
// real de la base para evitar que alguien con la URL mande spam arbitrario.

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

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const { orderId } = await req.json();
    if (!orderId) return json({ error: 'Missing orderId' }, 400);

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const vapidPublicKey = Deno.env.get('VAPID_PUBLIC_KEY');
    const vapidPrivateKey = Deno.env.get('VAPID_PRIVATE_KEY');
    const vapidSubject = Deno.env.get('VAPID_SUBJECT') || 'mailto:admin@fitignyte.com';

    if (!vapidPublicKey || !vapidPrivateKey) {
      // Secrets no configurados todavia -- no es un error del caller, solo no hay nada para mandar.
      return json({ ok: true, sent: 0, skipped: 'vapid_not_configured' });
    }

    const dbHeaders = {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
    };

    const orderRes = await fetch(`${supabaseUrl}/rest/v1/new_orders?id=eq.${orderId}&select=name,district`, { headers: dbHeaders });
    const orderRows = await orderRes.json();
    const order = orderRows && orderRows[0];
    if (!order) return json({ error: 'Order not found' }, 404);

    const subsRes = await fetch(`${supabaseUrl}/rest/v1/push_subscriptions?select=*`, { headers: dbHeaders });
    const subs = await subsRes.json();
    if (!subs || subs.length === 0) return json({ ok: true, sent: 0 });

    webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);

    const payload = JSON.stringify({
      title: 'New order!',
      body: `${order.name || 'A client'}${order.district ? ' — ' + order.district : ''} just placed an order.`,
    });

    let sent = 0;
    let failed = 0;
    await Promise.all(subs.map(async (s: { id: number; endpoint: string; p256dh: string; auth: string }) => {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          payload,
        );
        sent++;
      } catch (err) {
        failed++;
        const statusCode = (err as { statusCode?: number }).statusCode;
        if (statusCode === 404 || statusCode === 410) {
          // Suscripcion muerta (el usuario desinstalo, revoco permiso, etc.) -- limpiar.
          await fetch(`${supabaseUrl}/rest/v1/push_subscriptions?id=eq.${s.id}`, { method: 'DELETE', headers: dbHeaders });
        } else {
          console.error('send-order-push error for subscription', s.id, err);
        }
      }
    }));

    return json({ ok: true, sent, failed });
  } catch (err) {
    console.error('send-order-push error:', err);
    return json({ error: String(err) }, 500);
  }
});
