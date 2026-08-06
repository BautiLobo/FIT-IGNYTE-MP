// app.js
const config = require('./config');


// Template de WeChat Subscribe Message "Message notification" — único template
// reutilizado para todos los tipos de notificación push.
// TODO: completar con las keys reales que muestra WeChat en el detalle del
// template (ej. thing1, thing8, time4) antes de probar en real.
const WX_TEMPLATE_ID = 'A7o5PTcftFBe1nYsidWchFofz2z_DN9Whn_96H60x2M';
const WX_TEMPLATE_KEYS = {
  writer: 'name1',    // Commenter
  content: 'thing2',  // Message content
  time: 'time4',      // Sending time
};

App({

  globalData: {
    clientId: null,
  },

  // ── WECHAT SUBSCRIBE MESSAGES (push notifications) ──────────────
  // 0) resolveOpenid: cambia un código fresco de wx.login por el openid real
  //    (vía wx-login, mismo Edge Function que usa el admin). El código expira
  //    en minutos, así que esto hay que hacerlo apenas se obtiene.
  resolveOpenid() {
    return new Promise((resolve) => {
      wx.login({
        success: (loginRes) => {
          if (!loginRes.code) { resolve(null); return; }
          wx.request({
            url: 'https://ychpcxloiwelyrwcsebf.supabase.co/functions/v1/wx-login',
            method: 'POST',
            header: { 'Content-Type': 'application/json' },
            data: { code: loginRes.code },
            success: (res) => resolve((res.data && res.data.openid) || null),
            fail: () => resolve(null),
          });
        },
        fail: () => resolve(null),
      });
    });
  },

  // 1) captureOpenid: resuelve el openid del cliente y lo guarda en
  //    clients.wechat_openid. Sin esto el backend no tiene a quién mandarle el push.
  async captureOpenid(clientId) {
    if (!clientId) return null;
    const openid = await this.resolveOpenid();
    if (!openid) return null;
    try {
      await this.supabase('PATCH', 'clients', { wechat_openid: openid }, `id=eq.${clientId}`);
    } catch (err) {
      console.error('[captureOpenid] save error:', err);
    }
    return openid;
  },

  // 2) requestSubscribe: pide permiso al usuario para recibir el template de
  //    push. WeChat exige que esto se dispare desde una acción del usuario
  //    (tap de un botón) — no funciona si se llama solo en onLoad/onShow.
  //    Cada permiso otorgado autoriza, en general, UN próximo envío.
  requestSubscribe() {
    return new Promise((resolve) => {
      wx.requestSubscribeMessage({
        tmplIds: [WX_TEMPLATE_ID],
        success: (res) => resolve(res[WX_TEMPLATE_ID] === 'accept'),
        fail: (err) => { console.error('[requestSubscribe] error:', err); resolve(false); },
      });
    });
  },

  // Formato fijo para el campo "time4" (sending time) — el template no
  // acepta más de ~20 caracteres, así que evitamos toLocaleString() (varía
  // según locale y puede ser demasiado largo).
  formatPushTime() {
    const d = new Date();
    const pad = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  },

  // 3) pushNotify: le pide al Edge Function wx-notify que mande el push al
  //    cliente indicado. Si el cliente nunca otorgó permiso o no tiene
  //    openid guardado, el Edge Function simplemente no manda nada (no es
  //    un error) — por eso esto nunca debe bloquear el flujo principal.
  pushNotify(clientId, writer, content, time) {
    // El template limita "name1" a ~10 caracteres y "thing2" a ~20 — WeChat
    // rechaza el envío si se exceden, así que recortamos antes de mandar.
    const safeWriter = (writer || '').slice(0, 10);
    const safeContent = (content || '').slice(0, 20);
    const safeTime = time || this.formatPushTime();

    return new Promise((resolve) => {
      wx.request({
        url: 'https://ychpcxloiwelyrwcsebf.supabase.co/functions/v1/wx-notify',
        method: 'POST',
        header: { 'Content-Type': 'application/json' },
        data: {
          client_id: clientId,
          template_id: WX_TEMPLATE_ID,
          data: {
            [WX_TEMPLATE_KEYS.writer]: { value: safeWriter },
            [WX_TEMPLATE_KEYS.content]: { value: safeContent },
            [WX_TEMPLATE_KEYS.time]: { value: safeTime },
          },
        },
        success: (res) => resolve(res.data),
        fail: (err) => { console.error('[pushNotify] error:', err); resolve(null); },
      });
    });
  },

  // ── REAL CLIENT STATUS (calculated, not stored) ────────────────
  // start_date/expiry_date son las fuentes de verdad. El campo `status`
  // en la tabla clients ya no se usa para Active/Upcoming/Inactive —
  // se calcula siempre en el momento para que nunca se desincronice.
  getRealStatus(startDate, expiryDate) {
    if (!startDate || !expiryDate) return 'Inactive';
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const start = new Date(startDate + 'T00:00:00');
    const expiry = new Date(expiryDate + 'T00:00:00');
    if (today < start) return 'Upcoming';
    if (today > expiry) return 'Inactive';
    return 'Active';
  },

  // ── GET CLIENT (vía Edge Function get-client) ───────────────────
  // Reemplaza los GET directos a /rest/v1/clients?id=eq./phone=eq. para
  // clientes normales (sin adminToken): la Edge Function usa la service_role
  // key del lado del servidor y solo devuelve la fila pedida, en vez de dejar
  // la tabla entera abierta a SELECT con la anon key.
  getClient({ clientId, phone, openid } = {}) {
    return new Promise((resolve, reject) => {
      wx.request({
        url: 'https://ychpcxloiwelyrwcsebf.supabase.co/functions/v1/get-client',
        method: 'POST',
        header: { 'Content-Type': 'application/json' },
        data: { clientId, phone, openid },
        success: (res) => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(res.data);
          } else {
            console.error('[getClient] failed:', res.statusCode, res.data);
            reject(new Error(`getClient error ${res.statusCode}: ${JSON.stringify(res.data)}`));
          }
        },
        fail: (err) => {
          console.error('[getClient] network error:', err);
          reject(err);
        }
      });
    });
  },

  // ── COMPLETE PAYMENT (vía Edge Function complete-payment) ──────
  // Reemplaza los PATCH directos a `clients`/`new_orders` con la anon key:
  // `clients` solo tiene policy de SELECT para `authenticated`, así que un
  // UPDATE con anon key matchea 0 filas (PostgREST devuelve 200 con []),
  // dejando `paid`/`status` sin actualizar pero sin lanzar ningún error.
  // Esta función usa la service_role key del lado del servidor.
  completePayment({ type, clientId, pendingOrderId, status, start_date, expiry_date, plan_id, cutlery, referralCode }) {
    return new Promise((resolve, reject) => {
      wx.request({
        url: 'https://ychpcxloiwelyrwcsebf.supabase.co/functions/v1/complete-payment',
        method: 'POST',
        header: { 'Content-Type': 'application/json' },
        data: { type, clientId, pendingOrderId, status, start_date, expiry_date, plan_id, cutlery, referralCode },
        success: (res) => {
          if (res.statusCode >= 200 && res.statusCode < 300 && res.data && res.data.ok) {
            resolve(res.data);
          } else {
            console.error('[completePayment] failed:', res.statusCode, res.data);
            reject(new Error(`completePayment error: ${JSON.stringify(res.data)}`));
          }
        },
        fail: (err) => {
          console.error('[completePayment] network error:', err);
          reject(err);
        }
      });
    });
  },

  // ── MENU ROTATION (rotación de 2 meses) ─────────────────────────
  // Cada menú dura 1 mes calendario. El cambio ocurre el primer lunes
  // de cada mes. `menu_rotation_anchor` es cualquier fecha dentro del
  // mes que inicia el ciclo. `menu_rotation_order` tiene 2 elementos.
  async getMenuRotation() {
    const data = await this.supabase('GET', 'settings', null, `key=in.(menu_rotation_anchor,menu_rotation_order)`);
    const map = {};
    (data || []).forEach(row => { map[row.key] = row.value; });

    const anchor = map.menu_rotation_anchor || null;
    let order = [1, 2];
    if (map.menu_rotation_order) {
      try {
        order = typeof map.menu_rotation_order === 'string'
          ? JSON.parse(map.menu_rotation_order)
          : map.menu_rotation_order;
      } catch (err) {
        console.error('[getMenuRotation] invalid menu_rotation_order:', map.menu_rotation_order);
      }
    }
    return { anchor, order };
  },

  // Calcula a qué week_index corresponde un día (mon..fri) según la fecha
  // calendario real de entrega. Si ese día de "esta semana" ya pasó (ej.
  // hoy es miércoles y se pregunta por lunes/martes), se usa la fecha del
  // lunes/martes de la PRÓXIMA semana, porque esos días ya no se pueden
  // entregar en la semana actual.
  // startDateStr (YYYY-MM-DD) es la referencia real: el primer día de
  // entrega que eligió el cliente. Si no se pasa, se usa "hoy" (caso del
  // cliente activo editando la semana en curso desde home, donde no hay
  // una decisión de start_date futura involucrada).
  getWeekIndexForDay(dayKey, anchor, order, startDateStr) {
    if (!anchor || !order || order.length !== 2) return 1;

    // Devuelve el primer lunes del mes dado (year, month 0-based)
    const firstMondayOfMonth = (year, month) => {
      const d = new Date(year, month, 1);
      const dow = d.getDay();
      const offset = dow === 0 ? 1 : dow === 1 ? 0 : 8 - dow;
      return new Date(year, month, 1 + offset);
    };

    // Devuelve {year, month} del "mes de menú" al que pertenece una fecha.
    // Si la fecha cae antes del primer lunes del mes, pertenece al mes anterior.
    const menuMonthOf = (date) => {
      const y = date.getFullYear();
      const m = date.getMonth();
      if (date < firstMondayOfMonth(y, m)) {
        return m === 0 ? { year: y - 1, month: 11 } : { year: y, month: m - 1 };
      }
      return { year: y, month: m };
    };

    const dayNumMap = { mon: 1, tue: 2, wed: 3, thu: 4, fri: 5 };
    const targetDow = dayNumMap[dayKey] || 1;

    const toMonday = (d) => {
      const dow = d.getDay();
      const m = new Date(d);
      m.setDate(d.getDate() + (dow === 0 ? -6 : 1 - dow));
      return m;
    };

    const refDate = startDateStr ? new Date(startDateStr + 'T00:00:00') : new Date();
    refDate.setHours(0, 0, 0, 0);
    const refMonday = toMonday(refDate);

    let weekMonday;
    if (startDateStr) {
      const dayDate = new Date(refMonday);
      dayDate.setDate(refMonday.getDate() + (targetDow - 1));
      weekMonday = dayDate < refDate
        ? new Date(refMonday.getTime() + 7 * 24 * 60 * 60 * 1000)
        : refMonday;
    } else {
      weekMonday = refMonday;
    }

    const anchorDate = new Date(anchor + 'T00:00:00');
    const anchorMenu = menuMonthOf(anchorDate);
    const targetMenu = menuMonthOf(weekMonday);

    const monthsSinceAnchor = (targetMenu.year - anchorMenu.year) * 12 + (targetMenu.month - anchorMenu.month);
    const slot = ((monthsSinceAnchor % 2) + 2) % 2;

    return order[slot];
  },

  // ── MEAL NAME (i18n) ─────────────────────────────────────────
  // Devuelve name_zh si el dispositivo está en chino y el campo tiene valor,
  // de lo contrario devuelve el name en inglés (fallback siempre disponible).
  getMealName(meal) {
    if (!meal) return '';
    try {
      const lang = wx.getAppBaseInfo().language || 'en';
      if (lang.startsWith('zh') && meal.name_zh) return meal.name_zh;
    } catch (e) {}
    return meal.name || '';
  },

  // Enriches a plan object with displayName and displayTier for i18n display.
  // Call this whenever a plan is loaded from DB or storage before showing to user.
  getDisplayPlan(plan) {
    if (!plan) return plan;
    return Object.assign({}, plan, {
      displayName: this.getMealName(plan),
      displayTier: this.getMealName({ name: plan.tier, name_zh: plan.tier_zh }),
    });
  },

  // ── SUPABASE HELPER ──────────────────────────────────────────
  supabase(method, table, body, query) {
    return new Promise((resolve, reject) => {
      let url = `${config.SUPABASE_URL}/rest/v1/${table}`;
      if (query) url += `?${query}`;

      const header = {
        'apikey': config.SUPABASE_KEY,
        'Authorization': `Bearer ${config.SUPABASE_KEY}`,
        'Content-Type': 'application/json',
      };

      if (method === 'POST') header['Prefer'] = 'return=representation';
      if (method === 'PATCH') header['Prefer'] = 'return=representation';

      wx.request({
        url,
        method,
        header,
        data: body ? JSON.stringify(body) : undefined,
        success: (res) => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(res.data);
          } else {
            console.error(`[supabase] ${method} ${table} failed:`, res.statusCode, res.data);
            reject(new Error(`Supabase error ${res.statusCode}: ${JSON.stringify(res.data)}`));
          }
        },
        fail: (err) => {
          console.error(`[supabase] ${method} ${table} network error:`, err);
          reject(err);
        }
      });
    });
  },

});
