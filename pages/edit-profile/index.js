// pages/edit-profile/index.js
const app = getApp();

Page({
  data: {
    saving: false,
    pendingAddressChange: false,
    addressChangeStatus: '', // 'approved' | 'rejected' shown once
    addressChangeNote: '',
    originalAddress: '',
    originalDistrict: '',
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
      const data = await app.getClient({ clientId });
      if (!data || data.length === 0) return;

      const c = data[0];
      this.setData({
        originalAddress: c.address || '',
        originalDistrict: c.district || '',
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

      const latest = await app.supabase('GET', 'address_changes', null, `client_id=eq.${clientId}&order=created_at.desc&limit=1`);
      const latestChange = latest && latest.length > 0 ? latest[0] : null;

      if (latestChange && latestChange.status === 'pending') {
        this.setData({ pendingAddressChange: true });
      } else if (latestChange && (latestChange.status === 'approved' || latestChange.status === 'rejected')) {
        const seenKey = `seenAddressChange_${latestChange.id}`;
        if (!wx.getStorageSync(seenKey)) {
          this.setData({
            addressChangeStatus: latestChange.status,
            addressChangeNote: latestChange.rejection_note || '',
          });
          this.seenAddressChangeKey = seenKey;
        }
      }
    } catch (err) {
      console.error('Load profile error:', err);
    }
  },

  dismissAddressChangeNotice() {
    if (this.seenAddressChangeKey) {
      wx.setStorageSync(this.seenAddressChangeKey, true);
    }
    this.setData({ addressChangeStatus: '', addressChangeNote: '' });
  },

  onInput(e) {
    const field = e.currentTarget.dataset.field;
    this.setData({ [`form.${field}`]: e.detail.value });
  },

  async save() {
    if (this.data.saving) return;
    this.setData({ saving: true });

    const clientId = wx.getStorageSync('clientId');
    const { form, originalAddress, originalDistrict } = this.data;
    const newAddress = form.address.trim();
    const newDistrict = form.district.trim();
    const addressChanged = newAddress !== originalAddress || newDistrict !== originalDistrict;

    const newPhone = form.phone.trim();

    try {
      // Evitar colisión: si el teléfono cambió y ya pertenece a OTRO cliente,
      // no permitir el guardado — pisaría los datos de ese otro cliente.
      const existingPhoneOwner = await app.getClient({ phone: newPhone });
      if (existingPhoneOwner && existingPhoneOwner.length > 0 && existingPhoneOwner[0].id !== clientId) {
        wx.showModal({
          title: 'Phone already registered',
          content: 'This phone number already belongs to another client. Please use a different number.',
          showCancel: false,
        });
        this.setData({ saving: false });
        return;
      }

      // El distrito/dirección no se actualizan directo — quedan pendientes
      // de revisión para chequear que estén en zona de cobertura. El resto
      // de los campos se guarda normal.
      await app.supabase('PATCH', 'clients', {
        name:      form.name.trim(),
        phone:     newPhone,
        access:    form.access.trim(),
        allergies: form.allergies.trim(),
        goal:      form.goal.trim(),
      }, `id=eq.${clientId}`);

      if (addressChanged) {
        const existingPending = await app.supabase('GET', 'address_changes', null, `client_id=eq.${clientId}&status=eq.pending`);

        if (existingPending && existingPending.length > 0) {
          await app.supabase('PATCH', 'address_changes', {
            new_district: newDistrict,
            new_address: newAddress,
          }, `id=eq.${existingPending[0].id}`);
        } else {
          await app.supabase('POST', 'address_changes', {
            client_id: clientId,
            old_district: originalDistrict,
            old_address: originalAddress,
            new_district: newDistrict,
            new_address: newAddress,
            status: 'pending',
          });
        }
        wx.showToast({ title: 'Saved. Address pending review', icon: 'none' });
      } else {
        wx.showToast({ title: 'Profile updated ✓', icon: 'none' });
      }

      setTimeout(() => wx.navigateBack(), 1000);

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
