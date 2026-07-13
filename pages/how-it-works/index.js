// pages/how-it-works/index.js
const app = getApp();
const t = require('../../i18n/index');

Page({
  data: {
    showGetStarted: false,
    lbl_title: '', lbl_kicker: '', lbl_headline1: '', lbl_headline2: '', lbl_intro: '',
    lbl_step1_title: '', lbl_step1_tag: '', lbl_step1_desc: '',
    lbl_step2_title: '', lbl_step2_tag: '', lbl_step2_desc: '',
    lbl_step3_title: '', lbl_step3_tag: '', lbl_step3_desc: '',
    lbl_step4_title: '', lbl_step4_tag: '', lbl_step4_desc: '',
    lbl_get_started: '',
    lbl_brochure: '',
  },

  onLoad() {
    this.setData({
      lbl_title: t('how_title'),
      lbl_kicker: t('how_kicker'),
      lbl_headline1: t('how_headline1'),
      lbl_headline2: t('how_headline2'),
      lbl_intro: t('how_intro'),
      lbl_step1_title: t('how_step1_title'), lbl_step1_tag: t('how_step1_tag'), lbl_step1_desc: t('how_step1_desc'),
      lbl_step2_title: t('how_step2_title'), lbl_step2_tag: t('how_step2_tag'), lbl_step2_desc: t('how_step2_desc'),
      lbl_step3_title: t('how_step3_title'), lbl_step3_tag: t('how_step3_tag'), lbl_step3_desc: t('how_step3_desc'),
      lbl_step4_title: t('how_step4_title'), lbl_step4_tag: t('how_step4_tag'), lbl_step4_desc: t('how_step4_desc'),
      lbl_get_started: t('how_get_started'),
      lbl_brochure: t('tiers_brochure'),
    });
  },

  goBack() {
    wx.navigateBack();
  },

  openBrochure() {
    wx.showLoading({ title: t('loading') });
    app.supabase('GET', 'settings', null, 'key=eq.brochure_en')
      .then(data => {
        wx.hideLoading();
        if (data && data.length > 0 && data[0].value) {
          wx.downloadFile({
            url: data[0].value,
            success: (res) => {
              wx.openDocument({
                filePath: res.tempFilePath,
                showMenu: true,
                success: () => this.setData({ showGetStarted: true }),
                fail: () => this.setData({ showGetStarted: true }),
              });
            },
            fail: () => {
              wx.showToast({ title: t('failed_open'), icon: 'none' });
              this.setData({ showGetStarted: true });
            },
          });
        } else {
          wx.showToast({ title: t('brochure_not_found'), icon: 'none' });
          this.setData({ showGetStarted: true });
        }
      })
      .catch(() => {
        wx.hideLoading();
        wx.showToast({ title: t('failed_load'), icon: 'none' });
        this.setData({ showGetStarted: true });
      });
  },

  getStarted() {
    app.requestSubscribe();
    wx.navigateTo({ url: '/pages/tiers/index' });
  }
});
