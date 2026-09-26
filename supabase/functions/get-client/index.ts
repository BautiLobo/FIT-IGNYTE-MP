import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// Devuelve UNA fila de `clients` por id, phone u openid, usando la service_role key
// del lado del servidor — el mini-program nunca recibe esa key.

Deno.serve(async (req: Request) => {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  };

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { clientId, phone, openid } = await req.json();
    if (!clientId && !phone && !openid) {
      return new Response(JSON.stringify({ error: 'Missing clientId, phone or openid' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const dbHeaders = { apikey: serviceKey!, Authorization: `Bearer ${serviceKey}` };

    let filter: string;
    if (clientId) {
      filter = `id=eq.${clientId}`;
    } else if (openid) {
      filter = `wechat_openid=eq.${encodeURIComponent(openid)}`;
    } else {
      filter = `phone=eq.${encodeURIComponent(phone)}`;
    }

    const res = await fetch(
      `${supabaseUrl}/rest/v1/clients?${filter}`,
      { headers: dbHeaders }
    );
    const rows = await res.json();

    // Adjuntar si hay una renovación anticipada ya pagada pero todavía sin
    // aplicar (ver RENEWAL_PLAN.md, decisión 4) -- así el mini-program
    // puede ocultar el botón de renovar / mostrar el estado correcto sin
    // hacer otra llamada aparte. `applied` se pone en true recién cuando
    // el cron diario aplica el cambio de ciclo el día que corresponde.
    if (Array.isArray(rows) && rows.length > 0) {
      await Promise.all(rows.map(async (row: any) => {
        if (!row || row.id === undefined) return;
        const payRes = await fetch(
          `${supabaseUrl}/rest/v1/payments?client_id=eq.${row.id}&status=eq.paid&applied=eq.false&select=start_date,out_trade_no,plan_id&order=paid_at.desc&limit=1`,
          { headers: dbHeaders },
        );
        const payRows = await payRes.json();
        row.pending_renewal = (payRows && payRows.length > 0) ? payRows[0] : null;

        // Última entrega real del ciclo vigente. En prod conviven dos
        // convenciones de expiry_date: la vieja guarda el lunes en que
        // arranca la semana siguiente (última entrega el viernes antes), la
        // nueva guarda el día de la última entrega. La primera fecha de una
        // renovación sale de acá, no de expiry_date, para que las dos den el
        // mismo resultado. Acotado a [start_date, expiry_date]: filas de un
        // ciclo anterior no pueden adelantar la renovación.
        row.last_delivery_date = null;
        if (row.start_date && row.expiry_date) {
          const lastRes = await fetch(
            `${supabaseUrl}/rest/v1/meal_selections?client_id=eq.${row.id}&delivery_date=gte.${row.start_date}&delivery_date=lte.${row.expiry_date}&select=delivery_date&order=delivery_date.desc&limit=1`,
            { headers: dbHeaders },
          );
          const lastRows = await lastRes.json();
          if (Array.isArray(lastRows) && lastRows.length > 0) row.last_delivery_date = lastRows[0].delivery_date;
        }
      }));
    }

    return new Response(JSON.stringify(rows), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('get-client error:', err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
