// pages/how-it-works/index.js
const app = getApp();

Page({
  goBack() {
    wx.navigateBack();
  },

  getStarted() {
    // Disparado desde un tap real del usuario — WeChat exige esto para
    // mostrar el popup de requestSubscribeMessage (no funciona en onLoad).
    app.requestSubscribe();
    wx.navigateTo({ url: '/pages/tiers/index' });
  }
});
