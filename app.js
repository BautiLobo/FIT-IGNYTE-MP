// app.js
const config = require('./config');
const { cachePublicHolidays } = require('./utils/holidays');
const { shanghaiNow, toDateString } = require('./utils/business-days');


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
    // Ver config.js: requiere también el secret ALLOW_PAYMENT_SIMULATION
    // en Supabase para que dev-simulate-payment acepte el llamado.
    simulatePayments: config.SIMULATE_PAYMENTS === true,
  },

  onLaunch() {
    // La lista de feriados vive en settings.public_holidays -- una sola
    // fuente compartida con create-payment y wx-notify-cron. Se refresca al
    // arrancar y queda cacheada en storage, asi que el calculo de fechas
    // (utils/business-days.js) la lee sincronicamente sin pegarle a la red.
    // Si falla, utils/holidays.js cae en su lista bundleada.
    this.fetchPublicHolidays();
  },

  fetchPublicHolidays() {
    return this.supabase('GET', 'settings', null, 'key=eq.public_holidays&select=value')
      .then((rows) => {
        const raw = rows && rows.length > 0 ? rows[0].value : null;
        if (!raw) return;
        cachePublicHolidays(JSON.parse(raw));
      })
      .catch((err) => {
        console.error('[fetchPublicHolidays] se sigue con la lista bundleada:', err);
      });
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
            url: `${config.SUPABASE_URL}/functions/v1/wx-login`,
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
      await this.updateClient({ clientId, patch: { wechat_openid: openid } });
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
        url: `${config.SUPABASE_URL}/functions/v1/wx-notify`,
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
  // "Hoy" se calcula en hora de Shanghai, no la del dispositivo -- mismo
  // motivo que shanghaiNow() en utils/business-days.js: un cliente con el
  // telefono en otro huso (o probando desde Buenos Aires) veia Active
  // mostrado como Upcoming/Inactive un dia antes o despues que en China,
  // que es donde vive/entrega el negocio. Comparar como strings ISO
  // (startDate/expiryDate ya vienen 'YYYY-MM-DD' de la DB) evita además
  // cualquier lio de parseo de Date en otro huso.
  getRealStatus(startDate, expiryDate) {
    if (!startDate || !expiryDate) return 'Inactive';
    const todayStr = toDateString(shanghaiNow());
    if (todayStr < startDate) return 'Upcoming';
    if (todayStr > expiryDate) return 'Inactive';
    return 'Active';
  },

  // ── CREATE ORDER (vía Edge Function create-order) ───────────────
  // Reemplaza el POST directo a /rest/v1/new_orders con la anon key: el
  // INSERT en sí seguía permitido por RLS, pero el helper genérico pide
  // Prefer: return=representation, y Postgres exige que el rol que inserta
  // también pueda leer la fila devuelta — cosa que la anon key ya no puede
  // hacer en new_orders. Esta función usa la service_role key del lado del
  // servidor y no depende de ninguna policy para devolver la fila creada.
  createOrder(orderData) {
    return new Promise((resolve, reject) => {
      wx.request({
        url: `${config.SUPABASE_URL}/functions/v1/create-order`,
        method: 'POST',
        header: { 'Content-Type': 'application/json' },
        data: orderData,
        success: (res) => {
          // ok:false con reason:'duplicate_pending_order' es un resultado de
          // negocio válido (ya tenés un pedido sin resolver), no un error —
          // se resuelve igual para que el caller decida qué mostrar.
          if (res.statusCode >= 200 && res.statusCode < 300 && res.data) {
            resolve(res.data);
          } else {
            console.error('[createOrder] failed:', res.statusCode, res.data);
            reject(new Error(`createOrder error: ${JSON.stringify(res.data)}`));
          }
        },
        fail: (err) => {
          console.error('[createOrder] network error:', err);
          reject(err);
        }
      });
    });
  },

  // ── GET CLIENT (vía Edge Function get-client) ───────────────────
  // Reemplaza los GET directos a /rest/v1/clients?id=eq./phone=eq. para
  // clientes normales (sin adminToken): la Edge Function usa la service_role
  // key del lado del servidor y solo devuelve la fila pedida, en vez de dejar
  // la tabla entera abierta a SELECT con la anon key.
  getClient({ clientId, phone, openid } = {}) {
    return new Promise((resolve, reject) => {
      wx.request({
        url: `${config.SUPABASE_URL}/functions/v1/get-client`,
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

  // ── UPDATE CLIENT (vía Edge Function update-client) ─────────────
  // Reemplaza los PATCH directos a `clients` con la anon key: esa tabla no
  // tiene (ni debe tener) UPDATE abierto a anon, porque dejaría a cualquiera
  // con la anon key (pública, va en el bundle del mini-program) marcar
  // cualquier cliente como pagado o pisarle datos a otro. Esta función solo
  // permite tocar columnas de perfil no sensibles del lado del servidor.
  updateClient({ clientId, patch }) {
    return new Promise((resolve, reject) => {
      wx.request({
        url: `${config.SUPABASE_URL}/functions/v1/update-client`,
        method: 'POST',
        header: { 'Content-Type': 'application/json' },
        data: { clientId, patch },
        success: (res) => {
          if (res.statusCode >= 200 && res.statusCode < 300 && res.data && res.data.ok) {
            resolve(res.data.client);
          } else {
            console.error('[updateClient] failed:', res.statusCode, res.data);
            reject(new Error(`updateClient error: ${JSON.stringify(res.data)}`));
          }
        },
        fail: (err) => {
          console.error('[updateClient] network error:', err);
          reject(err);
        }
      });
    });
  },

  // ── GET / UPDATE ORDER (vía Edge Functions get-order / update-order) ───
  // Mismo motivo que get-client/update-client, pero para `new_orders`: sin
  // esto, cualquiera con la anon key podía leer o editar TODOS los pedidos.
  getOrder({ orderId }) {
    return new Promise((resolve, reject) => {
      wx.request({
        url: `${config.SUPABASE_URL}/functions/v1/get-order`,
        method: 'POST',
        header: { 'Content-Type': 'application/json' },
        data: { orderId },
        success: (res) => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(res.data);
          } else {
            console.error('[getOrder] failed:', res.statusCode, res.data);
            reject(new Error(`getOrder error ${res.statusCode}: ${JSON.stringify(res.data)}`));
          }
        },
        fail: (err) => {
          console.error('[getOrder] network error:', err);
          reject(err);
        }
      });
    });
  },

  updateOrder({ orderId, patch }) {
    return new Promise((resolve, reject) => {
      wx.request({
        url: `${config.SUPABASE_URL}/functions/v1/update-order`,
        method: 'POST',
        header: { 'Content-Type': 'application/json' },
        data: { orderId, patch },
        success: (res) => {
          if (res.statusCode >= 200 && res.statusCode < 300 && res.data && res.data.ok) {
            resolve(res.data.order);
          } else {
            console.error('[updateOrder] failed:', res.statusCode, res.data);
            reject(new Error(`updateOrder error: ${JSON.stringify(res.data)}`));
          }
        },
        fail: (err) => {
          console.error('[updateOrder] network error:', err);
          reject(err);
        }
      });
    });
  },

  // Borra un pedido propio (vía Edge Function delete-order) -- usado desde
  // "Start over" en rejected.js y payment.js. El servidor solo lo permite si
  // el pedido sigue en draft/rejected/approved (ver comentario en la Edge Function).
  deleteOrder({ orderId }) {
    return new Promise((resolve, reject) => {
      wx.request({
        url: `${config.SUPABASE_URL}/functions/v1/delete-order`,
        method: 'POST',
        header: { 'Content-Type': 'application/json' },
        data: { orderId },
        success: (res) => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(res.data);
          } else {
            console.error('[deleteOrder] failed:', res.statusCode, res.data);
            reject(new Error(`deleteOrder error: ${JSON.stringify(res.data)}`));
          }
        },
        fail: (err) => {
          console.error('[deleteOrder] network error:', err);
          reject(err);
        }
      });
    });
  },

  // Borra un cliente propio en 'Pending Payment' (vía Edge Function
  // delete-pending-client) -- usado desde "Start over" en rejected.js y
  // payment.js, junto con deleteOrder, cuando approveOrder ya creó la fila
  // en `clients` antes de que el usuario pagara. El servidor solo lo permite
  // si el cliente sigue en 'Pending Payment' (ver comentario en la Edge Function).
  // El servidor exige un código fresco de wx.login y resuelve el openid del
  // lado de WeChat: solo el dueño del cliente puede borrarlo.
  deleteClient({ clientId }) {
    return new Promise((resolve, reject) => {
      wx.login({
        success: (loginRes) => {
          if (!loginRes.code) { reject(new Error('deleteClient: wx.login sin code')); return; }
          wx.request({
            url: `${config.SUPABASE_URL}/functions/v1/delete-pending-client`,
            method: 'POST',
            header: { 'Content-Type': 'application/json' },
            data: { clientId, code: loginRes.code },
            success: (res) => {
              if (res.statusCode >= 200 && res.statusCode < 300) {
                resolve(res.data);
              } else {
                console.error('[deleteClient] failed:', res.statusCode, res.data);
                reject(new Error(`deleteClient error: ${JSON.stringify(res.data)}`));
              }
            },
            fail: (err) => {
              console.error('[deleteClient] network error:', err);
              reject(err);
            }
          });
        },
        fail: (err) => {
          console.error('[deleteClient] wx.login error:', err);
          reject(err);
        }
      });
    });
  },

  // ── CREATE PAYMENT (vía Edge Function create-payment) ────────────
  // Crea la orden JSAPI real en WeChat Pay y devuelve los parámetros
  // firmados listos para pasarle directo a wx.requestPayment().
  createPayment({ type, clientId, pendingOrderId, planId, startDate, expiryDate, cutlery, referralCode, selections }) {
    return new Promise((resolve, reject) => {
      wx.request({
        url: `${config.SUPABASE_URL}/functions/v1/create-payment`,
        method: 'POST',
        header: { 'Content-Type': 'application/json' },
        // appVersion: create-payment solo valida fechas server-side para esta
        // versión, que sabe manejar esos 409 (la vieja no).
        data: { type, clientId, pendingOrderId, planId, startDate, expiryDate, cutlery, referralCode, selections, appVersion: 2 },
        success: (res) => {
          if (res.statusCode >= 200 && res.statusCode < 300 && res.data && res.data.ok) {
            resolve(res.data);
          } else {
            console.error('[createPayment] failed:', res.statusCode, res.data);
            const err = new Error(`createPayment error: ${JSON.stringify(res.data)}`);
            // Código de error estructurado (ej. 'duplicate_pending_renewal')
            // para que el caller pueda mostrar un mensaje específico en vez
            // del genérico -- ver RENEWAL_PLAN.md, decisión 6.
            err.code = res.data && res.data.error;
            reject(err);
          }
        },
        fail: (err) => {
          console.error('[createPayment] network error:', err);
          reject(err);
        }
      });
    });
  },

  // ── SIMULATE PAYMENT (solo dev/local, ver config.js) ─────────────
  // Reemplaza a wx.requestPayment() + el webhook de WeChat cuando
  // globalData.simulatePayments está en true: marca el pago como pagado
  // del lado del servidor y dispara el mismo complete-payment que usaría
  // el webhook real. La Edge Function la rechaza igual (403) si el secret
  // ALLOW_PAYMENT_SIMULATION no está activo en Supabase, así que dejar
  // esto en true acá no alcanza por sí solo para saltarse un pago real.
  simulatePayment({ outTradeNo }) {
    return new Promise((resolve, reject) => {
      wx.request({
        url: `${config.SUPABASE_URL}/functions/v1/dev-simulate-payment`,
        method: 'POST',
        header: { 'Content-Type': 'application/json' },
        data: { out_trade_no: outTradeNo },
        success: (res) => {
          if (res.statusCode >= 200 && res.statusCode < 300 && res.data && res.data.ok) {
            resolve(res.data);
          } else {
            console.error('[simulatePayment] failed:', res.statusCode, res.data);
            reject(new Error(`simulatePayment error: ${JSON.stringify(res.data)}`));
          }
        },
        fail: (err) => {
          console.error('[simulatePayment] network error:', err);
          reject(err);
        }
      });
    });
  },

  // ── GET PAYMENT STATUS (vía Edge Function get-payment-status) ────
  // Chequeo liviano de una fila de `payments` por out_trade_no, sin PII.
  // Existe para confirmar que un pago se proceso sin depender de
  // `clients.paid` -- necesario en renovaciones anticipadas, donde
  // complete-payment deja `clients` sin tocar hasta que el cron diario lo
  // aplica (ver RENEWAL_PLAN.md).
  getPaymentStatus({ outTradeNo }) {
    return new Promise((resolve, reject) => {
      wx.request({
        url: `${config.SUPABASE_URL}/functions/v1/get-payment-status`,
        method: 'POST',
        header: { 'Content-Type': 'application/json' },
        data: { out_trade_no: outTradeNo },
        success: (res) => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(res.data);
          } else {
            console.error('[getPaymentStatus] failed:', res.statusCode, res.data);
            reject(new Error(`getPaymentStatus error ${res.statusCode}: ${JSON.stringify(res.data)}`));
          }
        },
        fail: (err) => {
          console.error('[getPaymentStatus] network error:', err);
          reject(err);
        }
      });
    });
  },

  // ── MENU ROTATION (rotación de 2 meses) ─────────────────────────
  // Cada menú dura 1 mes calendario. El cambio ocurre el primer día hábil
  // (lunes a viernes) de cada mes -- puede caer en medio de una semana de
  // entrega si el mes no arranca en lunes. `menu_rotation_anchor` es
  // cualquier fecha dentro del mes que inicia el ciclo.
  // `menu_rotation_order` tiene 2 elementos.
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

  // Calcula a qué week_index corresponde una fecha real de entrega, según
  // la rotación mensual del menú (anchor + order alternan cada 2 meses).
  // Antes esto reconstruía la fecha a partir de un weekKey ('mon'..'fri') +
  // una semana de referencia porque el cliente elegía un template Lun-Vie
  // fijo, no fechas puntuales -- ahora que cada día de entrega ya es una
  // fecha real (calendario propio, ver pages/start-date), no hace falta
  // reconstruir nada: alcanza con ubicar esa fecha en su "mes de menú".
  getWeekIndexForDay(dateStr, anchor, order) {
    if (!anchor || !order || order.length !== 2) return 1;

    // Devuelve el primer día hábil (lunes a viernes) del mes dado (year, month 0-based)
    const firstBusinessDayOfMonth = (year, month) => {
      const d = new Date(year, month, 1);
      const dow = d.getDay();
      const offset = dow === 0 ? 1 : dow === 6 ? 2 : 0;
      return new Date(year, month, 1 + offset);
    };

    // Devuelve {year, month} del "mes de menú" al que pertenece una fecha.
    // Si la fecha cae antes del primer día hábil del mes, pertenece al mes anterior.
    const menuMonthOf = (date) => {
      const y = date.getFullYear();
      const m = date.getMonth();
      if (date < firstBusinessDayOfMonth(y, m)) {
        return m === 0 ? { year: y - 1, month: 11 } : { year: y, month: m - 1 };
      }
      return { year: y, month: m };
    };

    const targetDate = new Date(dateStr + 'T00:00:00');
    const anchorDate = new Date(anchor + 'T00:00:00');
    const anchorMenu = menuMonthOf(anchorDate);
    const targetMenu = menuMonthOf(targetDate);

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

  // Abre el PDF del menu completo. Vivia solo en tiers.js; ahora tambien lo
  // usa order-summary, asi que la logica (bajar + abrir + los tres errores
  // posibles) queda en un solo lugar.
  //
  // Elige el folleto segun el idioma del dispositivo: `brochure_cn` en chino,
  // `brochure_en` en el resto. Antes pedia siempre `brochure_en`, asi que a
  // un usuario en chino se le abria el PDF en ingles aunque el folleto en
  // chino estuviera cargado.
  openBrochure() {
    const t = require('./i18n/index');
    let key = 'brochure_en';
    try {
      const lang = wx.getAppBaseInfo().language || 'en';
      if (lang.startsWith('zh')) key = 'brochure_cn';
    } catch (e) {}

    wx.showLoading({ title: t('loading') });
    return this.supabase('GET', 'settings', null, `key=eq.${key}`)
      .then((data) => {
        wx.hideLoading();
        const url = data && data.length > 0 ? data[0].value : '';
        if (!url) {
          wx.showToast({ title: t('brochure_not_found'), icon: 'none' });
          return;
        }
        wx.downloadFile({
          url,
          success: (res) => {
            wx.openDocument({
              filePath: res.tempFilePath,
              showMenu: true,
              fail: (err) => {
                console.error('openDocument error:', err);
                wx.showToast({ title: err.errMsg || t('failed_open'), icon: 'none' });
              },
            });
          },
          fail: (err) => {
            console.error('downloadFile error:', err);
            wx.showToast({ title: err.errMsg || t('failed_download'), icon: 'none' });
          },
        });
      })
      .catch(() => {
        wx.hideLoading();
        wx.showToast({ title: t('failed_load'), icon: 'none' });
      });
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

  // ── ADDRESS CHANGES (vía Edge Functions get-address-changes /
  //    submit-address-change) ──────────────────────────────────
  // Reemplaza el GET/PATCH/POST directo a /rest/v1/address_changes con la
  // anon key: esa tabla no tiene (ni debe tener) SELECT abierto a anon,
  // porque expone direcciones (vieja y nueva) de cualquier cliente.
  getAddressChanges({ clientId }) {
    return new Promise((resolve, reject) => {
      wx.request({
        url: `${config.SUPABASE_URL}/functions/v1/get-address-changes`,
        method: 'POST',
        header: { 'Content-Type': 'application/json' },
        data: { clientId },
        success: (res) => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(res.data);
          } else {
            console.error('[getAddressChanges] failed:', res.statusCode, res.data);
            reject(new Error(`getAddressChanges error ${res.statusCode}: ${JSON.stringify(res.data)}`));
          }
        },
        fail: (err) => {
          console.error('[getAddressChanges] network error:', err);
          reject(err);
        }
      });
    });
  },

  submitAddressChange({ clientId, oldDistrict, oldAddress, newDistrict, newAddress }) {
    return new Promise((resolve, reject) => {
      wx.request({
        url: `${config.SUPABASE_URL}/functions/v1/submit-address-change`,
        method: 'POST',
        header: { 'Content-Type': 'application/json' },
        data: { clientId, oldDistrict, oldAddress, newDistrict, newAddress },
        success: (res) => {
          if (res.statusCode >= 200 && res.statusCode < 300 && res.data && res.data.ok) {
            resolve(res.data.change);
          } else {
            console.error('[submitAddressChange] failed:', res.statusCode, res.data);
            reject(new Error(`submitAddressChange error: ${JSON.stringify(res.data)}`));
          }
        },
        fail: (err) => {
          console.error('[submitAddressChange] network error:', err);
          reject(err);
        }
      });
    });
  },

  // ── NOTIFICATIONS (vía Edge Functions get-notifications /
  //    mark-notification-read) ───────────────────────────────────
  // Mismo motivo: notifications.message puede incluir datos sensibles (ej.
  // la direccion nueva cuando se aprueba un cambio), asi que ya no queda
  // SELECT abierto a anon.
  getNotifications({ clientId }) {
    return new Promise((resolve, reject) => {
      wx.request({
        url: `${config.SUPABASE_URL}/functions/v1/get-notifications`,
        method: 'POST',
        header: { 'Content-Type': 'application/json' },
        data: { clientId },
        success: (res) => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(res.data);
          } else {
            console.error('[getNotifications] failed:', res.statusCode, res.data);
            reject(new Error(`getNotifications error ${res.statusCode}: ${JSON.stringify(res.data)}`));
          }
        },
        fail: (err) => {
          console.error('[getNotifications] network error:', err);
          reject(err);
        }
      });
    });
  },

  markNotificationRead({ id }) {
    return new Promise((resolve, reject) => {
      wx.request({
        url: `${config.SUPABASE_URL}/functions/v1/mark-notification-read`,
        method: 'POST',
        header: { 'Content-Type': 'application/json' },
        data: { id },
        success: (res) => {
          if (res.statusCode >= 200 && res.statusCode < 300 && res.data && res.data.ok) {
            resolve(res.data);
          } else {
            console.error('[markNotificationRead] failed:', res.statusCode, res.data);
            reject(new Error(`markNotificationRead error: ${JSON.stringify(res.data)}`));
          }
        },
        fail: (err) => {
          console.error('[markNotificationRead] network error:', err);
          reject(err);
        }
      });
    });
  },

  // ── SUPABASE HELPER ──────────────────────────────────────────
  // Guarda el set COMPLETO de comidas de un cliente. Vivia duplicada, palabra
  // por palabra, en edit-meals.js y en payment.js -- y ya hubo que arreglar
  // el mismo bug dos veces (ver el comentario de abajo sobre el DELETE).
  //
  // `deferToPending`: si el ciclo actual del cliente todavia corre, estas
  // elecciones son del ciclo SIGUIENTE y van a pending_meal_selections; el
  // cron las aplica el dia que arranca. Escribirlas en meal_selections
  // pisaria la semana que la cocina esta preparando ahora mismo.
  //
  // Reemplaza el set entero en vez de hacer GET-then-PATCH-or-POST por
  // fecha: con fechas reales, una renovacion nunca matchea las filas del
  // ciclo anterior, asi que se acumulaban 5 filas mas por renovacion en vez
  // de reemplazarse. Para un cliente nuevo el DELETE es un no-op.
  // Guarda el set COMPLETO de comidas de un cliente, a traves de la Edge
  // Function save-meal-selections (service_role del lado del servidor).
  //
  // Antes esto hacia DELETE + POST directo a /rest/v1/meal_selections con la
  // anon key, y estaba roto en silencio: la tabla le da a anon INSERT y
  // UPDATE pero el DELETE esta restringido a is_admin(), y PostgREST
  // responde 204 igual cuando RLS no deja borrar nada. El DELETE no borraba,
  // el codigo creia que si, y reescribir las mismas fechas explotaba con
  // 409 duplicate key contra UNIQUE(client_id, day, slot) -- el error que
  // aparecia al rehacer un alta despues de "start over". Con fechas nuevas
  // no explotaba, pero dejaba las filas viejas acumulandose.
  //
  // `from`/`to` acotan el reemplazo a un rango de fechas. Sin ellos se
  // reemplaza el set completo del cliente, que es lo que corresponde cuando
  // las selecciones SON el ciclo entero (alta nueva y renovacion). Con ellos
  // se reemplaza solo ese tramo, para que editar un ciclo no borre las filas
  // de otro (ver edit-meals.js).
  saveMealSelections(clientId, allSelections, { deferToPending = false, from = null, to = null } = {}) {
    return new Promise((resolve, reject) => {
      wx.request({
        url: `${config.SUPABASE_URL}/functions/v1/save-meal-selections`,
        method: 'POST',
        // Esta funcion si exige la anon key (verify_jwt), a diferencia del
        // resto de las functions del proyecto, que estan abiertas.
        header: {
          'Content-Type': 'application/json',
          'apikey': config.SUPABASE_KEY,
          'Authorization': `Bearer ${config.SUPABASE_KEY}`,
        },
        data: { clientId, selections: allSelections, deferToPending, from, to },
        success: (res) => {
          if (res.statusCode >= 200 && res.statusCode < 300 && res.data && res.data.ok) {
            resolve(res.data);
          } else {
            console.error('[saveMealSelections] failed:', res.statusCode, res.data);
            reject(new Error(`saveMealSelections error: ${JSON.stringify(res.data)}`));
          }
        },
        fail: (err) => {
          console.error('[saveMealSelections] network error:', err);
          reject(err);
        },
      });
    });
  },

  // Trae un plan por id y lo deja en storage como `selectedPlan`, que es de
  // donde lo leen order-summary, payment y meal-select. Devuelve el plan, o
  // null si no hay planId o no existe. El mismo bloque de 4 lineas estaba
  // repetido en discovery.js (x2) y register.js (x2), siempre para retomar
  // un flujo a medio terminar.
  async cacheSelectedPlan(planId) {
    if (!planId) return null;
    const planData = await this.supabase('GET', 'plans', null, `id=eq.${planId}`);
    if (!planData || planData.length === 0) return null;
    const plan = this.getDisplayPlan(planData[0]);
    wx.setStorageSync('selectedPlan', plan);
    return plan;
  },

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
