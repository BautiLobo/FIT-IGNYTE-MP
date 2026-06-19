// pages/edit-profile/index.js
const app = getApp();

Page({
  data: {
    saving: false,
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

  async onLoad() {
    const clientId = wx.getStorageSync('clientId');
    if (!clientId) return;

    try {
      const data = await app.supabase('GET', 'clients', null, `id=eq.${clientId}`);
      if (!data || data.length === 0) return;

      const c = data[0];
      this.setData({
        form: {
          name:      c.name || '',
          phone:     c.phone || '',
          district:  c.district || '',
          address:   c.address || '',
          access:    c.access || '',
          allergies: c.allergies || '',
          goal:      c.goal || '',
        }
      });
    } catch (err) {
      console.error('Load profile error:', err);
    }
  },

  onInput(e) {
    const field = e.currentTarget.dataset.field;
    this.setData({ [`form.${field}`]: e.detail.value });
  },

  async save() {
    if (this.data.saving) return;
    this.setData({ saving: true });

    const clientId = wx.getStorageSync('clientId');
    const { form } = this.data;

    try {
      await app.supabase('PATCH', 'clients', {
        name:      form.name.trim(),
        phone:     form.phone.trim(),
        district:  form.district.trim(),
        address:   form.address.trim(),
        access:    form.access.trim(),
        allergies: form.allergies.trim(),
        goal:      form.goal.trim(),
      }, `id=eq.${clientId}`);

      wx.showToast({ title: 'Profile updated ✓', icon: 'none' });
      setTimeout(() => wx.navigateBack(), 800);

    } catch (err) {
      console.error('Save profile error:', err);
      wx.showToast({ title: 'Failed to save', icon: 'none' });
    } finally {
      this.setData({ saving: false });
    }
  },

  logout() {
    wx.showModal({
      title: 'Log out',
      content: 'Are you sure you want to log out?',
      confirmText: 'Log out',
      cancelText: 'Cancel',
      confirmColor: '#E8342A',
      success: (res) => {
        if (res.confirm) {
          wx.removeStorageSync('clientId');
          wx.reLaunch({ url: '/pages/discovery/index' });
        }
      }
    });
  },

  goBack() {
    wx.navigateBack();
  },
});
