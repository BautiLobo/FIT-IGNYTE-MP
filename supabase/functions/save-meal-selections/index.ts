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

// Primer dia habil DESPUES de dateStr.
function nextBusinessDay(dateStr: string, holidays: string[]): string {
  let d = new Date(dateStr + 'T00:00:00Z');
  do { d = new Date(d.getTime() + 24 * 60 * 60 * 1000); } while (isNonWorkingDay(d, holidays));
  return toDateString(d);
}

// Clave de una entrada en payments.selections: la fecha sola para el slot 1
// (como la arma create-payment), fecha#slot para los demas.
// apply_pending_renewals lee `date`/`slot` de adentro, no la clave.
function selectionKey(date: string, slot: number): string {
  return slot === 1 ? date : `${date}#${slot}`;
}

function countSelections(selections: unknown): number {
  if (!selections || typeof selections !== 'object') return 0;
  return Object.values(selections as Record<string, { meal_ids?: unknown }>)
    .filter((v) => v && Array.isArray(v.meal_ids) && v.meal_ids.length > 0).length;
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

    // El corte de "no toques HOY" aplica a los dos ciclos: el proximo
    // (pending_meal_selections) tambien puede arrancar manana, y desde que
    // edit-meals deja cambiarle las fechas ya no alcanza con suponer que
    // todas sus fechas estan lejos.
    const holidays = await loadHolidays(supabaseUrl!, headers);
    const minEditableDay = getMinEditableDay(holidays);

    // ── Ciclo pendiente (renovacion anticipada ya paga) ──────────────────
    // Lo que edita el cliente en edit-meals (modo "proximo plan") es lo que
    // se le tiene que aplicar el dia que arranca. Por eso, ademas de
    // pending_meal_selections, este guardado reescribe el pago pendiente:
    // `selections` (de donde apply_pending_renewals copiaba las comidas,
    // ignorando las ediciones -- caso cliente #422, 2026-10-28) y
    // start_date/expiry_date (el cron arranca el ciclo con start_date, asi
    // que mover las entregas sin moverlo dejaba un ciclo inconsistente).
    let pendingPayment: { id: string; selections: unknown } | null = null;
    // Filas pendientes que la cocina ya tiene bloqueadas (antes del corte):
    // no se muestran en edit-meals, asi que no se borran ni se cuentan.
    let lockedPending: { delivery_date: string; slot: number; meals_json: unknown; delivery_time: string | null; note: string | null }[] = [];
    let pendingFloor: string | null = null;
    let pendingMax: string | null = null;
    let expectedCount = 0;
    if (table === 'pending_meal_selections') {
      const payRes = await fetch(
        `${supabaseUrl}/rest/v1/payments?client_id=eq.${clientId}&status=eq.paid&applied=eq.false&select=id,selections&order=paid_at.desc&limit=1`,
        { headers },
      );
      const payRows = await payRes.json();
      pendingPayment = Array.isArray(payRows) && payRows.length > 0 ? payRows[0] : null;

      const pendRes = await fetch(
        `${supabaseUrl}/rest/v1/pending_meal_selections?client_id=eq.${clientId}&select=delivery_date,slot,meals_json,delivery_time,note`,
        { headers },
      );
      const pendRows: { delivery_date: string | null; slot: number; meals_json: unknown; delivery_time: string | null; note: string | null }[] = (await pendRes.json()) || [];
      lockedPending = pendRows.filter((r) => r.delivery_date && r.delivery_date < minEditableDay) as typeof lockedPending;
      const editableCount = pendRows.length - lockedPending.length;

      if (pendingPayment) {
        // El proximo ciclo nunca puede pisar entregas del vigente:
        // apply_pending_renewals borra TODO meal_selections del cliente al
        // aplicarse. Ultima entrega real del vigente, acotada a
        // [start_date, expiry_date] igual que get-client.last_delivery_date.
        const clientRes = await fetch(`${supabaseUrl}/rest/v1/clients?id=eq.${clientId}&select=start_date,expiry_date`, { headers });
        const c = ((await clientRes.json()) || [])[0] || {};
        let lastCurrent: string | null = null;
        if (c.start_date && c.expiry_date) {
          const lastRes = await fetch(
            `${supabaseUrl}/rest/v1/meal_selections?client_id=eq.${clientId}&delivery_date=gte.${c.start_date}&delivery_date=lte.${c.expiry_date}&select=delivery_date&order=delivery_date.desc&limit=1`,
            { headers },
          );
          const lastRows = await lastRes.json();
          lastCurrent = Array.isArray(lastRows) && lastRows.length > 0 ? lastRows[0].delivery_date : c.expiry_date;
        }
        const afterCurrent = lastCurrent ? nextBusinessDay(lastCurrent, holidays) : null;
        pendingFloor = afterCurrent && afterCurrent > minEditableDay ? afterCurrent : minEditableDay;

        // Misma ventana de 14 dias habiles que pages/change-date, sin dejar
        // afuera fechas que el cliente ya tenia (las eligio al pagar, desde
        // un piso que pudo ser anterior al de hoy).
        const existingDates = pendRows.map((r) => r.delivery_date).filter(Boolean) as string[];
        Object.values((pendingPayment.selections || {}) as Record<string, { date?: string }>).forEach((v) => { if (v && v.date) existingDates.push(v.date); });
        pendingMax = [getMaxAllowedDay(pendingFloor, 14, holidays), ...existingDates].sort().pop()!;
      }

      // Lo que el pago trae y lo que hay en pendientes deberian coincidir;
      // si no (un guardado viejo ya borro un dia), manda el mas grande.
      expectedCount = Math.max(editableCount, countSelections(pendingPayment?.selections) - lockedPending.length);
    }

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

      // Entregas que este guardado va a reemplazar (mismo tramo que el
      // DELETE de abajo, sin las filas legacy sin fecha).
      const range = from && to
        ? `delivery_date=gte.${from}&delivery_date=lte.${to}`
        : `delivery_date=gte.${minEditableDay}`;
      const curRes = await fetch(`${supabaseUrl}/rest/v1/meal_selections?client_id=eq.${clientId}&${range}&select=id`, { headers });
      const curRows = await curRes.json();
      expectedCount = Array.isArray(curRows) ? curRows.length : 0;
    } else if (pendingPayment) {
      maxAllowedDay = pendingMax;
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
      if (pendingFloor && day < pendingFloor) {
        return json({ error: 'overlaps_current_cycle', day, pendingFloor }, 409);
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

    // Un guardado nunca puede achicar el ciclo. Un dia que quedo sin comida
    // no viaja en `selections`, y el DELETE de abajo lo borraba igual: asi
    // perdio un dia el cliente #422 (2026-10-28). Mover fechas sigue
    // permitido (la cantidad no cambia), y una consolidacion hecha por el
    // staff ya esta en la base, asi que tampoco salta.
    if (rows.length < expectedCount) {
      return json({ error: 'would_drop_days', expected: expectedCount, got: rows.length }, 409);
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
    // En el ciclo pendiente se reemplaza todo menos lo ya bloqueado para la
    // cocina (lockedPending), que edit-meals ni muestra.
    else if (table === 'pending_meal_selections') delQuery += `&or=(delivery_date.is.null,delivery_date.gte.${minEditableDay})`;

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

    // 4) Ciclo pendiente: el pago queda igual a lo que se acaba de guardar
    // (ver el comentario de pendingPayment, arriba). start/expiry salen de
    // las fechas que el servidor mismo valido, nunca del body.
    if (table === 'pending_meal_selections' && pendingPayment && rows.length > 0) {
      const all = [
        ...lockedPending.map((r) => ({ date: r.delivery_date, slot: r.slot || 1, time: r.delivery_time || '', notes: r.note || '', meal_ids: r.meals_json })),
        ...rows.map((r) => ({ date: r.delivery_date as string, slot: r.slot as number, time: r.delivery_time as string, notes: r.note as string, meal_ids: r.meals_json })),
      ];
      const newSelections: Record<string, unknown> = {};
      all.forEach((s) => { newSelections[selectionKey(s.date, s.slot)] = s; });
      const dates = all.map((s) => s.date).sort();
      const patchRes = await fetch(`${supabaseUrl}/rest/v1/payments?id=eq.${pendingPayment.id}&applied=eq.false`, {
        method: 'PATCH',
        headers: { ...headers, Prefer: 'return=minimal' },
        body: JSON.stringify({ selections: newSelections, start_date: dates[0], expiry_date: dates[dates.length - 1] }),
      });
      if (!patchRes.ok) {
        // Aca si se corta: si el pago no queda igual, el ciclo arrancaria
        // con otras comidas u otras fechas que las que el cliente ve.
        const errBody = await patchRes.text();
        return json({ error: `payments sync failed: ${errBody}` }, 500);
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
