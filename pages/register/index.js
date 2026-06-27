// pages/register/index.js
const app = getApp();

Page({
  data: {
    selectedPlan: null,
    submitting: false,
    editing: false,
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
      wx.showToast({ title: 'Please enter your full name', icon: 'none' });
      return false;
    }
    if (/\d/.test(name)) {
      wx.showToast({ title: 'Name should not contain numbers', icon: 'none' });
      return false;
    }
    const normalizedPhone = phone.trim().replace(/[\s-]/g, '');
    if (!normalizedPhone || !/^\+?\d{7,15}$/.test(normalizedPhone)) {
      wx.showToast({ title: 'Please enter a valid phone number', icon: 'none' });
      return false;
    }
    if (!district.trim() || district.trim().length < 2) {
      wx.showToast({ title: 'Please enter your district', icon: 'none' });
      return false;
    }
    if (!address.trim() || address.trim().length < 10) {
      wx.showToast({ title: 'Please enter your full delivery address', icon: 'none' });
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

      // Evitar colisión: si el teléfono ya pertenece a un cliente existente,
      // no crear una orden nueva — eso pisaría los datos de ese cliente al aprobar.
      const existingClient = await app.supabase('GET', 'clients', null, `phone=eq.${form.phone.trim()}`);
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
        wx.navigateTo({ url: '/pages/start-date/index' });
      } else {
        throw new Error('No result from Supabase');
      }

    } catch (err) {
      console.error('Register error:', err);
      wx.showToast({ title: 'Something went wrong, please try again', icon: 'none' });
    } finally {
      this.setData({ submitting: false });
    }
  },

  goBack() {
    wx.navigateBack();
  }
});
