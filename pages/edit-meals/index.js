// pages/edit-meals/index.js
const app = getApp();
const t = require('../../i18n/index');

const _isZh = (wx.getAppBaseInfo().language || '').startsWith('zh');
const DAYS = [
  { key: 'mon', label: 'Monday',    short: _isZh ? '周一' : 'Mon' },
  { key: 'tue', label: 'Tuesday',   short: _isZh ? '周二' : 'Tue' },
  { key: 'wed', label: 'Wednesday', short: _isZh ? '周三' : 'Wed' },
  { key: 'thu', label: 'Thursday',  short: _isZh ? '周四' : 'Thu' },
  { key: 'fri', label: 'Friday',    short: _isZh ? '周五' : 'Fri' },
];

const DAY_KEY_MAP = { 'Monday': 'mon', 'Tuesday': 'tue', 'Wednesday': 'wed', 'Thursday': 'thu', 'Friday': 'fri' };

Page({
  data: {
    loading: true,
    plan: null,
    clientId: null,
    fromRenewal: false,
    days: [],
    rotationAnchor: null,
    rotationOrder: [1, 2, 3, 4],
    startDateStr: null,
    currentDay: 'mon',
    currentDayLabel: 'Monday',
    menuMeals: [],
    selectedMealIds: [],
    snackOfDay: null,
    snackAdded: false,
    snackId: null,
    selectedTime: '09:45',
    currentNotes: '',
    allSelections: {},
    isLastDay: false,
    lastSelectedPhoto: '',
    lastSelectedName: '',
    saucesById: {},
    currentSauces: {},
    sauceModal: { visible: false, mealId: null, options: [] },
    lbl_title: '',
    lbl_select_sauce: '',
    lbl_add_snack: '',
    lbl_snack_added: '',
    lbl_delivery_time: '',
    lbl_tap_to_change: '',
    lbl_notes: '',
    lbl_notes_placeholder: '',
    lbl_save: '',
    lbl_save_next: '',
    lbl_kcal: '',
    lbl_cancel: '',
  },

  async onLoad(options) {
    this.setData({
      lbl_title: t('edit_meals_title'),
      lbl_select_sauce: t('meal_select_select_sauce'),
      lbl_add_snack: t('meal_select_add_snack'),
      lbl_snack_added: t('meal_select_snack_added'),
      lbl_delivery_time: t('meal_select_delivery_time'),
      lbl_tap_to_change: t('meal_select_tap_to_change'),
      lbl_notes: t('meal_select_notes'),
      lbl_notes_placeholder: t('meal_select_notes_placeholder'),
      lbl_save: t('edit_meals_save'),
      lbl_save_next: t('edit_meals_save_next'),
      lbl_kcal: t('meal_select_kcal'),
      lbl_meals_day: t('plans_meals_per_day'),
      lbl_cancel: t('payment_simulate_cancel'),
    });
    const clientId = wx.getStorageSync('clientId');
    if (!clientId) { wx.navigateBack(); return; }
    const fromRenewal = options.from === 'renewal';
    // En el flujo de renovación "Keep same meals", start-date ya corrió antes
    // y dejó la fecha real en storage; para el cliente activo editando su
    // semana en curso desde home no hay start_date futura, así que usamos
    // "hoy" como referencia (comportamiento de getWeekIndexForDay sin 4to arg).
    const startDateStr = fromRenewal ? (wx.getStorageSync('startDate') || null) : null;
    this.setData({ fromRenewal, startDateStr });

    try {
      // Load client + plan
      const clientData = await app.getClient({ clientId });
      if (!clientData || clientData.length === 0) { wx.navigateBack(); return; }
      const client = clientData[0];

      const planData = await app.supabase('GET', 'plans', null, `id=eq.${client.plan_id}`);
      const plan = planData && planData.length > 0 ? app.getDisplayPlan(planData[0]) : null;
      if (!plan) { wx.navigateBack(); return; }

      // Load existing meal selections
      const selectionsData = await app.supabase('GET', 'meal_selections', null, `client_id=eq.${clientId}&order=day.asc`);
      const allSelections = {};
      (selectionsData || []).forEach(row => {
        const key = DAY_KEY_MAP[row.day];
        if (!key) return;
        const mealIds = row.meals_json || [];
        const sauceIds = row.sauce_ids || [];
        const sauces = {};
        mealIds.forEach((id, i) => { if (sauceIds[i]) sauces[id] = sauceIds[i]; });
        allSelections[key] = {
          meal_ids: mealIds,
          snack_id: row.snack_id || null,
          time: row.delivery_time || '09:45',
          notes: row.note || '',
          sauces,
        };
      });

      const days = DAYS.map(d => ({
        ...d,
        done: !!(allSelections[d.key] && allSelections[d.key].meal_ids.length >= plan.meals),
      }));

      try {
        const saucesData = await app.supabase('GET', 'meal_library', null, 'item_type=eq.sauce');
        const saucesById = {};
        (saucesData || []).forEach(s => { saucesById[s.id] = s; });
        this.setData({ saucesById });
      } catch (err) {
        console.error('Load sauces error:', err);
      }

      this.setData({ clientId, plan, allSelections, days });

      try {
        const { anchor, order } = await app.getMenuRotation();
        this.setData({ rotationAnchor: anchor, rotationOrder: order });
      } catch (err) {
        console.error('Load menu rotation error:', err);
      }

      await this.loadMenu('mon');

    } catch (err) {
      console.error('edit-meals onLoad error:', err);
      wx.navigateBack();
    }
  },

  async loadMenu(dayKey) {
    this.setData({ loading: true, selectedMealIds: [], lastSelectedPhoto: '', lastSelectedName: '' });

    try {
      const { plan, allSelections, rotationAnchor, rotationOrder, startDateStr } = this.data;
      const dayLabel = DAYS.find(d => d.key === dayKey)?.label || '';
      const weekIndex = app.getWeekIndexForDay(dayKey, rotationAnchor, rotationOrder, startDateStr);

      const menuData = await app.supabase('GET', 'menu', null, `day=eq.${dayLabel}&tier=eq.${plan.tier}&week_index=eq.${weekIndex}`);
      const menu = menuData && menuData.length > 0 ? menuData[0] : null;

      let meals = [];
      if (menu && menu.meals_json && menu.meals_json.length > 0) {
        const ids = menu.meals_json.filter(Boolean);
        meals = await app.supabase('GET', 'meal_library', null, `id=in.(${ids.join(',')})`);
      }

      let snackOfDay = null, snackId = null;
      if (menu && menu.snack_id) {
        const snackData = await app.supabase('GET', 'meal_library', null, `id=eq.${menu.snack_id}`);
        if (snackData && snackData.length > 0) {
          snackOfDay = snackData[0].name;
          snackId = menu.snack_id;
        }
      }

      // Restore existing selections
      const existing = allSelections[dayKey];
      const existingMealIds = existing ? existing.meal_ids : [];
      const existingTime = existing ? existing.time : '09:45';
      const existingNotes = existing ? existing.notes : '';
      const existingSnack = existing ? !!existing.snack_id : false;
      const existingSauces = (existing && existing.sauces) || {};

      let lastSelectedPhoto = '';
      let lastSelectedName = '';
      if (existingMealIds.length > 0 && meals.length > 0) {
        const lastId = existingMealIds[existingMealIds.length - 1];
        const m = (meals || []).find(meal => meal.id === lastId);
        if (m) {
          lastSelectedPhoto = m.photo_url || '';
          lastSelectedName = m.name;
        }
      }

      const { saucesById } = this.data;
      const updatedMeals = (meals || []).map(m => {
        const sauceIds = m.available_sauce_ids || [];
        const sauceOptions = sauceIds.map(id => {
          const s = saucesById[id];
          return { id, name: s ? app.getMealName(s) : id };
        });
        const candidateSauceId = existingSauces[m.id];
        const selectedSauceId = (candidateSauceId && sauceIds.includes(candidateSauceId)) ? candidateSauceId : null;
        const selectedSauceName = selectedSauceId && saucesById[selectedSauceId] ? app.getMealName(saucesById[selectedSauceId]) : '';
        return {
          ...m,
          displayName: app.getMealName(m),
          qty: existingMealIds.filter(id => id === m.id).length,
          sauceOptions,
          selectedSauceId,
          selectedSauceName,
        };
      });

      const dayIndex = DAYS.findIndex(d => d.key === dayKey);
      const isLastDay = dayIndex === DAYS.length - 1;

      this.setData({
        loading: false,
        currentDay: dayKey,
        currentDayLabel: dayLabel,
        menuMeals: updatedMeals,
        snackOfDay, snackId,
        snackAdded: existingSnack,
        selectedMealIds: existingMealIds,
        currentSauces: existingSauces,
        selectedTime: existingTime,
        currentNotes: existingNotes,
        isLastDay,
        lastSelectedPhoto,
        lastSelectedName,
      });

    } catch (err) {
      console.error('loadMenu error:', err);
      this.setData({ loading: false });
    }
  },

  incrementMeal(e) {
    const meal = e.currentTarget.dataset.meal;
    const { selectedMealIds, plan, menuMeals, currentSauces } = this.data;
    const maxMeals = plan.meals;

    if (selectedMealIds.length >= maxMeals) {
      wx.showToast({ title: t('meal_select_max_meals', maxMeals), icon: 'none' });
      return;
    }

    const newIds = [...selectedMealIds, meal.id];
    const updatedMeals = menuMeals.map(m => ({
      ...m,
      qty: m.id === meal.id ? (m.qty || 0) + 1 : m.qty,
    }));

    this.setData({
      selectedMealIds: newIds,
      menuMeals: updatedMeals,
      lastSelectedPhoto: meal.photo_url || '',
      lastSelectedName: meal.name,
    }, () => this.persistCurrentDay());
  },

  decrementMeal(e) {
    const meal = e.currentTarget.dataset.meal;
    const { selectedMealIds, menuMeals, currentSauces } = this.data;
    const idx = selectedMealIds.indexOf(meal.id);
    if (idx < 0) return;

    const newIds = [...selectedMealIds];
    newIds.splice(idx, 1);
    const updatedMeals = menuMeals.map(m => ({
      ...m,
      qty: m.id === meal.id ? Math.max((m.qty || 0) - 1, 0) : m.qty,
    }));

    const newSauces = { ...currentSauces };
    if (!newIds.includes(meal.id)) delete newSauces[meal.id];

    this.setData({
      selectedMealIds: newIds,
      menuMeals: updatedMeals,
      currentSauces: newSauces,
      lastSelectedPhoto: meal.photo_url || '',
      lastSelectedName: meal.name,
    }, () => this.persistCurrentDay());
  },

  openSaucePicker(e) {
    const mealId = e.currentTarget.dataset.mealId;
    const meal = this.data.menuMeals.find(m => m.id === mealId);
    if (!meal || !meal.sauceOptions || meal.sauceOptions.length === 0) return;
    this.setData({ sauceModal: { visible: true, mealId, options: meal.sauceOptions } });
  },

  closeSauceModal() {
    this.setData({ sauceModal: { visible: false, mealId: null, options: [] } });
  },

  pickSauce(e) {
    const { mealId, options } = this.data.sauceModal;
    const idx = e.currentTarget.dataset.idx;
    const sauce = options[idx];
    if (!sauce) return;
    const currentSauces = { ...this.data.currentSauces, [mealId]: sauce.id };
    const menuMeals = this.data.menuMeals.map(m =>
      m.id === mealId ? { ...m, selectedSauceId: sauce.id, selectedSauceName: sauce.name } : m
    );
    this.setData({ currentSauces, menuMeals, sauceModal: { visible: false, mealId: null, options: [] } }, () => this.persistCurrentDay());
  },

  onTimeChange(e) { this.setData({ selectedTime: e.detail.value }, () => this.persistCurrentDay()); },
  onNotesInput(e) { this.setData({ currentNotes: e.detail.value }, () => this.persistCurrentDay()); },
  toggleSnack() { this.setData({ snackAdded: !this.data.snackAdded }, () => this.persistCurrentDay()); },

  // Guarda en memoria (allSelections) lo del día actual antes de cambiar de
  // día, sin pegarle a Supabase — así no se pierde nada al cambiar de día
  // sin tocar un botón explícito de "Save" (mismo patrón que meal-select).
  persistCurrentDay() {
    const { selectedMealIds, selectedTime, currentNotes, snackAdded, snackId, currentDay, allSelections, plan, days, currentSauces } = this.data;

    const updatedSelections = { ...allSelections };
    if (selectedMealIds.length === 0) {
      delete updatedSelections[currentDay];
    } else {
      updatedSelections[currentDay] = {
        meal_ids: selectedMealIds,
        snack_id: snackAdded ? snackId : null,
        time: selectedTime,
        notes: currentNotes,
        sauces: currentSauces,
      };
    }

    const dayDone = selectedMealIds.length >= plan.meals;
    const updatedDays = days.map(d => d.key === currentDay ? { ...d, done: dayDone } : d);

    this.setData({ allSelections: updatedSelections, days: updatedDays });
  },

  switchDay(e) {
    const day = e.currentTarget.dataset.day;
    if (day === this.data.currentDay) return;
    this.persistCurrentDay();
    this.loadMenu(day);
  },

  saveAndNext() {
    const { selectedMealIds, plan } = this.data;

    if (selectedMealIds.length < plan.meals) {
      wx.showToast({ title: t('meal_select_select_first', plan.meals), icon: 'none' }); return;
    }

    this.persistCurrentDay();
    this.goNext();
  },

  async goNext() {
    const { currentDay, isLastDay, allSelections, clientId } = this.data;

    if (isLastDay) {
      wx.showLoading({ title: t('loading') });
      try {
        await this.saveMealSelections(clientId, allSelections);
        wx.hideLoading();
        wx.showToast({ title: t('edit_meals_updated'), icon: 'success' });
        const dest = this.data.fromRenewal
          ? '/pages/order-summary/index?from=renewal'
          : '/pages/home/index';
        setTimeout(() => wx.reLaunch({ url: dest }), 1000);
      } catch (err) {
        wx.hideLoading();
        console.error('Save error:', err);
        wx.showToast({ title: t('edit_meals_failed'), icon: 'none' });
      }
    } else {
      const dayIndex = DAYS.findIndex(d => d.key === currentDay);
      this.loadMenu(DAYS[dayIndex + 1].key);
    }
  },

  async saveMealSelections(clientId, allSelections) {
    const dayMap = { mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday' };
    for (const [key, label] of Object.entries(dayMap)) {
      const sel = allSelections[key];
      if (!sel || !sel.meal_ids || sel.meal_ids.length === 0) continue;
      // PATCH si existe, POST si no
      const existing = await app.supabase('GET', 'meal_selections', null, `client_id=eq.${clientId}&day=eq.${label}&slot=eq.1`);
      const sauces = sel.sauces || {};
      const payload = {
        client_id: clientId,
        day: label,
        slot: 1,
        meals_json: sel.meal_ids,
        delivery_time: sel.time,
        snack_id: sel.snack_id || null,
        note: sel.notes || '',
        sauce_ids: sel.meal_ids.map(id => sauces[id] || null),
      };
      if (existing && existing.length > 0) {
        await app.supabase('PATCH', 'meal_selections', payload, `client_id=eq.${clientId}&day=eq.${label}&slot=eq.1`);
      } else {
        await app.supabase('POST', 'meal_selections', payload);
      }
    }
  },

  goBack() { wx.navigateBack(); },
});
