// pages/register/index.js
const app = getApp();
const t = require('../../i18n/index');

Page({
  data: {
    selectedPlan: null,
    submitting: false,
    editing: false,
    lbl_title: '',
    lbl_change: '',
    lbl_name_label: '',
    lbl_name_ph: '',
    lbl_phone_label: '',
    lbl_phone_ph: '',
    lbl_district_label: '',
    lbl_district_ph: '',
    lbl_address_label: '',
    lbl_address_ph: '',
    lbl_access_label: '',
    lbl_access_ph: '',
    lbl_allergies_label: '',
    lbl_allergies_ph: '',
    lbl_goal_label: '',
    lbl_goal_ph: '',
    lbl_submitting: '',
    lbl_save_changes: '',
    lbl_next: '',
    lbl_delivery_note: '',
    lbl_area_note: '',
    form: {
      name: '',
      phone: '',
      district: '',
      address: '',
      access: '',
      allergies: '',
      goal: '',
    }
  },

  async onLoad(options) {
    this.setData({
      lbl_title: t('register_title'),
      lbl_change: t('register_change'),
      lbl_name_label: t('register_name_label'),
      lbl_name_ph: t('register_name_placeholder'),
      lbl_phone_label: t('register_phone_label'),
      lbl_phone_ph: t('register_phone_placeholder'),
      lbl_district_label: t('register_district_label'),
      lbl_district_ph: t('register_district_placeholder'),
      lbl_address_label: t('register_address_label'),
      lbl_address_ph: t('register_address_placeholder'),
      lbl_access_label: t('register_access_label'),
      lbl_access_ph: t('register_access_placeholder'),
      lbl_allergies_label: t('register_allergies_label'),
      lbl_allergies_ph: t('register_allergies_placeholder'),
      lbl_goal_label: t('register_goal_label'),
      lbl_goal_ph: t('register_goal_placeholder'),
      lbl_submitting: t('register_submitting'),
      lbl_save_changes: t('register_save_changes'),
      lbl_next: t('register_next'),
      lbl_delivery_note: t('register_delivery_note'),
      lbl_area_note: t('register_area_note'),
    });
    const selectedPlan = wx.getStorageSync('selectedPlan');
    if (!selectedPlan) {
      wx.navigateTo({ url: '/pages/plans/index' });
      return;
    }
    this.setData({ selectedPlan });

    if (options.from === 'order-summary') {
      const pendingOrderId = wx.getStorageSync('pendingOrderId');
      if (!pendingOrderId) return;
      try {
        const data = await app.supabase('GET', 'new_orders', null, `id=eq.${pendingOrderId}`);
        if (data && data.length > 0) {
          const order = data[0];
          this.setData({
            editing: true,
            form: {
              name: order.name || '',
              phone: order.phone || '',
              district: order.district || '',
              address: order.address || '',
              access: order.access || '',
              allergies: order.allergies || '',
              goal: order.goal || '',
            },
          });
        }
      } catch (err) {
        console.error('Load order for edit error:', err);
      }
    }
  },

  onInput(e) {
    const field = e.currentTarget.dataset.field;
    this.setData({ [`form.${field}`]: e.detail.value });
  },

  validate() {
    const { name, phone, district, address, goal } = this.data.form;

    if (!name.trim() || name.trim().length < 2) {
      wx.showToast({ title: t('register_error_name'), icon: 'none' });
      return false;
    }
    if (/\d/.test(name)) {
      wx.showToast({ title: t('register_error_name_numbers'), icon: 'none' });
      return false;
    }
    const normalizedPhone = phone.trim().replace(/[\s-]/g, '');
    if (!normalizedPhone || !/^\+?\d{7,15}$/.test(normalizedPhone)) {
      wx.showToast({ title: t('register_error_phone'), icon: 'none' });
      return false;
    }
    if (!district.trim() || district.trim().length < 2) {
      wx.showToast({ title: t('register_error_district'), icon: 'none' });
      return false;
    }
    if (!address.trim() || address.trim().length < 10) {
      wx.showToast({ title: t('register_error_address'), icon: 'none' });
      return false;
    }
    return true;
  },

  async submit() {
    if (!this.validate()) return;
    if (this.data.submitting) return;

    this.setData({ submitting: true });

    try {
      const { form, selectedPlan, editing } = this.data;

      if (editing) {
        const pendingOrderId = wx.getStorageSync('pendingOrderId');
        await app.supabase('PATCH', 'new_orders', {
          name: form.name.trim(),
          phone: form.phone.trim(),
          district: form.district.trim(),
          address: form.address.trim(),
          access: form.access.trim(),
          allergies: form.allergies.trim(),
          goal: form.goal.trim(),
        }, `id=eq.${pendingOrderId}`);
        wx.navigateBack();
        return;
      }

      // Get meal selections saved from meal-select
      const mealSelections = wx.getStorageSync('mealSelections') || {};
      const existingPendingOrderId = wx.getStorageSync('pendingOrderId');

      // Si ya existe una orden draft y las meals ya fueron guardadas (storage vacío),
      // solo actualizar los datos personales en la orden existente.
      if (existingPendingOrderId && Object.keys(mealSelections).length === 0) {
        await app.supabase('PATCH', 'new_orders', {
          name: form.name.trim(),
          phone: form.phone.trim(),
          district: form.district.trim(),
          address: form.address.trim(),
          access: form.access.trim(),
          allergies: form.allergies.trim(),
          goal: form.goal.trim(),
          plan_id: selectedPlan.id,
        }, `id=eq.${existingPendingOrderId}`);
        wx.navigateTo({ url: '/pages/order-summary/index' });
        this.setData({ submitting: false });
        return;
      }

      // Evitar colisión: si el teléfono ya pertenece a un cliente existente,
      // no crear una orden nueva — eso pisaría los datos de ese cliente al aprobar.
      const existingClient = await app.getClient({ phone: form.phone.trim() });
      if (existingClient && existingClient.length > 0) {
        wx.showModal({
          title: 'Phone already registered',
          content: 'This phone number already belongs to an existing client. Please use a different number, or contact us if you need to renew/update an existing account.',
          showCancel: false,
        });
        this.setData({ submitting: false });
        return;
      }

      // Resolver el openid ahora — el código de wx.login expira en minutos y la
      // aprobación del admin puede tardar horas, así que no sirve guardarlo crudo.
      const openid = await app.resolveOpenid();

      const orderData = {
        name: form.name.trim(),
        phone: form.phone.trim(),
        district: form.district.trim(),
        address: form.address.trim(),
        access: form.access.trim(),
        allergies: form.allergies.trim(),
        goal: form.goal.trim(),
        plan_id: selectedPlan.id,
        meals: mealSelections,
        status: 'draft',
        wechat_openid: openid,
      };

      const result = await app.supabase('POST', 'new_orders', orderData);

      if (result && result.length > 0) {
        // Save order id and go to order summary
        wx.setStorageSync('pendingOrderId', result[0].id);
        // Clear selections from storage — no longer needed
        wx.removeStorageSync('mealSelections');
        wx.navigateTo({ url: '/pages/order-summary/index' });
      } else {
        throw new Error('No result from Supabase');
      }

    } catch (err) {
      console.error('Register error:', err);
      wx.showToast({ title: t('register_error_generic'), icon: 'none' });
    } finally {
      this.setData({ submitting: false });
    }
  },

  goBack() {
    wx.navigateBack();
  }
});
