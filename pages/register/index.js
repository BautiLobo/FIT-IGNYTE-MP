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
    lbl_privacy_policy: '',
    lbl_privacy_agree_pre: '',
    lbl_privacy_agree_link: '',
    privacyAccepted: false,
    showPrivacyModal: false,
    lbl_privacy_modal_title: '',
    lbl_privacy_modal_body: '',
    lbl_privacy_modal_view: '',
    lbl_privacy_modal_agree: '',
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
      lbl_privacy_policy: t('register_privacy_policy'),
      lbl_privacy_agree_pre: t('register_privacy_agree_pre'),
      lbl_privacy_agree_link: t('register_privacy_agree_link'),
      lbl_privacy_modal_title: t('privacy_modal_title'),
      lbl_privacy_modal_body: t('privacy_modal_body'),
      lbl_privacy_modal_view: t('privacy_modal_view'),
      lbl_privacy_modal_agree: t('privacy_modal_agree'),
    });
    const selectedPlan = wx.getStorageSync('selectedPlan');
    if (!selectedPlan) {
      wx.navigateTo({ url: '/pages/plans/index' });
      return;
    }
    this.setData({ selectedPlan });

    // Pop-up oficial de privacidad (ver WeChat "Privacy Protocol Development
    // Guide"): solo tiene sentido para altas nuevas -- si el usuario ya
    // aceptó en una sesión anterior (needAuthorization: false), no se
    // vuelve a mostrar. El checkbox de abajo queda como respaldo visible
    // en todo momento, por si este popup no dispara en algún dispositivo.
    if (!this.data.editing && options.from !== 'order-summary') {
      wx.getPrivacySetting({
        success: (res) => {
          if (res.needAuthorization) {
            this.setData({ showPrivacyModal: true });
          }
        },
      });
    }

    if (options.from === 'order-summary') {
      const pendingOrderId = wx.getStorageSync('pendingOrderId');
      if (!pendingOrderId) return;
      try {
        const data = await app.getOrder({ orderId: pendingOrderId });
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
    // Solo se pide al registrarse por primera vez, no al editar un perfil ya existente.
    if (!this.data.editing && !this.data.privacyAccepted) {
      wx.showToast({ title: t('register_error_privacy'), icon: 'none' });
      return false;
    }
    return true;
  },

  togglePrivacyAccepted() {
    this.setData({ privacyAccepted: !this.data.privacyAccepted });
  },

  async submit() {
    if (!this.validate()) return;
    if (this.data.submitting) return;

    this.setData({ submitting: true });

    try {
      const { form, selectedPlan, editing } = this.data;

      if (editing) {
        const pendingOrderId = wx.getStorageSync('pendingOrderId');
        await app.updateOrder({
          orderId: pendingOrderId,
          patch: {
            name: form.name.trim(),
            phone: form.phone.trim(),
            district: form.district.trim(),
            address: form.address.trim(),
            access: form.access.trim(),
            allergies: form.allergies.trim(),
            goal: form.goal.trim(),
          },
        });
        wx.navigateBack();
        return;
      }

      // Get meal selections saved from meal-select
      const mealSelections = wx.getStorageSync('mealSelections') || {};
      const existingPendingOrderId = wx.getStorageSync('pendingOrderId');

      // Si ya existe una orden draft y las meals ya fueron guardadas (storage vacío),
      // solo actualizar los datos personales en la orden existente.
      if (existingPendingOrderId && Object.keys(mealSelections).length === 0) {
        await app.updateOrder({
          orderId: existingPendingOrderId,
          patch: {
            name: form.name.trim(),
            phone: form.phone.trim(),
            district: form.district.trim(),
            address: form.address.trim(),
            access: form.access.trim(),
            allergies: form.allergies.trim(),
            goal: form.goal.trim(),
            plan_id: selectedPlan.id,
            start_date: wx.getStorageSync('startDate') || null,
            expiry_date: wx.getStorageSync('expiryDate') || null,
          },
        });
        wx.navigateTo({ url: '/pages/order-summary/index' });
        this.setData({ submitting: false });
        return;
      }

      // Resolver el openid antes de crear la orden — el código de wx.login
      // expira en minutos y la aprobación del admin puede tardar horas.
      const openid = await app.resolveOpenid();

      // Verificar si ya existe un cliente con este openid (mismo usuario de WeChat)
      if (openid) {
        const byOpenid = await app.getClient({ openid });
        if (byOpenid && byOpenid.length > 0) {
          const existing = byOpenid[0];
          const status = app.getRealStatus(existing.start_date, existing.expiry_date);
          wx.showModal({
            title: t('register_account_exists_title'),
            content: t('register_account_exists_body'),
            showCancel: false,
            success: () => {
              wx.setStorageSync('clientId', existing.id);
              if (status === 'Inactive') {
                wx.reLaunch({ url: '/pages/renewal/index' });
              } else {
                wx.reLaunch({ url: '/pages/home/index' });
              }
            },
          });
          this.setData({ submitting: false });
          return;
        }
      }

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
        // La fecha de inicio que eligió el cliente en start-date; viaja en la
        // orden para que el admin la vea al aprobar y no se pierda al pasar
        // por otra sesión/dispositivo (el storage local no le llega al admin).
        start_date: wx.getStorageSync('startDate') || null,
        expiry_date: wx.getStorageSync('expiryDate') || null,
      };

      const result = await app.createOrder(orderData);

      if (result && result.reason === 'duplicate_pending_order') {
        // Mismo openid ya tiene un pedido sin resolver (draft/pending) —
        // pasa antes de que exista fila en `clients`, así que el chequeo de
        // arriba (por clients) no lo agarra. Lo mandamos a ver ese pedido
        // en vez de dejarlo crear uno duplicado.
        wx.setStorageSync('pendingOrderId', result.existingOrderId);
        wx.showModal({
          title: t('register_account_exists_title'),
          content: t('register_account_exists_body'),
          showCancel: false,
          success: () => { wx.reLaunch({ url: '/pages/under-review/index' }); },
        });
        this.setData({ submitting: false });
        return;
      }

      if (result && result.ok && result.order && result.order.id) {
        // Save order id and go to order summary
        wx.setStorageSync('pendingOrderId', result.order.id);
        // Clear selections from storage — no longer needed
        wx.removeStorageSync('mealSelections');
        wx.navigateTo({ url: '/pages/order-summary/index' });
      } else {
        throw new Error('No result from createOrder');
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
  },

  // Abre la guía de privacidad nativa de WeChat. Importante: se llama por
  // JS (wx.openPrivacyContract), NO como atributo open-type="openPrivacyContract"
  // en el botón -- en pruebas reales, el atributo declarativo no abría nada
  // en algunos dispositivos, mientras que llamarlo desde código sí funciona.
  viewPrivacyPolicy() {
    wx.openPrivacyContract({
      fail: (err) => {
        console.error('openPrivacyContract failed:', err);
        wx.showToast({ title: t('failed_open'), icon: 'none' });
      },
    });
  },

  // Callback del botón open-type="agreePrivacyAuthorization" del popup:
  // WeChat ya registró que este usuario aceptó la guía de privacidad
  // declarada en mp.weixin.qq.com -- reflejamos lo mismo en el checkbox
  // de abajo para no pedirle que lo tilde de nuevo.
  handleAgreePrivacyAuthorization() {
    this.setData({ showPrivacyModal: false, privacyAccepted: true });
  },
});
