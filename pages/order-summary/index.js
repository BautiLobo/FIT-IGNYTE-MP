// pages/order-summary/index.js
const app = getApp();
const t = require('../../i18n/index');
const { formatShortDate } = require('../../utils/date-format');

const _isZh = (wx.getAppBaseInfo().language || '').startsWith('zh');

Page({
  data: {
    order: null,
    selectedPlan: null,
    mealSummary: [],
    total: 0,
    discount: 0,
    submitting: false,
    fromRenewal: false,
    repay: false,
    lbl_title: '',
    lbl_your_plan: '',
    lbl_meals_day: '',
    lbl_chosen_meals: '',
    lbl_edit: '',
    lbl_address: '',
    lbl_discount: '',
    lbl_delivery: '',
    lbl_delivery_tbc: '',
    lbl_brochure: '',
    deliveryFee: null,
    lbl_submitting: '',
    lbl_place_order: '',
    lbl_continue_payment: '',
    lbl_review_note: '',
    lbl_renewal_note: '',
    lbl_repay_note: '',
  },

  async onLoad(options) {
    this.setData({
      lbl_title: t('order_summary_title'),
      lbl_your_plan: t('order_summary_your_plan'),
      lbl_meals_day: t('order_summary_meals_day'),
      lbl_chosen_meals: t('order_summary_chosen_meals'),
      lbl_edit: t('order_summary_edit'),
      lbl_address: t('order_summary_address'),
      lbl_discount: t('order_summary_discount'),
      lbl_delivery: t('order_summary_delivery'),
      lbl_delivery_tbc: t('order_summary_delivery_tbc'),
      lbl_brochure: t('tiers_brochure'),
      lbl_submitting: t('order_summary_submitting'),
      lbl_place_order: t('order_summary_place_order'),
      lbl_continue_payment: t('order_summary_continue_payment'),
      lbl_review_note: t('order_summary_review_note'),
      lbl_renewal_note: t('order_summary_renewal_note'),
      lbl_repay_note: t('order_summary_repay_note'),
      lbl_total: t('payment_total'),
      lbl_plan: t('payment_plan'),
    });
    const fromRenewal = options.from === 'renewal' || wx.getStorageSync('flowContext') === 'renewal';
    if (fromRenewal) wx.removeStorageSync('flowContext');
    // Alta nueva ya aprobada, re-eligiendo fecha/comidas porque el
    // start_date había quedado vencido al momento de pagar (ver
    // payment.js/meal-select.js) -- la orden ya fue aprobada por el admin,
    // así que "continuar" de acá abajo tiene que ir directo a pagar, no
    // volver a mandarla a revisión.
    const repay = options.from === 'repay';
    const selectedPlan = wx.getStorageSync('selectedPlan');

    if (!selectedPlan) {
      wx.navigateBack();
      return;
    }

    if (fromRenewal) {
      await this.loadRenewalOrder(selectedPlan);
      return;
    }

    const pendingOrderId = wx.getStorageSync('pendingOrderId');
    if (!pendingOrderId) {
      // Cliente ya aprobado (llegó por register.js/discovery.js sin
      // pendingOrderId en este storage -- ver payment.js) repitiendo
      // fecha/comidas por vencimiento: no hay `new_orders` que actualizar,
      // se arma el resumen directo desde `clients` + lo recién elegido.
      if (repay) {
        await this.loadRepayFromClient(selectedPlan);
        return;
      }
      wx.navigateBack();
      return;
    }

    try {
      if (repay) {
        // meal-select/start-date solo dejaron los valores nuevos en
        // storage -- los persistimos en la orden ahora para que el panel
        // admin no quede mostrando la fecha/comidas viejas que ya aprobó.
        const mealSelections = wx.getStorageSync('mealSelections') || {};
        const startDate = wx.getStorageSync('startDate') || null;
        const expiryDate = wx.getStorageSync('expiryDate') || null;
        await app.updateOrder({
          orderId: pendingOrderId,
          patch: { meals: mealSelections, start_date: startDate, expiry_date: expiryDate },
        });
        wx.removeStorageSync('mealSelections');
      }

      const data = await app.getOrder({ orderId: pendingOrderId });
      if (!data || data.length === 0) {
        wx.navigateBack();
        return;
      }

      const order = data[0];
      const mealSummary = await this.buildMealSummary(order.meals || {});
      const planPrice = selectedPlan.price || 0;
      const discount = Math.round(planPrice * 0.25);
      const total = planPrice - discount;

      this.setData({ order, selectedPlan, mealSummary, total, discount, fromRenewal: false, repay });

    } catch (err) {
      console.error('Load order error:', err);
      wx.showToast({ title: t('order_summary_failed'), icon: 'none' });
    }
  },

  async onShow() {
    // Si el usuario edita los meals y vuelve, refrescamos el resumen de renovación
    if (this.data.fromRenewal && this.data.selectedPlan) {
      this.loadRenewalOrder(this.data.selectedPlan);
      return;
    }
    if (!this.data.order) return;
    const pendingOrderId = wx.getStorageSync('pendingOrderId');
    if (!pendingOrderId) {
      // Mismo camino sin orden que onLoad (ver loadRepayFromClient): no hay
      // nada que persistir server-side, solo re-armar el resumen con lo que
      // haya quedado en storage tras volver de editar comidas.
      if (this.data.repay && this.data.selectedPlan) {
        await this.loadRepayFromClient(this.data.selectedPlan);
      }
      return;
    }

    try {
      // Si el usuario edita los meals y vuelve, meal-select dejó los cambios en
      // storage — los persistimos en la orden antes de refrescar.
      const updatedMealSelections = wx.getStorageSync('mealSelections');
      const hasUpdatedMeals = updatedMealSelections && typeof updatedMealSelections === 'object' && Object.keys(updatedMealSelections).length > 0;
      if (hasUpdatedMeals) {
        await app.updateOrder({ orderId: pendingOrderId, patch: { meals: updatedMealSelections } });
        wx.removeStorageSync('mealSelections');
      }

      const data = await app.getOrder({ orderId: pendingOrderId });
      if (data && data.length > 0) {
        const order = data[0];
        const mealSummary = await this.buildMealSummary(order.meals || {});
        this.setData({ order, mealSummary });
      }
    } catch (err) {
      console.error('Refresh order error:', err);
    }
  },

  async loadRenewalOrder(selectedPlan) {
    try {
      const clientId = wx.getStorageSync('clientId');
      const data = await app.getClient({ clientId });
      const order = data && data.length > 0 ? data[0] : null;

      // Sin storage no hay resumen que mostrar: con el camino único, las
      // comidas de la renovación SIEMPRE se acaban de elegir en meal-select
      // y viven acá. Antes, si esto estaba vacío se caía a leer
      // meal_selections (el ciclo viejo) y se seguía hasta el pago con esas
      // comidas, sin mirar cuántas permitía el plan elegido. Ahora se vuelve
      // a elegirlas en vez de arrastrar datos de otro ciclo.
      const mealSelections = wx.getStorageSync('mealSelections') || {};
      if (Object.keys(mealSelections).length === 0) {
        wx.showToast({ title: t('order_summary_failed'), icon: 'none' });
        setTimeout(() => wx.navigateBack(), 1200);
        return;
      }
      const mealSummary = await this.buildMealSummary(mealSelections);

      const planPrice = selectedPlan.price || 0;
      // En una renovación el envío YA está fijado en el cliente (lo puso el
      // admin al aprobar su alta), así que se muestra el monto real en vez
      // de "se confirma al aprobar" -- ese cartel solo tiene sentido la
      // primera vez, cuando la orden todavía no pasó por el admin.
      //
      // Y se suma al total: create-payment cobra planPrice - discount +
      // deliveryFee, así que mostrar solo el plan hacía que el cliente viera
      // un número y se le cobrara otro. Mismo fallback que usa esa función
      // (clients.delivery_fee ?? 35) para que lo mostrado sea exactamente lo
      // que se va a cobrar.
      const deliveryFee = (order && order.delivery_fee != null) ? order.delivery_fee : 35;
      const total = planPrice + deliveryFee;

      this.setData({ order, selectedPlan, mealSummary, total, discount: 0, deliveryFee, fromRenewal: true });

    } catch (err) {
      console.error('Load renewal order error:', err);
      wx.showToast({ title: t('order_summary_failed'), icon: 'none' });
    }
  },

  // Alta nueva ya aprobada (fila en `clients`, status 'Pending Payment')
  // repitiendo fecha/comidas por vencimiento, sin `pendingOrderId` en este
  // storage -- pasa cuando register.js/discovery.js detectan el cliente por
  // openid/clientId en vez de retomar una orden (ver payment.js). No hay
  // `new_orders` que leer ni actualizar: mismo criterio que loadRenewalOrder,
  // usando `clients` como fuente y las selecciones recién elegidas en
  // storage, pero con el descuento de alta nueva (25%), no el de renovación.
  async loadRepayFromClient(selectedPlan) {
    try {
      const clientId = wx.getStorageSync('clientId');
      const data = clientId ? await app.getClient({ clientId }) : null;
      const client = data && data.length > 0 ? data[0] : null;
      if (!client) {
        wx.navigateBack();
        return;
      }

      const mealSelections = wx.getStorageSync('mealSelections') || {};
      if (Object.keys(mealSelections).length === 0) {
        wx.showToast({ title: t('order_summary_failed'), icon: 'none' });
        setTimeout(() => wx.navigateBack(), 1200);
        return;
      }
      const mealSummary = await this.buildMealSummary(mealSelections);

      const planPrice = selectedPlan.price || 0;
      const discount = Math.round(planPrice * 0.25);
      const deliveryFee = client.delivery_fee != null ? client.delivery_fee : 35;
      const total = planPrice - discount + deliveryFee;

      this.setData({ order: client, selectedPlan, mealSummary, total, discount, deliveryFee, fromRenewal: false, repay: true });

    } catch (err) {
      console.error('Load repay-from-client error:', err);
      wx.showToast({ title: t('order_summary_failed'), icon: 'none' });
    }
  },

  async buildMealSummary(selections) {
    // Structure: { '2026-09-19': { meal_ids, snack_id, time, notes, sauces: { mealId: sauceId } } }
    // Las claves son fechas ISO reales -- ordenan bien lexicográficamente,
    // no hace falta un orden fijo aparte.
    const dayOrder = Object.keys(selections).sort();
    const allIds = [];
    dayOrder.forEach(day => {
      const sel = selections[day];
      if (sel && sel.meal_ids) {
        sel.meal_ids.forEach(id => { if (id && !allIds.includes(id)) allIds.push(id); });
      }
    });

    let mealMap = {};
    if (allIds.length > 0) {
      const meals = await app.supabase('GET', 'meal_library', null, `id=in.(${allIds.join(',')})`);
      (meals || []).forEach(m => { mealMap[m.id] = m; });
    }

    return dayOrder
      .filter(day => selections[day] && selections[day].meal_ids && selections[day].meal_ids.length > 0)
      .map(day => {
        const sel = selections[day];
        return {
          day,
          dayLabel: formatShortDate(day, _isZh ? 'zh' : 'en'),
          time: sel.time || '',
          meals: (sel.meal_ids || []).map((id, i) => ({
            slot: i,
            name: mealMap[id] ? app.getMealName(mealMap[id]) : id,
          })),
        };
      });
  },

  async submitOrder() {
    if (this.data.submitting) return;

    if (this.data.fromRenewal) {
      wx.navigateTo({ url: '/pages/payment/index?from=renewal' });
      return;
    }

    if (this.data.repay) {
      // Señal de un solo uso para payment.js: la fecha en storage se acaba
      // de elegir de verdad AHORA (viene de start-date.js/meal-select.js,
      // recién). Sin esto, payment.js no puede distinguir esta fecha fresca
      // de cualquier storage viejo que haya quedado de un intento anterior
      // sin terminar -- y una fecha vieja que por casualidad todavía no
      // esté vencida pasaba el chequeo sin pedir nada nuevo, dejando pagar
      // sobre datos que no son los de este intento.
      wx.setStorageSync('freshResyncDate', true);
      wx.navigateTo({ url: '/pages/payment/index' });
      return;
    }

    this.setData({ submitting: true });
    try {
      const pendingOrderId = wx.getStorageSync('pendingOrderId');
      await app.updateOrder({ orderId: pendingOrderId, patch: { status: 'pending' } });
      wx.reLaunch({ url: '/pages/under-review/index' });
    } catch (err) {
      console.error('Submit error:', err);
      wx.showToast({ title: t('order_summary_error'), icon: 'none' });
      this.setData({ submitting: false });
    }
  },

  openBrochure() {
    app.openBrochure();
  },

  editMeals() {
    // Precargamos las selecciones actuales para que la página destino no
    // arranque vacía. En alta nueva viven en la orden; en renovación ya
    // están en storage porque se acaban de elegir en este mismo flujo, y
    // pisarlas con `order.meals` (que en renovación es el cliente, sin ese
    // campo) las borraría y obligaría a elegir las 5 de nuevo.
    const stored = wx.getStorageSync('mealSelections') || {};
    if (Object.keys(stored).length === 0 && this.data.order && this.data.order.meals) {
      wx.setStorageSync('mealSelections', this.data.order.meals);
    }
    // Renovación y alta nueva llegan las dos desde meal-select (camino
    // único), así que editar vuelve siempre ahí.
    wx.navigateTo({ url: '/pages/meal-select/index?from=order-summary' });
  },

  editAddress() {
    // Sin pendingOrderId (cliente ya aprobado, llegó por el camino
    // client-only de repay -- ver loadRepayFromClient) no hay una orden que
    // register.js pueda cargar: entraba con el form vacío, y al guardar
    // (editing=false, sin pendingOrderId) el openid volvía a matchear este
    // mismo cliente y mostraba "ya tenés cuenta" en loop. edit-profile.js
    // ya es el camino correcto para que un cliente existente edite sus
    // datos (usa clientId + updateClient), así que va ahí en ese caso.
    if (!wx.getStorageSync('pendingOrderId')) {
      wx.navigateTo({ url: '/pages/edit-profile/index' });
      return;
    }
    wx.navigateTo({ url: '/pages/register/index?from=order-summary' });
  },

  goBack() {
    wx.navigateBack();
  },
});
