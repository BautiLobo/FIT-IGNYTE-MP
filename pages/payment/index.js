// pages/payment/index.js
const app = getApp();
const { getMinStartDate } = require('../../utils/business-days');
const t = require('../../i18n/index');

Page({
  data: {
    order: null,
    client: null,
    selectedPlan: null,
    total: 0,
    deliveryFee: 0,
    fromRenewal: false,
    deferToPending: false,
    submitting: false,
    // Referral code
    referralInput: '',
    referralApplied: false,
    referralCode: '',
    referralDiscount: 0,
    referralAlreadyUsed: false,
    referralChecking: false,
    lbl_title: '',
    lbl_order_summary: '',
    lbl_plan: '',
    lbl_meals_day: '',
    lbl_plan_price: '',
    lbl_first_week: '',
    lbl_delivery: '',
    lbl_total: '',
    lbl_method: '',
    lbl_wechat_pay: '',
    lbl_tap_to_pay: '',
    lbl_renewal_note: '',
    lbl_referral_label: '',
    lbl_referral_placeholder: '',
    lbl_referral_apply: '',
    lbl_referral_row: '',
    lbl_referral_applied: '',
    lbl_contact_btn: '',
  },

  async onLoad(options) {
    const fromRenewal = options.from === 'renewal';
    const selectedPlan = wx.getStorageSync('selectedPlan');

    if (!selectedPlan) {
      wx.navigateBack();
      return;
    }

    // Cargamos cliente/orden primero -- hace falta antes de poder chequear
    // si el start_date sigue siendo válido (ver más abajo), y se reusa
    // después para el resto de la pantalla en vez de pedirlo de nuevo.
    let client = null;
    let order = null;
    let deferToPending = false;
    try {
      if (fromRenewal) {
        const clientId = wx.getStorageSync('clientId');
        const data = await app.getClient({ clientId });
        if (data && data.length > 0) {
          client = data[0];
          // Renovacion anticipada (ver RENEWAL_PLAN.md): si el plan ACTUAL
          // del cliente (el de antes de esta renovacion) todavia no vencio,
          // las selecciones de "choose new meals" (que se guardan aca, no en
          // meal-select.js) tienen que ir a pending_meal_selections, no a
          // meal_selections -- misma razon que en edit-meals.js.
          const today = new Date(); today.setHours(0, 0, 0, 0);
          const currentExpiry = client.expiry_date ? new Date(client.expiry_date + 'T00:00:00') : null;
          deferToPending = !!(currentExpiry && today <= currentExpiry);
        }
      } else {
        const pendingOrderId = wx.getStorageSync('pendingOrderId');
        if (!pendingOrderId) return;
        const data = await app.getOrder({ orderId: pendingOrderId });
        if (data && data.length > 0) {
          order = data[0];
          // El cliente ya existe (se crea al aprobar la orden): lo buscamos
          // por teléfono para saber si ya gastó un código de referido antes.
          const clientData = await app.getClient({ phone: order.phone });
          if (clientData && clientData.length > 0) client = clientData[0];
        }
      }
    } catch (err) {
      console.error('Load error:', err);
    }

    // Fecha vencida: el start_date se elige mucho antes de pagar (antes de
    // la aprobación del admin, en el caso de un alta nueva) y nada lo
    // revalidaba al momento de pagar -- si pasó suficiente tiempo, esa
    // fecha puede haber quedado en el pasado, o el menú de esos días puede
    // haber cambiado. Se recalcula la fecha mínima "en vivo" (misma regla
    // que start-date.js) y si la guardada ya no la cumple, mandamos al
    // cliente a elegir fecha y comidas de nuevo en vez de dejarlo pagar
    // sobre datos viejos.
    //
    // La fuente de verdad es `order.start_date` (lo que quedó guardado en
    // la orden), no el storage local: si un pedido queda rechazado y el
    // admin lo vuelve a aprobar mucho después, el storage del dispositivo
    // puede no reflejar más la fecha real (o directamente no existir).
    // Confiar solo en el storage hacía que ese chequeo se salteara en
    // silencio y `payNow()` cayera al fallback de "hoy".
    const storedStart = (!fromRenewal && order && order.start_date) || wx.getStorageSync('startDate');
    if (storedStart && !fromRenewal) wx.setStorageSync('startDate', storedStart);
    if (storedStart) {
      const liveMin = getMinStartDate({ currentExpiryDate: fromRenewal && client ? client.expiry_date : null });
      if (storedStart < liveMin) {
        if (fromRenewal) {
          // Mismo flag que usa "choose new meals" en renewal.js: fuerza a
          // arrancar en blanco en vez de precargar lo que el cliente comía
          // antes, porque esas comidas pueden ya no estar en el menú de las
          // fechas nuevas.
          wx.setStorageSync('renewalFreshMeals', true);
          wx.removeStorageSync('mealSelections');
        }
        wx.setStorageSync('dateResync', true);
        wx.showModal({
          title: t('payment_date_stale_title'),
          content: t('payment_date_stale_body'),
          showCancel: false,
          success: () => {
            const url = fromRenewal
              ? '/pages/start-date/index?from=renewal&next=meal-select'
              : '/pages/start-date/index?next=meal-select';
            wx.redirectTo({ url });
          },
        });
        return;
      }
    }

    this.setData({
      lbl_title: t('payment_title'),
      lbl_order_summary: t('payment_order_summary'),
      lbl_plan: t('payment_plan'),
      lbl_meals_day: t('payment_meals_day'),
      lbl_plan_price: t('payment_plan_price'),
      lbl_first_week: t('payment_first_week'),
      lbl_delivery: t('payment_delivery'),
      lbl_total: t('payment_total'),
      lbl_method: t('payment_method'),
      lbl_wechat_pay: t('payment_wechat_pay'),
      lbl_tap_to_pay: t('payment_tap_to_pay'),
      lbl_renewal_note: t('payment_renewal_note'),
      lbl_referral_label: t('payment_referral_label'),
      lbl_referral_placeholder: t('payment_referral_placeholder'),
      lbl_referral_apply: t('payment_referral_apply'),
      lbl_referral_row: t('payment_referral_row'),
      lbl_referral_applied: t('payment_referral_applied'),
      lbl_contact_btn: t('payment_contact_btn'),
    });

    // El fee real lo define el admin al aprobar la orden (ver panel FIT-IGNYTE)
    // y queda en clients.delivery_fee -- misma fuente que usa create-payment
    // del lado del servidor para calcular el monto que realmente se cobra.
    // El fallback a 35 es solo por si un cliente viejo quedara sin el campo.
    const deliveryFee = (client && client.delivery_fee != null) ? client.delivery_fee : 35;
    const planPrice = selectedPlan.price || 0;
    const discount = fromRenewal ? 0 : Math.round(planPrice * 0.25);
    const total = planPrice - discount + deliveryFee;
    this.setData({ selectedPlan, total, fromRenewal, discount, deliveryFee });

    if (fromRenewal) {
      // En renovación, `order` es directamente la fila de clients: ahí ya
      // está el flag referral_used del pago anterior.
      this.setData({ order: client, client, referralAlreadyUsed: !!(client && client.referral_used), deferToPending });
    } else if (order) {
      this.setData({ order, client, referralAlreadyUsed: !!(client && client.referral_used) });
    }
  },

  onReferralInput(e) {
    this.setData({ referralInput: e.detail.value });
  },

  async applyReferral() {
    const code = (this.data.referralInput || '').trim().toLowerCase();
    if (!code) return;
    if (this.data.referralChecking || this.data.referralApplied) return;

    this.setData({ referralChecking: true });
    try {
      const data = await app.supabase('GET', 'coaches', null, `code=eq.${encodeURIComponent(code)}`);
      if (!data || data.length === 0) {
        wx.showToast({ title: t('payment_referral_invalid'), icon: 'none' });
        return;
      }

      const { selectedPlan, discount, deliveryFee } = this.data;
      const planPrice = selectedPlan.price || 0;
      const baseTotal = planPrice - discount + deliveryFee;
      const referralDiscount = Math.round(baseTotal * 0.10);
      const total = baseTotal - referralDiscount;

      this.setData({
        referralApplied: true,
        referralCode: code,
        referralDiscount,
        total,
      });
      wx.showToast({ title: t('payment_referral_success'), icon: 'success' });
    } catch (err) {
      console.error('applyReferral error:', err);
      wx.showToast({ title: t('payment_referral_invalid'), icon: 'none' });
    } finally {
      this.setData({ referralChecking: false });
    }
  },

  getExpiryDate() {
    // Use stored expiry date from start-date page if available
    const stored = wx.getStorageSync('expiryDate');
    if (stored) return stored;
    // Fallback: 5 business days from today
    const d = new Date();
    let added = 0;
    while (added < 4) {
      d.setDate(d.getDate() + 1);
      const day = d.getDay();
      if (day !== 0 && day !== 6) added++;
    }
    return d.toISOString().split('T')[0];
  },

  async payNow() {
    // Guard contra doble-tap: sin esto, tocar "Pagar" dos veces rápido podía
    // disparar dos create-payment casi simultáneos.
    if (this.data.submitting) return;

    const { fromRenewal, selectedPlan, referralApplied, referralCode, client } = this.data;

    if (!client || !client.id) {
      wx.showModal({ title: t('payment_error_title'), content: t('payment_error_content'), showCancel: false });
      return;
    }

    this.setData({ submitting: true });
    wx.showLoading({ title: t('loading') });
    try {
      // El pago JSAPI de WeChat exige el openid del pagador; si todavía no
      // lo capturamos para este cliente, lo resolvemos ahora antes de pagar.
      let clientId = client.id;
      if (!client.wechat_openid) {
        await app.captureOpenid(clientId);
      }

      const nextFriday = this.getExpiryDate();
      const expiryDate = wx.getStorageSync('expiryDate') || nextFriday;
      const startDate = wx.getStorageSync('startDate') || new Date().toISOString().split('T')[0];
      const cutlery = wx.getStorageSync('cutleryNeeded') === true;
      const pendingOrderId = fromRenewal ? undefined : wx.getStorageSync('pendingOrderId');

      const payment = await app.createPayment({
        type: fromRenewal ? 'renewal' : 'new',
        clientId,
        pendingOrderId,
        planId: selectedPlan.id,
        startDate,
        expiryDate,
        cutlery,
        referralCode: referralApplied ? referralCode : undefined,
      });

      wx.hideLoading();

      // Solo dev/local (ver config.js `SIMULATE_PAYMENTS`): saltea WeChat
      // Pay de verdad y marca el pago como pagado directo del lado del
      // servidor (dev-simulate-payment), que igual lo rechaza si el
      // secret correspondiente no está activo en Supabase.
      if (app.globalData.simulatePayments) {
        try {
          await app.simulatePayment({ outTradeNo: payment.outTradeNo });
          wx.navigateTo({ url: '/pages/pay-processing/index' });
          this.finishAfterPayment(clientId, payment.outTradeNo);
        } catch (simErr) {
          console.error('simulatePayment failed:', simErr);
          wx.showModal({ title: t('payment_error_title'), content: simErr.message || t('payment_error_content'), showCancel: false });
          this.setData({ submitting: false });
        }
        return;
      }

      wx.requestPayment({
        timeStamp: payment.timeStamp,
        nonceStr: payment.nonceStr,
        package: payment.package,
        signType: payment.signType,
        paySign: payment.paySign,
        success: () => {
          wx.navigateTo({ url: '/pages/pay-processing/index' });
          this.finishAfterPayment(clientId, payment.outTradeNo);
        },
        fail: (err) => {
          console.error('wx.requestPayment failed:', err);
          if (err.errMsg && err.errMsg.indexOf('cancel') === -1) {
            wx.showModal({ title: t('payment_error_title'), content: t('payment_error_content'), showCancel: false });
          }
          this.setData({ submitting: false });
        },
      });
    } catch (err) {
      wx.hideLoading();
      console.error('payNow error:', err);
      this.setData({ submitting: false });
      // Renovación anticipada duplicada (ver RENEWAL_PLAN.md, decisión 6):
      // no debería llegar acá con el botón ya oculto en Home, pero por las
      // dudas mostramos un mensaje claro en vez del genérico.
      if (err.code === 'duplicate_pending_renewal') {
        wx.showModal({ title: t('payment_error_title'), content: t('payment_already_renewed'), showCancel: false });
        return;
      }
      wx.showModal({ title: t('payment_error_title'), content: err.message || t('payment_error_content'), showCancel: false });
    }
  },

  // El pago ya se confirmó del lado del usuario en wx.requestPayment(), pero
  // quien realmente activa al cliente es el webhook de WeChat Pay (server to
  // server), que puede tardar un segundo en llegar. Esperamos confirmación
  // antes de navegar, y guardamos las selecciones de comida mientras tanto.
  async finishAfterPayment(clientId, outTradeNo) {
    const { fromRenewal } = this.data;

    try {
      if (fromRenewal) {
        const mealSelections = wx.getStorageSync('mealSelections');
        if (mealSelections) {
          await this.saveMealSelections(clientId, mealSelections);
        }
      } else {
        const pendingOrderId = wx.getStorageSync('pendingOrderId');
        const orderData = pendingOrderId ? await app.getOrder({ orderId: pendingOrderId }) : null;
        const order = orderData && orderData.length > 0 ? orderData[0] : null;
        if (order && order.meals && Object.keys(order.meals).length > 0) {
          await this.saveMealSelections(clientId, order.meals);
        }
      }

      await this.waitForPaymentConfirmation(clientId, outTradeNo);

      wx.removeStorageSync('mealSelections');
      wx.removeStorageSync('startDate');
      wx.removeStorageSync('expiryDate');
      wx.removeStorageSync('cutleryNeeded');

      if (fromRenewal) {
        wx.showToast({ title: t('payment_renewed'), icon: 'success' });
        setTimeout(() => wx.reLaunch({ url: '/pages/home/index' }), 800);
      } else {
        wx.setStorageSync('clientId', clientId);
        wx.removeStorageSync('pendingOrderId');
        wx.removeStorageSync('selectedPlan');
        wx.reLaunch({ url: '/pages/welcome/index' });
      }
    } catch (err) {
      console.error('finishAfterPayment error:', err);
      wx.showModal({
        title: t('payment_error_title'),
        content: err.message || t('payment_error_content'),
        showCancel: false,
      });
    }
  },

  // Sondea hasta ~10s que el webhook de WeChat Pay ya proceso el pago. El
  // pago ya se hizo (WeChat lo confirmó en wx.requestPayment); esto solo
  // espera a que el servidor lo refleje. Si tarda más, seguimos igual — el
  // webhook lo va a dejar consistente en cuanto llegue, aunque el usuario
  // ya haya navegado.
  //
  // Renovación anticipada (deferToPending=true): complete-payment no toca
  // `clients` en ese caso (queda para el cron diario, ver RENEWAL_PLAN.md),
  // así que `clients.paid` nunca refleja este pago puntual. Se sondea en
  // cambio `payments.status` por out_trade_no (get-payment-status), que sí
  // se pone en 'paid' apenas el webhook lo procesa, sin importar si
  // complete-payment aplicó o difirió el resto.
  waitForPaymentConfirmation(clientId, outTradeNo) {
    const { deferToPending } = this.data;
    return new Promise((resolve) => {
      let attempts = 0;
      const check = async () => {
        attempts++;
        try {
          if (deferToPending && outTradeNo) {
            const payment = await app.getPaymentStatus({ outTradeNo });
            if (payment && payment.status === 'paid') {
              resolve();
              return;
            }
          } else {
            const data = await app.getClient({ clientId });
            if (data && data.length > 0 && data[0].paid) {
              resolve();
              return;
            }
          }
        } catch (err) {
          console.error('waitForPaymentConfirmation error:', err);
        }
        if (attempts >= 10) { resolve(); return; }
        setTimeout(check, 1000);
      };
      check();
    });
  },

  // Persiste las selecciones de meal-select en meal_selections — necesario
  // porque, a diferencia de edit-meals (que escribe directo a la tabla),
  // meal-select solo guarda en wx.storage y dependía de que algo más lo
  // sincronizara más adelante en el flujo de renovación.
  async saveMealSelections(clientId, allSelections) {
    // Renovacion anticipada (ver RENEWAL_PLAN.md, Causa Raiz #3): si el plan
    // actual del cliente todavia esta activo, no escribir en meal_selections
    // -- pisaria la semana que la cocina ya esta preparando. Se escribe en
    // pending_meal_selections y el cron la aplica el dia que corresponde.
    const table = this.data.deferToPending ? 'pending_meal_selections' : 'meal_selections';
    const dayMap = { mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday' };
    for (const key in dayMap) {
      const label = dayMap[key];
      const sel = allSelections[key];
      if (!sel || !sel.meal_ids || sel.meal_ids.length === 0) continue;
      const existing = await app.supabase('GET', table, null, `client_id=eq.${clientId}&day=eq.${label}&slot=eq.1`);
      const payload = {
        client_id: clientId,
        day: label,
        slot: 1,
        meals_json: sel.meal_ids,
        delivery_time: sel.time,
        note: sel.notes || '',
      };
      if (existing && existing.length > 0) {
        await app.supabase('PATCH', table, payload, `client_id=eq.${clientId}&day=eq.${label}&slot=eq.1`);
      } else {
        await app.supabase('POST', table, payload);
      }
    }
  },

  goBack() {
    wx.navigateBack();
  },

  contactUs() {
    wx.showModal({
      title: t('payment_contact_title'),
      content: t('payment_contact_content'),
      showCancel: false,
      confirmText: 'OK',
    });
  },
});
