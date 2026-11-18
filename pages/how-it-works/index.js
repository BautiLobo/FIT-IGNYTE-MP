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
    lbl_any_doubt: '',
    lbl_contact_us: '',
    photos: [],
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
      lbl_any_doubt: t('how_any_doubt'),
      lbl_contact_us: t('how_contact_us'),
    });
    this.loadPhotos();
  },

  // Fotos de platos (no snacks) para el carrusel del paso 2. La lista va
  // duplicada para que la animación (-50%) haga el loop sin salto.
  // Si falla o no hay fotos, el carrusel no se muestra.
  async loadPhotos() {
    try {
      const rows = await app.supabase('GET', 'meal_library', null, 'select=photo_url&is_snack=eq.false&photo_url=neq.&limit=60');
      const urls = (rows || []).map(r => r.photo_url).filter(Boolean);
      for (let i = urls.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [urls[i], urls[j]] = [urls[j], urls[i]];
      }
      const pick = urls.slice(0, 8);
      if (pick.length < 3) return;
      const photos = pick.concat(pick).map((url, i) => ({ url, key: i }));
      this.setData({ photos });
    } catch (err) {
      console.error('[how-it-works] photos error:', err);
    }
  },


  goBack() {
    wx.navigateBack();
  },

  getStarted() {
    app.requestSubscribe();
    wx.navigateTo({ url: '/pages/tiers/index' });
  }
});
