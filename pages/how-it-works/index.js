// pages/how-it-works/index.js
const app = getApp();
const t = require('../../i18n/index');

Page({
  data: {
    lbl_title: '', lbl_kicker: '', lbl_headline1: '', lbl_headline2: '', lbl_intro: '',
    lbl_step1_title: '', lbl_step1_tag: '', lbl_step1_desc: '',
    lbl_step2_title: '', lbl_step2_tag: '', lbl_step2_desc: '',
    lbl_step3_title: '', lbl_step3_tag: '', lbl_step3_desc: '',
    lbl_step4_title: '', lbl_step4_tag: '', lbl_step4_desc: '',
    lbl_get_started: '',
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
    });
  },

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
