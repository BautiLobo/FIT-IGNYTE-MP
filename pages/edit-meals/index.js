// pages/edit-meals/index.js
const app = getApp();
const t = require('../../i18n/index');
const { formatShortDate, formatDateParts } = require('../../utils/date-format');
const { getMinStartDate } = require('../../utils/business-days');

const _isZh = (wx.getAppBaseInfo().language || '').startsWith('zh');
const WEEKDAY_LABELS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// La tabla `menu` (catálogo de rotación) sigue siendo por día de semana --
// esto solo traduce una fecha real a ese nombre para poder consultarla.
function weekdayLabelForDate(dateStr) {
  return WEEKDAY_LABELS[new Date(dateStr + 'T00:00:00').getDay()];
}

// Tab en blanco (sin comida elegida todavía) para una fecha que el cliente
// acaba de agregar desde pages/change-date. Siempre slot 1 -- el cambio de
// fechas en bloque no soporta días con más de una entrega, ver
// openChangeDates() más abajo.
function buildDayEntry(date) {
  const parts = formatDateParts(date, _isZh ? 'zh' : 'en');
  return {
    key: `${date}#1`,
    date,
    slot: 1,
    label: weekdayLabelForDate(date),
    short: formatShortDate(date, _isZh ? 'zh' : 'en'),
    shortDate: parts.date,
    shortWeekday: parts.weekday,
    slotLabel: '',
    done: false,
  };
}

Page({
  data: {
    loading: true,
    plan: null,
    clientId: null,
    deferToPending: false,
    cycleStart: null,
    cycleEnd: null,
    days: [],
    dayTabDateSize: 20,
    dayTabWeekdaySize: 16,
    dayTabSlotSize: 18,
    dayTabCheckSize: 22,
    rotationAnchor: null,
    rotationOrder: [1, 2, 3, 4],
    currentDay: '',
    currentDayLabel: '',
    menuMeals: [],
    selectedMealIds: [],
    selectedTime: '10:15',
    currentNotes: '',
    allSelections: {},
    isLastDay: false,
    lastSelectedPhoto: '',
    lastSelectedName: '',
    lbl_title: '',
    lbl_delivery_time: '',
    lbl_tap_to_change: '',
    lbl_notes: '',
    lbl_notes_placeholder: '',
    lbl_save: '',
    lbl_save_next: '',
    lbl_kcal: '',
    lbl_cancel: '',
    lbl_protein: '',
    lbl_carbs: '',
    lbl_fat: '',
    lbl_change_date: '',
  },

  // Fuera de `data`: no necesita re-render, solo lo usan hasUnsavedChanges()
  // y snapshotState() para saber si hay algo sin guardar al salir.
  initialSnapshot: '',

  async onLoad(options) {
    this.setData({
      lbl_title: t('edit_meals_title'),
      lbl_delivery_time: t('meal_select_delivery_time'),
      lbl_tap_to_change: t('meal_select_tap_to_change'),
      lbl_notes: t('meal_select_notes'),
      lbl_notes_placeholder: t('meal_select_notes_placeholder'),
      lbl_save: t('edit_meals_save'),
      lbl_save_next: t('edit_meals_save_next'),
      lbl_kcal: t('meal_select_kcal'),
      lbl_meals_day: t('plans_meals_per_day'),
      lbl_cancel: t('payment_simulate_cancel'),
      lbl_protein: t('meal_select_protein'),
      lbl_carbs: t('meal_select_carbs'),
      lbl_fat: t('meal_select_fat'),
      lbl_change_date: t('change_date_link'),
    });
    const clientId = wx.getStorageSync('clientId');
    if (!clientId) { wx.navigateBack(); return; }

    try {
      // Load client + plan
      const clientData = await app.getClient({ clientId });
      if (!clientData || clientData.length === 0) { wx.navigateBack(); return; }
      const client = clientData[0];

      // Hueco entre el vencimiento del ciclo viejo y el arranque del nuevo ya
      // pagado (mismo chequeo que home.js): el cliente puede llegar acá por
      // el botón "Edit" normal (sin from=renewal) mientras está en este
      // hueco -- para él "esta semana" YA ES el ciclo nuevo, así que hay que
      // tratarlo igual que a una renovación anticipada: editar/guardar en
      // pending_meal_selections (no en meal_selections, que el cron va a
      // borrar).
      const realStatus = app.getRealStatus(client.start_date, client.expiry_date);
      const pendingRenewal = client.pending_renewal || null;
      const inRenewalGap = realStatus === 'Inactive' && !!pendingRenewal;

      // Un cliente en el hueco de renovación anticipada edita las filas del
      // ciclo que todavía no arrancó: van a pending_meal_selections, no a
      // meal_selections (esa es la semana que la cocina está preparando
      // ahora mismo, y el cron la va a reemplazar). Fuera del hueco, esta
      // pantalla edita el ciclo vigente y escribe donde siempre.
      const deferToPending = inRenewalGap;
      this.setData({ deferToPending });

      // En el hueco, el plan a usar (tier para el menu, cantidad de comidas
      // para la cuota/el check de "dia completo") es el de la renovacion
      // pendiente, NO client.plan_id -- ese sigue siendo el plan VIEJO hasta
      // que el cron aplica el cambio de ciclo. Usar el viejo hacia que el
      // filtro de "comida ya no esta en el menu" (mas abajo) comparara
      // contra el tier equivocado y vaciara TODAS las selecciones nuevas si
      // el cliente cambio de tier al renovar.
      const planIdToLoad = (inRenewalGap && pendingRenewal.plan_id) ? pendingRenewal.plan_id : client.plan_id;
      const planData = await app.supabase('GET', 'plans', null, `id=eq.${planIdToLoad}`);
      const plan = planData && planData.length > 0 ? app.getDisplayPlan(planData[0]) : null;
      if (!plan) { wx.navigateBack(); return; }

      // Filas del ciclo actual (lo que el cliente come ahora / lo que la
      // cocina está preparando) -- se usan como base de "mantener lo mismo"
      // tanto para el prefill de una renovación como para armar
      // directamente los 5 días a editar en una edición simple.
      // delivery_date NULL = fila legacy sin fecha resoluble todavía; no se
      // puede mostrar como tab, y save-meal-selections la reemplaza al guardar.
      const currentSelectionsData = await app.supabase('GET', 'meal_selections', null, `client_id=eq.${clientId}&order=delivery_date.asc`);
      const currentRows = (currentSelectionsData || []).filter((r) => r.delivery_date).sort((a, b) => (a.delivery_date < b.delivery_date ? -1 : 1));

      let pendingRows = [];
      if (deferToPending) {
        const pendingSelectionsData = await app.supabase('GET', 'pending_meal_selections', null, `client_id=eq.${clientId}&order=delivery_date.asc`);
        pendingRows = (pendingSelectionsData || []).filter((r) => r.delivery_date).sort((a, b) => (a.delivery_date < b.delivery_date ? -1 : 1));
      }

      // edit-meals es ahora SOLO la edición del ciclo vigente (botón "Edit"
      // de Home). La renovación tiene su propio camino único y pasa por
      // meal-select, que arranca siempre en blanco -- acá vivía el prefill
      // posicional de "mantener las mismas comidas", que copiaba el ciclo
      // anterior sin mirar cuántas comidas permitía el plan nuevo.
      // Ver startRenewal() en renewal/index.js.
      //
      // El hueco de renovación anticipada (inRenewalGap) sí sigue pasando
      // por acá: para ese cliente "esta semana" ya es el ciclo nuevo, y lo
      // que edita son sus filas de pending_meal_selections.
      // Esta pantalla edita UN ciclo, y hay que acotarla a las filas de ese
      // ciclo. `meal_selections` puede tener fechas de otro: un cliente con
      // una renovacion anticipada ya paga (o con slots cargados a mano desde
      // el panel) termina con filas posteriores a su expiry conviviendo con
      // las del ciclo en curso. Sin este filtro aparecian como tabs extra
      // --incluso repetidas, que es de donde salia el warning de wx:key-- y
      // el cliente editaba fechas que no son las suyas de esta semana.
      //
      // `pending_meal_selections` no necesita filtro: se vacia al aplicarse,
      // asi que todo lo que tiene pertenece al ciclo que todavia no arranco.
      let sourceRows;
      let cycleStart = null;
      let cycleEnd = null;
      if (inRenewalGap) {
        sourceRows = pendingRows;
      } else {
        // Nunca dejar editar un día que la cocina ya tiene confirmado: hoy,
        // uno pasado, o mañana si ya pasó el corte de las 23 (hora de
        // China) -- mismo mínimo que rige para elegir una fecha de arranque
        // nueva (getMinStartDate). Antes esta pantalla dejaba tocar
        // cualquier día del ciclo vigente sin este piso, incluido hoy
        // mismo. El servidor (save-meal-selections) también lo revalida.
        const minEditableDay = getMinStartDate({});
        const rawCycleStart = client.start_date || '';
        cycleStart = rawCycleStart && rawCycleStart > minEditableDay ? rawCycleStart : minEditableDay;
        cycleEnd = client.expiry_date || '';
        sourceRows = (cycleStart && cycleEnd)
          ? currentRows.filter((row) => row.delivery_date >= cycleStart && row.delivery_date <= cycleEnd)
          : currentRows.filter((row) => row.delivery_date >= minEditableDay);
      }
      if (sourceRows.length === 0) { wx.navigateBack(); return; }
      this.setData({ cycleStart, cycleEnd });

      // Un cliente puede tener VARIAS entregas en el mismo día (el panel las
      // maneja como slots: misma `delivery_date`, distinto `slot`). Por eso la clave de
      // cada tab es fecha+slot y no la fecha sola: con la fecha sola, dos
      // slots del mismo día generaban dos tabs con la misma wx:key, y peor,
      // `allSelections[row.delivery_date]` se pisaba entre ellos -- el editor mostraba
      // solo el último y al guardar los demás se perdían.
      const slotsPorFecha = {};
      sourceRows.forEach((row) => { slotsPorFecha[row.delivery_date] = (slotsPorFecha[row.delivery_date] || 0) + 1; });

      const days = sourceRows.map((row) => {
        const parts = formatDateParts(row.delivery_date, _isZh ? 'zh' : 'en');
        return {
          key: `${row.delivery_date}#${row.slot}`,
          date: row.delivery_date,
          slot: row.slot,
          label: weekdayLabelForDate(row.delivery_date),
          short: formatShortDate(row.delivery_date, _isZh ? 'zh' : 'en'),
          shortDate: parts.date,
          shortWeekday: parts.weekday,
          // Si ese día tiene más de una entrega, el horario es lo único que
          // distingue un tab del otro.
          slotLabel: slotsPorFecha[row.delivery_date] > 1 ? (row.delivery_time || '') : '',
          done: false,
        };
      });
      const allSelections = {};
      sourceRows.forEach((row) => {
        allSelections[`${row.delivery_date}#${row.slot}`] = {
          meal_ids: row.meals_json || [],
          time: row.delivery_time || '10:15',
          notes: row.note || '',
          date: row.delivery_date,
          slot: row.slot,
        };
      });

      let rotationAnchor = null;
      let rotationOrder = [1, 2];
      try {
        const rotation = await app.getMenuRotation();
        rotationAnchor = rotation.anchor;
        rotationOrder = rotation.order;
        this.setData({ rotationAnchor, rotationOrder });
      } catch (err) {
        console.error('Load menu rotation error:', err);
      }

      // Una comida elegida en un ciclo anterior puede haber salido del menú
      // (rotación mensual) antes de que el cliente renueve. Se descarta acá
      // -- no solo al abrir ese día -- porque el tick de "día completo" en
      // las tabs de arriba se calcula para los 5 días de una, antes de que
      // el cliente visite ninguno.
      await Promise.all(days.map(async (d) => {
        const sel = allSelections[d.key];
        if (!sel || !sel.meal_ids || sel.meal_ids.length === 0) return;
        const weekIndex = app.getWeekIndexForDay(d.date, rotationAnchor, rotationOrder);
        const menuData = await app.supabase('GET', 'menu', null, `day=eq.${d.label}&tier=eq.${plan.tier}&week_index=eq.${weekIndex}`);
        const menu = menuData && menuData.length > 0 ? menuData[0] : null;
        const validIds = new Set((menu && menu.meals_json) || []);
        const filteredIds = sel.meal_ids.filter(id => validIds.has(id));
        if (filteredIds.length === 0) {
          delete allSelections[d.key];
        } else {
          allSelections[d.key] = Object.assign({}, sel, { meal_ids: filteredIds });
        }
      }));

      const daysWithDone = days.map(d => Object.assign({}, d, {
        done: !!(allSelections[d.key] && allSelections[d.key].meal_ids.length >= plan.meals),
      }));

      // Las pestañas (.day-tab, en el wxss) son flex:1 -- ocupan todo el
      // ancho de la barra sea cual sea la cantidad de días. El tamaño de
      // fuente diseñado (20/16/18/22rpx) era para el caso de SIEMPRE 5
      // pestañas; con menos (días bloqueados filtrados arriba) cada una
      // queda más ancha, y ese texto fijo se ve chico y perdido. Se escala
      // hacia arriba en proporción a cuántas faltan de 5, con un tope para
      // que 1 o 2 pestañas no queden con letras gigantes.
      const tabCount = Math.max(daysWithDone.length, 1);
      const fontScale = Math.min(5 / tabCount, 1.6);
      const dayTabDateSize = Math.round(20 * fontScale);
      const dayTabWeekdaySize = Math.round(16 * fontScale);
      const dayTabSlotSize = Math.round(18 * fontScale);
      const dayTabCheckSize = Math.round(22 * fontScale);

      this.setData({
        clientId, plan, allSelections, days: daysWithDone,
        dayTabDateSize, dayTabWeekdaySize, dayTabSlotSize, dayTabCheckSize,
      });
      // Punto de comparación para "¿hay algo sin guardar?" al salir -- se
      // toma ACA, con lo recien cargado de la base, antes de que el
      // cliente toque nada.
      this.initialSnapshot = this.snapshotState();

      await this.loadMenu(days[0].key);

    } catch (err) {
      console.error('edit-meals onLoad error:', err);
      wx.navigateBack();
    }
  },

  // Vuelve acá desde pages/change-date con el set de fechas nuevo (ver
  // openChangeDates). onShow corre en TODO reingreso a la pantalla
  // (backgrounding incluido), no solo tras ese navigateBack puntual -- por
  // eso se borra `changeDateResult` de entrada, para que un valor viejo no
  // se reaplique en un onShow que no tiene nada que ver.
  onShow() {
    const pending = wx.getStorageSync('changeDateResult');
    if (!pending || !Array.isArray(pending.dates) || pending.dates.length === 0) return;
    wx.removeStorageSync('changeDateResult');
    // onLoad todavia no corrio (primer onShow, antes que termine el
    // await de arriba) -- no hay nada que aplicar todavia.
    if (!this.data.days || this.data.days.length === 0) return;
    this.applyDateSet(pending.dates);
  },

  async loadMenu(dayKey) {
    this.setData({ loading: true, selectedMealIds: [], lastSelectedPhoto: '', lastSelectedName: '' });

    try {
      const { plan, allSelections, rotationAnchor, rotationOrder, days } = this.data;
      // `dayKey` identifica el tab (fecha#slot); la fecha real para resolver
      // menú y rotación sale de la entrada de `days`.
      const dayEntry = days.find(d => d.key === dayKey) || {};
      const dayDate = dayEntry.date || dayKey;
      const dayLabel = weekdayLabelForDate(dayDate);
      const weekIndex = app.getWeekIndexForDay(dayDate, rotationAnchor, rotationOrder);

      const menuData = await app.supabase('GET', 'menu', null, `day=eq.${dayLabel}&tier=eq.${plan.tier}&week_index=eq.${weekIndex}`);
      const menu = menuData && menuData.length > 0 ? menuData[0] : null;

      let meals = [];
      if (menu && menu.meals_json && menu.meals_json.length > 0) {
        const ids = menu.meals_json.filter(Boolean);
        meals = await app.supabase('GET', 'meal_library', null, `id=in.(${ids.join(',')})`);
      }

      // Restore existing selections
      const existing = allSelections[dayKey];
      const existingMealIds = existing ? existing.meal_ids : [];
      const existingTime = existing ? existing.time : '10:15';
      const existingNotes = existing ? existing.notes : '';
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

      const updatedMeals = (meals || []).map(m => Object.assign({}, m, {
        displayName: app.getMealName(m),
        qty: existingMealIds.filter(id => id === m.id).length,
      }));

      const dayIndex = days.findIndex(d => d.key === dayKey);
      const isLastDay = dayIndex === days.length - 1;

      const maxMeals = Math.max((this.data.plan && this.data.plan.meals) || 1, 1);
      const dayConfirmed = existingMealIds.length >= maxMeals;

      this.setData({
        loading: false,
        currentDay: dayKey,
        currentDayLabel: dayLabel,
        menuMeals: updatedMeals,
        selectedMealIds: existingMealIds,
        selectedTime: existingTime,
        currentNotes: existingNotes,
        isLastDay,
        lastSelectedPhoto,
        lastSelectedName,
        dayConfirmed,
      });

    } catch (err) {
      console.error('loadMenu error:', err);
      this.setData({ loading: false });
    }
  },

  previewMeal(e) {
    // Tap en la fila: muestra la foto grande arriba, sin sumar cantidad.
    const meal = e.currentTarget.dataset.meal;
    this.setData({
      lastSelectedPhoto: meal.photo_url || '',
      lastSelectedName: meal.name,
    });
  },

  incrementMeal(e) {
    const meal = e.currentTarget.dataset.meal;
    const { selectedMealIds, plan, menuMeals } = this.data;
    const maxMeals = Math.max((plan && plan.meals) || 1, 1);

    if (selectedMealIds.length >= maxMeals) {
      wx.showToast({ title: t('meal_select_max_meals', maxMeals), icon: 'none' });
      return;
    }

    const newIds = selectedMealIds.concat([meal.id]);
    const updatedMeals = menuMeals.map(m => Object.assign({}, m, {
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
    const { selectedMealIds, menuMeals } = this.data;
    const idx = selectedMealIds.indexOf(meal.id);
    if (idx < 0) return;

    const newIds = selectedMealIds.slice();
    newIds.splice(idx, 1);
    const updatedMeals = menuMeals.map(m => Object.assign({}, m, {
      qty: m.id === meal.id ? Math.max((m.qty || 0) - 1, 0) : m.qty,
    }));

    this.setData({
      selectedMealIds: newIds,
      menuMeals: updatedMeals,
      lastSelectedPhoto: meal.photo_url || '',
      lastSelectedName: meal.name,
    }, () => this.persistCurrentDay());
  },

  onTimeChange(e) { this.setData({ selectedTime: e.detail.value }, () => this.persistCurrentDay()); },
  onNotesInput(e) { this.setData({ currentNotes: e.detail.value }, () => this.persistCurrentDay()); },

  persistCurrentDay() {
    const { selectedMealIds, selectedTime, currentNotes, currentDay, allSelections, plan, days } = this.data;

    const updatedSelections = Object.assign({}, allSelections);
    if (selectedMealIds.length === 0) {
      delete updatedSelections[currentDay];
    } else {
      const prev = allSelections[currentDay] || {};
      const entry = days.find(d => d.key === currentDay) || {};
      updatedSelections[currentDay] = {
        meal_ids: selectedMealIds,
        time: selectedTime,
        notes: currentNotes,
        // Sin esto, al guardar se perdería a qué fecha y a qué entrega del
        // día pertenece lo que se acaba de editar.
        date: prev.date || entry.date,
        slot: prev.slot !== undefined ? prev.slot : entry.slot,
      };
    }

    const maxMeals = Math.max((plan && plan.meals) || 1, 1);
    const dayDone = selectedMealIds.length >= maxMeals;
    const updatedDays = days.map(d => d.key === currentDay ? Object.assign({}, d, { done: dayDone }) : d);

    // dayConfirmed arranca en loadMenu (contra lo que YA estaba guardado al
    // abrir el tab) y hasta acá no se volvía a tocar -- en un día que
    // arranca sin comidas (blank, como los que agrega pages/change-date),
    // completar el cupo con el stepper no lo prendía: el bloque de
    // horario/notas/guardar (wx:if="{{dayConfirmed}}" en el wxml) quedaba
    // escondido hasta cambiar de tab y volver, que sí pasa por loadMenu de
    // nuevo. Se recalcula acá porque persistCurrentDay corre en cada tap
    // del stepper.
    this.setData({ allSelections: updatedSelections, days: updatedDays, dayConfirmed: dayDone });
  },

  switchDay(e) {
    const day = e.currentTarget.dataset.day;
    if (day === this.data.currentDay) return;
    this.persistCurrentDay();
    this.loadMenu(day);
  },

  // Abre pages/change-date para reelegir en bloque las fechas restantes de
  // este ciclo (cycleStart..cycleEnd): las N fechas actuales llegan
  // pre-marcadas, el cliente deselecciona/reselecciona hasta volver a tener
  // N. Solo disponible para el ciclo vigente -- en el hueco de renovacion
  // anticipada (deferToPending) no hay cycleStart/cycleEnd calculados, ver
  // onLoad. Tampoco soporta clientes con mas de una entrega el mismo dia
  // (slot > 1, cargados a mano desde el panel): ese caso no tiene forma de
  // representarse en un set plano de fechas.
  openChangeDates() {
    const { days, cycleStart, cycleEnd } = this.data;
    if (!days.length || !cycleStart || !cycleEnd) return;

    const dates = days.map(d => d.date);
    if (new Set(dates).size !== dates.length) {
      wx.showToast({ title: t('change_date_multi_slot_unsupported'), icon: 'none' });
      return;
    }

    this.persistCurrentDay();
    // cycleEnd NO viaja acá: change-date ya no acota su calendario al
    // expiry_date actual, deja elegir cualquier día hábil libre dentro de
    // una ventana de 14 días desde cycleStart (puede correr la última
    // entrega más allá del expiry_date de hoy a propósito, ver
    // applyDateSet). El límite real lo vuelve a chequear
    // save-meal-selections del lado del servidor, no confía en nada que
    // mande esta pantalla.
    wx.setStorageSync('changeDateRequest', { cycleStart, dates });
    wx.navigateTo({ url: '/pages/change-date/index' });
  },

  // Aplica el set de fechas que eligio pages/change-date (ver onShow):
  // los dias que siguen en el set nuevo se mantienen tal cual (comida,
  // horario y notas intactos); los que salieron se descartan; los que se
  // agregaron entran como tabs en blanco (buildDayEntry) para que el
  // cliente les elija comida. Las fechas que se mantienen no cambian de
  // dia de semana, asi que a diferencia del swap 1 a 1 anterior no hace
  // falta revalidar sus comidas contra el menu -- por eso esto es sincrono.
  applyDateSet(newDates) {
    const { days, allSelections, currentDay, plan, cycleEnd } = this.data;
    const oldSet = new Set(days.map(d => d.date));
    const newSet = new Set(newDates);

    const keptDays = days.filter(d => newSet.has(d.date));
    const addedDays = newDates.filter(d => !oldSet.has(d)).map(buildDayEntry);

    const maxMeals = Math.max((plan && plan.meals) || 1, 1);
    const updatedSelections = {};
    keptDays.forEach((d) => {
      if (allSelections[d.key]) updatedSelections[d.key] = allSelections[d.key];
    });

    let updatedDays = keptDays.concat(addedDays);
    updatedDays.sort((a, b) => (a.date === b.date ? a.slot - b.slot : (a.date < b.date ? -1 : 1)));
    updatedDays = updatedDays.map(d => Object.assign({}, d, {
      done: !!(updatedSelections[d.key] && updatedSelections[d.key].meal_ids.length >= maxMeals),
    }));

    // Si change-date corrio la ultima entrega mas alla del cycleEnd
    // original (expiry_date de hoy), hay que ESTIRAR cycleEnd para que el
    // guardado final (saveAllSelections, mas abajo) mande un `to` que
    // cubra esa fecha nueva -- si no, save-meal-selections la rechazaria
    // por "fuera de rango" contra su propio `to` viejo. Nunca se achica:
    // el dia que quedo vacante en el cycleEnd viejo tiene que seguir
    // dentro del rango que se borra, o quedaria huerfano en la base.
    const sortedNew = newDates.slice().sort();
    const newLastDate = sortedNew[sortedNew.length - 1];
    const updatedCycleEnd = newLastDate > cycleEnd ? newLastDate : cycleEnd;

    // Aterriza en la primera fecha NUEVA (la que todavia no tiene comida
    // elegida) para que el cliente siga directo con eso; si no agrego
    // ninguna (solo saco alguna), se queda en el tab activo de siempre.
    const stillHasCurrent = updatedDays.some(d => d.key === currentDay);
    const landingKey = addedDays.length > 0
      ? addedDays[0].key
      : (stillHasCurrent ? currentDay : updatedDays[0].key);

    this.setData({ days: updatedDays, allSelections: updatedSelections, cycleEnd: updatedCycleEnd }, () => {
      this.loadMenu(landingKey);
    });
  },

  saveAndNext() {
    const { selectedMealIds, plan } = this.data;
    const maxMeals = Math.max((plan && plan.meals) || 1, 1);

    if (selectedMealIds.length < maxMeals) {
      wx.showToast({ title: t('meal_select_select_first', maxMeals), icon: 'none' }); return;
    }

    this.persistCurrentDay();
    this.goNext();
  },

  async goNext() {
    const { currentDay, isLastDay, days } = this.data;

    if (isLastDay) {
      await this.saveAllSelections();
    } else {
      const dayIndex = days.findIndex(d => d.key === currentDay);
      this.loadMenu(days[dayIndex + 1].key);
    }
  },

  // Guarda TODO `allSelections` de una (no depende de estar parado en el
  // ultimo tab -- goNext() lo llama ahi solo por flujo de UI, pero el
  // guardado en si no le importa que dia este activo). La usan tanto el
  // boton "Save"/"Save & Next" del ultimo tab como "Guardar" del aviso de
  // salir sin guardar (ver confirmExit).
  async saveAllSelections() {
    wx.showLoading({ title: t('loading') });
    try {
      await app.saveMealSelections(this.data.clientId, this.data.allSelections, {
        deferToPending: this.data.deferToPending,
        // Acotar el DELETE al mismo ciclo que se mostro: si no, guardar
        // borraria las filas de otras fechas que esta pantalla ni
        // muestra (las del ciclo siguiente, por ejemplo).
        from: this.data.cycleStart,
        to: this.data.cycleEnd,
      });
      wx.hideLoading();
      wx.showToast({ title: t('edit_meals_updated'), icon: 'success' });
      setTimeout(() => wx.reLaunch({ url: '/pages/home/index' }), 1000);
      return true;
    } catch (err) {
      wx.hideLoading();
      console.error('Save error:', err);
      wx.showToast({ title: t('edit_meals_failed'), icon: 'none' });
      return false;
    }
  },

  // Foto canonica (independiente del orden de las claves) de "que hay
  // guardable ahora mismo": para cada tab, sus meal_ids (ordenados)+
  // horario+notas, o vacio si todavia no tiene comida elegida. Cambia si
  // se edita una comida/horario/nota, o si change-date agrego/saco un dia
  // -- se compara contra `initialSnapshot` (tomado al final de onLoad) para
  // saber si hay algo sin guardar.
  snapshotState() {
    const { days, allSelections } = this.data;
    return days
      .map(d => d.key)
      .sort()
      .map((key) => {
        const sel = allSelections[key];
        // Sin comidas elegidas equivale a "esta fila no existe" tanto para
        // persistCurrentDay() (que la borra de allSelections apenas
        // selectedMealIds queda en 0) como para el guardado real
        // (save-meal-selections descarta cualquier entrada con meal_ids
        // vacío) -- normalizar los dos casos acá evita un falso "hay
        // cambios sin guardar" en un día que nunca tuvo comida.
        if (!sel || !sel.meal_ids || sel.meal_ids.length === 0) return `${key}:`;
        return `${key}:${sel.meal_ids.slice().sort().join(',')}|${sel.time || ''}|${sel.notes || ''}`;
      })
      .join(';');
  },

  hasUnsavedChanges() {
    if (!this.data.days || this.data.days.length === 0) return false;
    return this.snapshotState() !== this.initialSnapshot;
  },

  // true si algún día del ciclo (no solo el tab activo) se quedó con menos
  // comidas de las que pide el plan -- mismo criterio que ya usaba
  // saveAndNext() para el tab activo (selectedMealIds.length < maxMeals),
  // pero mirando TODOS los tabs vía su flag `done`, para el caso de que el
  // cliente deje incompleto un día y se vaya a otro antes de intentar
  // salir.
  hasIncompleteDay() {
    if (!this.data.days || this.data.days.length === 0) return false;
    return this.data.days.some(d => !d.done);
  },

  // Bloquea la salida sin ofrecer guardar ni descartar: un día sin comida
  // completa no es algo que tenga sentido "descartar" tampoco, hay que
  // resolverlo primero. Mismo mensaje que ya usa saveAndNext().
  warnIncompleteDay() {
    const maxMeals = Math.max((this.data.plan && this.data.plan.meals) || 1, 1);
    wx.showToast({ title: t('meal_select_select_first', maxMeals), icon: 'none' });
  },

  // Aviso de "salir sin guardar": Guardar (guarda todo y listo, mismo
  // camino que el boton del ultimo tab), Descartar (sale sin tocar el
  // servidor), o cerrar el menu (se queda en la pantalla, sin hacer nada).
  confirmExit() {
    wx.showActionSheet({
      itemList: [t('edit_meals_unsaved_save'), t('edit_meals_unsaved_discard')],
      success: (res) => {
        if (res.tapIndex === 0) this.saveAllSelections();
        else if (res.tapIndex === 1) wx.navigateBack();
      },
    });
  },

  goBack() {
    this.persistCurrentDay();
    if (this.hasIncompleteDay()) { this.warnIncompleteDay(); return; }
    if (!this.hasUnsavedChanges()) { wx.navigateBack(); return; }
    this.confirmExit();
  },

  // Cubre el back nativo de WeChat (gesto de swipe en iOS, capsula del
  // sistema, boton fisico Android) -- ese camino NO pasa por goBack(), asi
  // que sin esto ni el aviso de comida incompleta ni el de cambios sin
  // guardar saltaban, solo tocando la flecha propia del topbar. Devolver
  // `true` le dice a WeChat que frene el navigateBack automatico.
  onBackPress() {
    this.persistCurrentDay();
    if (this.hasIncompleteDay()) { this.warnIncompleteDay(); return true; }
    if (!this.hasUnsavedChanges()) return false;
    this.confirmExit();
    return true;
  },
});
