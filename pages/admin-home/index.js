// pages/admin-home/index.js
const app = getApp();

// Replace with your brother's real name
const ADMIN_NAME = 'Max';

Page({
  data: {
    loading: true,
    adminName: ADMIN_NAME,
    timeOfDay: '',
    todayLabel: '',
    pendingCount: 0,
    activeCount: 0,
  },

  async onLoad() {
    this.setTimeGreeting();
    await this.loadStats();
  },

  onShow() {
    // Refresh counts every time admin comes back to home
    this.loadStats();
  },

  setTimeGreeting() {
    const hour = new Date().getHours();
    let timeOfDay = 'morning';
    if (hour >= 12 && hour < 18) timeOfDay = 'afternoon';
    else if (hour >= 18) timeOfDay = 'evening';

    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const todayLabel = days[new Date().getDay()];

    this.setData({ timeOfDay, todayLabel });
  },

  async loadStats() {
    try {
      const [pendingData, activeData] = await Promise.all([
        app.supabase('GET', 'new_orders', null, 'status=eq.pending'),
        app.supabase('GET', 'clients', null, 'status=eq.Active'),
      ]);

      this.setData({
        pendingCount: (pendingData || []).length,
        activeCount: (activeData || []).length,
        loading: false,
      });
    } catch (err) {
      console.error('Load stats error:', err);
      this.setData({ loading: false });
    }
  },

  goToOrders() {
    wx.navigateTo({ url: '/pages/admin-orders/index' });
  },

  goToNotify() {
    wx.navigateTo({ url: '/pages/admin-notify/index' });
  },
});
