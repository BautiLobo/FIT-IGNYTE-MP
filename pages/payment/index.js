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
    const total = planPrice - discount + 35;
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
        const data = await app.supabase('GET', 'new_orders', null, `id=eq.${pendingOrderId}`);
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
      const baseTotal = planPrice - discount + 35;
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

  payNow() {
    // Simulate payment — replace with real WeChat Pay when AppSecret is ready
    wx.showModal({
      title: t('payment_simulate_title'),
      content: t('payment_simulate_content'),
      confirmText: t('payment_simulate_yes'),
      cancelText: t('payment_simulate_cancel'),
      success: (res) => {
        if (res.confirm) {
          wx.navigateTo({ url: '/pages/pay-processing/index' });
          setTimeout(() => this.handlePaymentSuccess(), 1500);
        }
      }
    });
  },

  async handlePaymentSuccess() {
    const { fromRenewal, selectedPlan, referralApplied, referralCode } = this.data;
    const nextFriday = this.getExpiryDate();
    const clientId = wx.getStorageSync('clientId');

    try {
      if (fromRenewal) {
        const expiryDate = wx.getStorageSync('expiryDate') || nextFriday;
        const startDate = wx.getStorageSync('startDate') || new Date().toISOString().split('T')[0];
        const realStatus = app.getRealStatus(startDate, expiryDate);
        const cutlery = wx.getStorageSync('cutleryNeeded') === true;
        await app.completePayment({
          type: 'renewal',
          clientId,
          status: realStatus,
          start_date: startDate,
          expiry_date: expiryDate,
          plan_id: selectedPlan.id,
          cutlery,
          referralCode: referralApplied ? referralCode : undefined,
        });

        const mealSelections = wx.getStorageSync('mealSelections');
        if (mealSelections) {
          await this.saveMealSelections(clientId, mealSelections);
        }

        wx.removeStorageSync('mealSelections');
        wx.removeStorageSync('expiryDate');
        wx.removeStorageSync('startDate');
        wx.showToast({ title: t('payment_renewed'), icon: 'success' });
        setTimeout(() => wx.reLaunch({ url: '/pages/home/index' }), 1000);

      } else {
        const pendingOrderId = wx.getStorageSync('pendingOrderId');
        const orderData = await app.supabase('GET', 'new_orders', null, `id=eq.${pendingOrderId}`);

        if (!orderData || orderData.length === 0) {
          throw new Error('Order not found — cannot complete payment.');
        }

        const order = orderData[0];
        const clientData = await app.getClient({ phone: order.phone });

        if (!clientData || clientData.length === 0) {
          throw new Error('Client not found for this order.');
        }

        const newClientId = clientData[0].id;
        // Marcar order como paid + activar cliente (vía Edge Function con
        // service_role — un PATCH directo con la anon key matcheaba 0 filas
        // porque `clients` no tiene policy de SELECT para anon, y Postgres
        // necesita que la fila sea visible para poder matchear el WHERE de
        // un UPDATE, aun cuando la policy de UPDATE es permisiva).
        const startDate = wx.getStorageSync('startDate') || new Date().toISOString().split('T')[0];
        const realStatus = app.getRealStatus(startDate, nextFriday);
        const cutlery = wx.getStorageSync('cutleryNeeded') === true;
        await app.completePayment({
          type: 'new',
          clientId: newClientId,
          pendingOrderId,
          status: realStatus,
          start_date: startDate,
          expiry_date: nextFriday,
          cutlery,
          referralCode: referralApplied ? referralCode : undefined,
        });

        if (order.meals && Object.keys(order.meals).length > 0) {
          await this.saveMealSelections(newClientId, order.meals);
        }

        wx.removeStorageSync('startDate');
        wx.removeStorageSync('expiryDate');
        wx.setStorageSync('clientId', newClientId);
        wx.removeStorageSync('pendingOrderId');
        wx.removeStorageSync('selectedPlan');

        // Solo navegamos si todo lo anterior se completó sin lanzar error
        wx.reLaunch({ url: '/pages/welcome/index' });
      }

    } catch (err) {
      console.error('Payment success handler error:', JSON.stringify(err), err.message);
      wx.showModal({
        title: t('payment_error_title'),
        content: err.message || t('payment_error_content'),
        showCancel: false,
      });
    }
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
