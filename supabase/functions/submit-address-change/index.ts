import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// Crea (o actualiza, si ya hay una pendiente) una solicitud de cambio de
// direccion para un cliente, usando la service_role key del lado del servidor.
//
// Reemplaza el INSERT/PATCH directo a /rest/v1/address_changes que hacia el
// mini-program con la anon key. Mueve toda la logica "si ya hay una pendiente,
// actualizarla; si no, crear una nueva" al servidor, para que el cliente no
// tenga que hacer 2 requests separados ni dependa de SELECT abierto a anon.
//
// Body esperado: { clientId, oldDistrict, oldAddress, newDistrict, newAddress }

Deno.serve(async (req: Request) => {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  };

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { clientId, oldDistrict, oldAddress, newDistrict, newAddress } = await req.json();
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
