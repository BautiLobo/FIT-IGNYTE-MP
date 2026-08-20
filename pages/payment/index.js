// pages/payment/index.js
const app = getApp();
const t = require('../../i18n/index');

Page({
  data: {
    order: null,
    client: null,
    selectedPlan: null,
    total: 0,
    fromRenewal: false,
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
  },

  async onLoad(options) {
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
    });
    const fromRenewal = options.from === 'renewal';
    const selectedPlan = wx.getStorageSync('selectedPlan');

    if (!selectedPlan) {
      wx.navigateBack();
      return;
    }

    const planPrice = selectedPlan.price || 0;
    const discount = fromRenewal ? 0 : Math.round(planPrice * 0.25);
    const total = planPrice - discount + 0; // TEMP: delivery fee en 0 para pruebas — volver a 35
    this.setData({ selectedPlan, total, fromRenewal, discount });

    try {
      if (fromRenewal) {
        const clientId = wx.getStorageSync('clientId');
        const data = await app.getClient({ clientId });
        if (data && data.length > 0) {
          // En renovación, `order` es directamente la fila de clients:
          // ahí ya está el flag referral_used del pago anterior.
          this.setData({ order: data[0], client: data[0], referralAlreadyUsed: !!data[0].referral_used });
        }
      } else {
        const pendingOrderId = wx.getStorageSync('pendingOrderId');
        if (!pendingOrderId) return;
        const data = await app.getOrder({ orderId: pendingOrderId });
        if (data && data.length > 0) {
          const order = data[0];
          this.setData({ order });
          // El cliente ya existe (se crea al aprobar la orden): lo buscamos
          // por teléfono para saber si ya gastó un código de referido antes.
          const clientData = await app.getClient({ phone: order.phone });
          if (clientData && clientData.length > 0) {
            this.setData({ client: clientData[0], referralAlreadyUsed: !!clientData[0].referral_used });
          }
        }
      }
    } catch (err) {
      console.error('Load error:', err);
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

      const { selectedPlan, discount } = this.data;
      const planPrice = selectedPlan.price || 0;
      const baseTotal = planPrice - discount + 0; // TEMP: delivery fee en 0 para pruebas — volver a 35
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
    const { fromRenewal, selectedPlan, referralApplied, referralCode, client } = this.data;

    if (!client || !client.id) {
      wx.showModal({ title: t('payment_error_title'), content: t('payment_error_content'), showCancel: false });
      return;
    }

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

      wx.requestPayment({
        timeStamp: payment.timeStamp,
        nonceStr: payment.nonceStr,
        package: payment.package,
        signType: payment.signType,
        paySign: payment.paySign,
        success: () => {
          wx.navigateTo({ url: '/pages/pay-processing/index' });
          this.finishAfterPayment(clientId);
        },
        fail: (err) => {
          console.error('wx.requestPayment failed:', err);
          if (err.errMsg && err.errMsg.indexOf('cancel') === -1) {
            wx.showModal({ title: t('payment_error_title'), content: t('payment_error_content'), showCancel: false });
          }
        },
      });
    } catch (err) {
      wx.hideLoading();
      console.error('payNow error:', err);
      wx.showModal({ title: t('payment_error_title'), content: err.message || t('payment_error_content'), showCancel: false });
    }
  },

  // El pago ya se confirmó del lado del usuario en wx.requestPayment(), pero
  // quien realmente activa al cliente es el webhook de WeChat Pay (server to
  // server), que puede tardar un segundo en llegar. Esperamos a que
  // clients.paid se ponga en true antes de navegar, y guardamos las
  // selecciones de comida mientras tanto.
  async finishAfterPayment(clientId) {
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

      await this.waitForPaymentConfirmation(clientId);

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

  // Sondea clients.paid hasta ~10s. El pago ya se hizo (WeChat lo confirmó
  // en wx.requestPayment); esto solo espera a que el webhook lo refleje en
  // la base. Si tarda más, seguimos igual — el webhook lo va a dejar
  // consistente en cuanto llegue, aunque el usuario ya haya navegado.
  waitForPaymentConfirmation(clientId) {
    return new Promise((resolve) => {
      let attempts = 0;
      const check = async () => {
        attempts++;
        try {
          const data = await app.getClient({ clientId });
          if (data && data.length > 0 && data[0].paid) {
            resolve();
            return;
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
    const dayMap = { mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday' };
    for (const key in dayMap) {
      const label = dayMap[key];
      const sel = allSelections[key];
      if (!sel || !sel.meal_ids || sel.meal_ids.length === 0) continue;
      const existing = await app.supabase('GET', 'meal_selections', null, `client_id=eq.${clientId}&day=eq.${label}&slot=eq.1`);
      const payload = {
        client_id: clientId,
        day: label,
        slot: 1,
        meals_json: sel.meal_ids,
        delivery_time: sel.time,
        note: sel.notes || '',
      };
      if (existing && existing.length > 0) {
        await app.supabase('PATCH', 'meal_selections', payload, `client_id=eq.${clientId}&day=eq.${label}&slot=eq.1`);
      } else {
        await app.supabase('POST', 'meal_selections', payload);
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
