import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// Reemplaza el set de comidas de un cliente usando la service_role key del
// lado del servidor.
//
// Reemplaza el DELETE + POST directos a /rest/v1/meal_selections que hacia
// app.js con la anon key. Ese camino estaba roto en silencio: las policies
// de la tabla le dan a anon INSERT y UPDATE, pero el DELETE esta restringido
// a is_admin(), y PostgREST devuelve 204 igual cuando RLS filtra todas las
// filas. Resultado: el DELETE no borraba nada, el codigo creia que si, y
//   - al reescribir las MISMAS fechas (rehacer un alta tras "start over")
//     el INSERT chocaba contra UNIQUE(client_id, delivery_date, slot) -> 409;
//   - al escribir fechas NUEVAS (una renovacion) las filas viejas quedaban
//     huerfanas acumulandose ciclo tras ciclo.
//
// Darle DELETE a anon habria arreglado los dos, pero abre la puerta a que
// cualquiera con la anon key (publica, va en el bundle) le borre las comidas
// a cualquier cliente -- justo lo contrario de las migraciones que vinieron
// cerrando accesos anon. Por eso la escritura pasa a ser server-side, igual
// que update-client, complete-payment y el resto.
//
// Body esperado:
// {
//   clientId: number,
//   selections: { "<clave>": { meal_ids: string[], time?: string,
//                              notes?: string, date?: string, slot?: number } },
//   deferToPending?: boolean,   // true -> pending_meal_selections
//   from?: string, to?: string  // acota el reemplazo a [from, to]
// }
//
// La clave de cada entrada se usa como fecha cuando `date` no viene (asi lo
// manda meal-select, que indexa por fecha); edit-meals manda `date`/`slot`
// propios porque un cliente puede tener varias entregas el mismo dia.

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

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

// ── Dia minimo editable (server-side) ────────────────────────────────
// Esta funcion no validaba NADA de fechas: dejaba reescribir el dia de HOY
// (la cocina ya lo esta preparando o ya lo repartio) o incluso uno pasado,
// sin ningun chequeo -- mismo agujero que create-payment tenia antes con el
// corte de las 23 (ver ese archivo), pero ahi para una fecha de ARRANQUE
// nueva. Aca es peor: deja tocar un dia que el cliente ya confirmo hace
// tiempo y que la cocina ya tiene en su lista de hoy.
//
// Mismo algoritmo que create-payment/utils/business-days.js: el minimo
// editable nunca es HOY -- como minimo manana, y pasado si ya paso el corte
// de las 23 (hora de China). Aplica a TODOS los dias del payload, no solo a
// una fecha de arranque, porque edit-meals deja tocar cualquier dia del
// ciclo vigente.
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

async function loadHolidays(supabaseUrl: string, headers: Record<string, string>): Promise<string[]> {
  try {
    const res = await fetch(`${supabaseUrl}/rest/v1/settings?key=eq.public_holidays&select=value`, { headers });
    const rows = await res.json();
    const raw = rows && rows.length > 0 ? rows[0].value : null;
    const parsed = raw ? JSON.parse(raw) : null;
    if (Array.isArray(parsed)) return parsed.filter((x) => typeof x === 'string');
  } catch (err) {
    console.error('save-meal-selections: no se pudo leer public_holidays, se valida sin feriados:', err);
  }
  return [];
}

function getMinEditableDay(holidays: string[]): string {
  const now = shanghaiNow();
  const cutoffPassed = now.getUTCHours() >= 23;
  const d = new Date(now);
  d.setUTCDate(d.getUTCDate() + (cutoffPassed ? 2 : 1));
  while (isNonWorkingDay(d, holidays)) d.setUTCDate(d.getUTCDate() + 1);
  return toDateString(d);
}

// N-esimo dia habil (inclusive) contando desde startDateStr -- mismo
// algoritmo que utils/business-days.js's getValidDeliveryWindow, pero
// devuelve solo el ultimo, que es lo unico que hace falta aca (el limite
// superior de la ventana de pages/change-date). Se recalcula server-side
// en vez de confiar en el `to` que manda el cliente -- ver por que en el
// comentario de mas abajo, junto a maxAllowedDay.
function getMaxAllowedDay(startDateStr: string, businessDaysCount: number, holidays: string[]): string {
  let d = new Date(startDateStr + 'T00:00:00Z');
  let count = 0;
  let last = startDateStr;
  while (count < businessDaysCount) {
    if (!isNonWorkingDay(d, holidays)) {
      count++;
      last = toDateString(d);
    }
    if (count >= businessDaysCount) break;
    d = new Date(d.getTime() + 24 * 60 * 60 * 1000);
  }
  return last;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const { clientId, selections, deferToPending, from, to } = await req.json();

    if (!clientId || !selections || typeof selections !== 'object') {
      return json({ error: 'Missing clientId or selections' }, 400);
    }
    if ((from && !ISO_DATE.test(from)) || (to && !ISO_DATE.test(to))) {
      return json({ error: 'from/to must be YYYY-MM-DD' }, 400);
    }

    const table = deferToPending === true ? 'pending_meal_selections' : 'meal_selections';

    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const headers = {
      apikey: serviceKey!,
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
    };

    // `pending_meal_selections` es siempre el ciclo que TODAVIA no arranco
    // (lo vacia apply_pending_renewals/complete-payment al aplicarse) -- el
    // corte de "no toques HOY" no aplica ahi, ninguna de esas fechas esta
    // siendo preparada todavia. Solo aplica al ciclo vigente.
    const holidays = table === 'meal_selections' ? await loadHolidays(supabaseUrl!, headers) : [];
    const minEditableDay = table === 'meal_selections' ? getMinEditableDay(holidays) : null;

    // pages/change-date deja reordenar las fechas restantes del ciclo vigente
    // dentro de una ventana de 14 dias habiles (misma ventana que
    // pages/start-date usa para elegir fechas nuevas) -- eso puede correr la
    // ULTIMA entrega mas alla del expiry_date actual. maxAllowedDay/clientRow
    // se recalculan ACA, server-side, en vez de confiar en el `to` que manda
    // el body: `to` solo lo usa el DELETE de abajo (que ya esta acotado a
    // este mismo client_id, no es un riesgo), pero el limite real de "hasta
    // donde se puede estirar la ultima fecha" tiene que salir de un calculo
    // propio del servidor -- si no, cualquiera con la anon key podria mandar
    // un `to` bien lejano y estirarse el ciclo gratis, exactamente lo que
    // ALLOWED_FIELDS en update-client existe para evitar.
    let clientRow: { start_date: string | null; expiry_date: string | null } | null = null;
    let maxAllowedDay: string | null = null;
    if (table === 'meal_selections') {
      const clientRes = await fetch(`${supabaseUrl}/rest/v1/clients?id=eq.${clientId}&select=start_date,expiry_date`, { headers });
      const clientRows = await clientRes.json();
      clientRow = clientRows && clientRows.length > 0 ? clientRows[0] : null;

      const rawStart = clientRow?.start_date || '';
      const cycleFloor = minEditableDay && rawStart > minEditableDay ? rawStart : minEditableDay;
      if (cycleFloor) maxAllowedDay = getMaxAllowedDay(cycleFloor, 14, holidays);
    }

    // Solo estas columnas: el cliente no decide nada mas de la fila.
    const rows: Record<string, unknown>[] = [];
    for (const key of Object.keys(selections)) {
      const sel = selections[key];
      if (!sel || !Array.isArray(sel.meal_ids) || sel.meal_ids.length === 0) continue;

      const day = typeof sel.date === 'string' && sel.date ? sel.date : key;
      if (!ISO_DATE.test(day)) {
        return json({ error: `Invalid date: ${day}` }, 400);
      }
      const slot = Number.isInteger(sel.slot) ? sel.slot : 1;
      if (slot < 1 || slot > 10) {
        return json({ error: `Invalid slot: ${slot}` }, 400);
      }
      // Una fecha fuera de la ventana pedida nunca deberia llegar; si llega,
      // se rechaza entero en vez de escribir algo que el DELETE de abajo no
      // va a poder reemplazar la proxima vez.
      if ((from && day < from) || (to && day > to)) {
        return json({ error: `Date ${day} outside [${from}, ${to}]` }, 400);
      }
      // Dia ya bloqueado para la cocina (hoy, un dia pasado, o manana si ya
      // paso el corte de las 23) -- se rechaza entero, mismo criterio que el
      // check de arriba, para no escribir la mitad de un ciclo.
      if (minEditableDay && day < minEditableDay) {
        return json({ error: 'locked_day', day, minEditableDay }, 409);
      }
      // Limite real de la ventana de pages/change-date (14 dias habiles
      // desde el piso del ciclo) -- independiente de lo que diga `to`, ver
      // el comentario de maxAllowedDay mas arriba.
      if (maxAllowedDay && day > maxAllowedDay) {
        return json({ error: 'beyond_window', day, maxAllowedDay }, 400);
      }

      rows.push({
        client_id: clientId,
        delivery_date: day,
        slot,
        meals_json: sel.meal_ids,
        delivery_time: typeof sel.time === 'string' ? sel.time : '',
        note: typeof sel.notes === 'string' ? sel.notes : '',
      });
    }

    // 1) Borrar el tramo que se va a reemplazar. Con la service key esto SI
    //    borra. Sin from/to se reemplaza el set completo del cliente, que es
    //    lo que corresponde cuando las selecciones son el ciclo entero.
    let delQuery = `client_id=eq.${clientId}`;
    // Las filas con delivery_date NULL (escritas por la version vieja del
    // mini-program antes de existir el pago) caen fuera de cualquier rango:
    // se borran igual, si no apply_pending_renewals las re-deriva al lado de
    // las nuevas y choca contra el UNIQUE.
    if (from && to) delQuery += `&or=(delivery_date.is.null,and(delivery_date.gte.${from},delivery_date.lte.${to}))`;

    const delRes = await fetch(`${supabaseUrl}/rest/v1/${table}?${delQuery}`, {
      method: 'DELETE',
      headers: { ...headers, Prefer: 'return=representation' },
    });
    if (!delRes.ok) {
      const errBody = await delRes.text();
      return json({ error: `${table} delete failed: ${errBody}` }, 500);
    }
    const deleted = await delRes.json();

    // 2) Insertar el set nuevo en una sola request.
    let inserted: unknown[] = [];
    if (rows.length > 0) {
      const insRes = await fetch(`${supabaseUrl}/rest/v1/${table}`, {
        method: 'POST',
        headers: { ...headers, Prefer: 'return=representation' },
        body: JSON.stringify(rows),
      });
      if (!insRes.ok) {
        const errBody = await insRes.text();
        return json({ error: `${table} insert failed: ${errBody}` }, 500);
      }
      inserted = await insRes.json();
    }

    // 3) expiry_date es literalmente "la fecha de la ultima entrega" (asi lo
    // trata pages/start-date desde que arranco el modelo de fechas reales,
    // no un tope independiente) -- si change-date corrio esa ultima fecha
    // mas alla del expiry_date guardado, hay que sincronizarlo, si no
    // Home/renovacion/get-client siguen mirando un vencimiento viejo. Se
    // recalcula del lado del servidor, a partir de los `rows` que EL MISMO
    // acaba de validar contra maxAllowedDay -- nunca del `to` que mando el
    // cliente. No toca nada mas del cliente (ni start_date, ni plan_id).
    if (table === 'meal_selections' && rows.length > 0 && clientRow) {
      const newExpiry = (rows.map((r) => r.delivery_date as string).sort()).pop()!;
      if (newExpiry !== clientRow.expiry_date) {
        const patchRes = await fetch(`${supabaseUrl}/rest/v1/clients?id=eq.${clientId}`, {
          method: 'PATCH',
          headers: { ...headers, Prefer: 'return=minimal' },
          body: JSON.stringify({ expiry_date: newExpiry }),
        });
        if (!patchRes.ok) {
          const errBody = await patchRes.text();
          // No cortar la respuesta por esto: las comidas ya se guardaron
          // bien, y el vencimiento se corrige solo en el proximo guardado.
          console.error('save-meal-selections: no se pudo sincronizar expiry_date:', errBody);
        }
      }
    }

    return json({
      ok: true,
      table,
      deleted: Array.isArray(deleted) ? deleted.length : 0,
      inserted: Array.isArray(inserted) ? inserted.length : 0,
    });
  } catch (err) {
    console.error('save-meal-selections error:', err);
    return json({ error: String(err) }, 500);
  }
});
