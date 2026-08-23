# FIT IGNYTE — Estado y pendientes (2026-08-22)

Repos involucrados:
- **Mini-program**: `C:\Users\USER\WeChatProjects\miniprogram-1` (este repo)
- **Panel admin (web)**: `C:\Users\USER\Desktop\FIT-IGNYTE` (repo git separado, `github.com/BautiLobo/FIT-IGNYTE`)
- **Supabase**: proyecto `ychpcxloiwelyrwcsebf` (compartido por ambas apps)

Contexto: la app está por mandarse como **beta a varios testers** (no producción completa todavía). Legal/licencias ya aprobado por WeChat; solo falta la aprobación del código.

---

## 🔴 Pendiente — hacer antes de producción completa (NO antes de la beta)

*(vacío por ahora — el delivery fee, que era el único ítem acá, se volvió a
poner en $35 el 2026-08-22, ver sección de esta sesión)*

## 🟡 Pendiente — decisión del usuario, no urgente

- **Toggle "Allow new users to sign up" en Supabase Dashboard** (Authentication → Sign In / Providers → Email) — sin tocar. No es crítico (`is_admin()` ya neutraliza el riesgo si alguien se registra), pero es recomendable cerrarlo. No hay herramienta de Claude que llegue a esa config, lo tiene que hacer el usuario a mano.
- **`meal_selections` sigue con `SELECT` público** (`USING true`) — decisión consciente de dejarlo así. Migrarlo es más quilombo que `new_orders`/`clients` porque `edit-meals.js` también lo toca con las mismas keys (`client_id/day/slot`), y no queremos repetir el bug que rompió el flujo de `new_orders` la primera vez. Bajo riesgo real: solo expone comidas elegidas + horario + notas, sin nombre/teléfono/dirección directos.
- **Modal "Edit Menu" huérfano** en el panel admin (`App.jsx`) — se encontró que `openEditMenu` (la única función que abría ese modal) ya estaba muerta antes de cualquier cambio nuestro; se borró la función muerta pero el modal (`showMenuModal`/`saveMenu`/`menuForm`) sigue en el código, inalcanzable. Decidir: ¿reconectarlo a algún botón o borrarlo del todo?
- Hardening cosmético sin apuro: 2 funciones de Postgres con `search_path` mutable (`notifications_restrict_anon_update`, `clean_menu_on_plan_delete` — `increment_renewal_count` ya se arregló, ver sesión 2026-08-21), extensión `pg_net` instalada en schema `public`, "leaked password protection" desactivada en Supabase Auth (solo afecta la cuenta de admin con login por password).
- **Renovación anticipada (feature de la sesión 2026-08-21, ver detalle
  abajo)**: backend y mini-program ya se probaron en WeChat DevTools por el
  usuario (sesión 2026-08-22, con `SIMULATE_PAYMENTS` para no pagar plata
  real) — aparecieron varios bugs reales durante esa prueba, todos
  arreglados esa misma sesión (ver más abajo). **Falta la prueba manual
  todavía**: registro nuevo completo, address change, notificaciones, y
  repasar las pantallas en chino (`i18n`) — nada de eso se tocó esta sesión
  pero comparte código con lo que sí se tocó.

---

## ✅ Ya arreglado y verificado — sesión 2026-08-22 (bugs encontrados probando en WeChat DevTools + notificaciones + delivery fee)

El usuario probó el flujo de renovación anticipada de verdad en WeChat
DevTools (con `SIMULATE_PAYMENTS`, ver `RENEWAL_PLAN.md`). Aparecieron
varios bugs reales, todos arreglados y probados esta sesión:

### Mini-program
- **`home.js` — `getDaysLeft()`**: mezclaba fecha UTC con hora local;
  en huso de Shanghai el corte de "1 día antes" no era confiable entre
  00:00 y 08:00. Arreglado (comparación por fecha de calendario). De paso
  se ajustó la ventana del banner de renovar a 2 días antes (o viernes), con
  texto "Ends today"/"Ends tomorrow"/"%s days left" según corresponda.
- **`renewal.js` — cálculo de `expired`**: mismo tipo de bug (UTC vs
  local) — mostraba "PLAN EXPIRED" antes de tiempo. Arreglado.
- **`edit-meals.js` — prefill roto en renovación anticipada**: "Renew this
  plan" mostraba la pantalla en blanco en vez de las comidas actuales,
  porque el prefill leía directo de `pending_meal_selections` (vacía hasta
  que el cliente elige algo). Arreglado: el prefill siempre arranca de
  `meal_selections` (lo que el cliente tiene ahora) y solo pisa por encima
  con `pending_meal_selections` si ya hay algo ahí. Probado a fondo,
  incluyendo simular el flujo completo "Renew this plan" con los 5 días
  contra datos reales — confirmado que nunca pisa la semana en curso.
- **`home.wxml` — warning de `wx:key` duplicada**: un cliente puede elegir
  la misma comida 2 veces en un día (2 porciones); la key usaba el
  `name`, que entonces se repetía. Arreglado con `id + posición`.
- **Delivery fee vuelto a $35** (estaba en $0 a propósito para la beta) en
  los 5 lugares documentados (4 en el mini-program + `create-payment`, la
  que de verdad cobra). Probado contra un plan real: el monto calculado
  ahora incluye los $35 correctamente.

### Notificaciones automáticas — 2 huecos cerrados
Ninguno de los dos se armó desde cero — se extendió lo que ya existía:
- **"Tu plan arranca mañana" no le llegaba a nadie con renovación
  anticipada** (`clients.start_date` no se actualiza hasta que se aplica
  el ciclo nuevo). `wx-notify-cron` ahora también busca en `payments`
  (pagado, sin aplicar, `start_date=mañana`).
- **Nadie se enteraba cuando su renovación anticipada se aplicaba** — no
  existía ningún aviso. `apply_pending_renewals()` ahora inserta una
  notificación in-app (tabla `notifications`, mismo banner de Home que ya
  existía) en el mismo paso atómico que aplica el resto del ciclo.

### Panel admin (`FIT-IGNYTE`, con la extensión de Chrome conectada)
Se probó en vivo (dashboard, crear cliente, editar, Renewals, Payments,
Orders, Plans, Notifications) — todo funciona. 3 bugs nuevos encontrados y
arreglados, no relacionados con la renovación anticipada:
- **Loop de 4 fetches redundantes en cada carga de página** —
  `useEffect` dependía del objeto `session` completo en vez de
  `session?.user?.id` (estable). Causaba el "Loading..." pegado que se vio
  al probar por primera vez.
- **`fmtDate()` mostraba la fecha un día antes** en husos horarios
  detrás de UTC (rompía en esta máquina, Buenos Aires) — no afecta la
  lógica de Active/Expired (`daysUntil()` ya estaba bien), solo el texto
  de fecha en 3 lugares.
- **`todayIso()` — bug inverso, este sí afecta a China**: usaba
  `.toISOString()` (siempre UTC); en husos adelantados a UTC (Shanghai,
  +8) de noche ya cruzó al día siguiente en UTC, así que un admin en China
  creando un cliente de noche vería precargado "ayer" en "Start Date".
  Arreglado, verificado con matemática exacta para ambos husos.

Detalle técnico completo, con cada prueba documentada paso a paso, en
`RENEWAL_PLAN.md` y `C:\Users\USER\Desktop\TEST_PLAN.md`.

---

## ✅ Ya arreglado y verificado — sesión 2026-08-21 (renovación anticipada)

Plan completo con todo el detalle técnico (causas raíz, diseño, decisiones,
qué se probó de cada pieza) en `C:\Users\USER\Desktop\RENEWAL_PLAN.md`.
Resumen:

### El problema que se resolvió
Hasta ayer, para renovar el plan **tenía que estar vencido** — si terminaba
el martes, recién el miércoles se podía entrar al flujo de renovación,
perdiendo como mínimo un día de servicio. Se encontraron 4 causas raíz: el
gate de `discovery.js` (mandaba a Home mientras el status fuera `Active`,
sin importar cuán cerca del vencimiento), `start-date.js` (la fecha mínima
no miraba el vencimiento del plan actual), y — las dos más delicadas —
`meal_selections` y `clients` no tenían noción de "ciclo": una renovación
anticipada pisaría en el acto la semana que la cocina ya está preparando
(`meal_selections`) y el estado Active/Upcoming del cliente en el mismo
Home/panel admin (`clients`), apenas se confirmara el pago.

### Backend (Supabase, proyecto `ychpcxloiwelyrwcsebf`) — desplegado y activo
- **Tabla nueva `pending_meal_selections`**: "sala de espera" del menú del
  próximo ciclo (misma forma que `meal_selections` + `UNIQUE(client_id,
  day, slot)`), para no pisar la semana en curso.
- **Columna `payments.applied`**: distingue un pago ya reflejado en
  `clients`/`meal_selections` de uno todavía pendiente de aplicar.
- **`complete-payment`** (v10): si el pago es una renovación y el plan
  actual del cliente todavía no venció, ya no toca `clients` — deja el pago
  marcado `paid`/`applied=false` para que lo aplique el cron. Si el plan ya
  venció o es alta nueva, se comporta exactamente igual que antes.
- **`create-payment`** (v10): bloquea una segunda renovación mientras haya
  una ya pagada sin aplicar (`409 duplicate_pending_renewal`) — de paso
  cierra la ventana para reusar un código de referido antes de que la
  primera se aplique.
- **`get-payment-status`** (nueva): chequeo liviano de `payments.status`
  por `out_trade_no`, sin PII — para que el mini-program pueda confirmar
  un pago sin depender de `clients.paid` cuando la aplicación quedó
  diferida.
- **`apply_pending_renewals()`**: función de Postgres (no Edge Function —
  no hace falta HTTP) llamada por `pg_cron` todos los días a las 00:10
  hora Shanghai (antes que `wx-notify-cron`). Aplica `clients` +
  `pending_meal_selections → meal_selections` juntos por cada pago que
  corresponda ese día, cliente por cliente con aislamiento de errores
  (uno que falla no frena a los demás ni queda a medias), y con
  autocorrección si el cron no llegó a correr algún día (`start_date <=
  hoy`, no `=`).

Cada pieza del backend se probó individualmente contra la base real con
clientes descartables (creados y borrados en la misma sesión) — incluyendo
un caso de fallo forzado a propósito (FK inválida) para confirmar que el
aislamiento por cliente funciona.

### Mini-program (este repo) — escrito y probado a nivel de integración, falta subir a WeChat DevTools
- `pages/home/index.wxml`: banner "Renovar" conectado a `showRenewal`/
  `goToRenewal()` — código que ya existía sin usar en el `.js` y en el
  `.wxss`.
- `pages/start-date/index.js`: cuando viene de una renovación, la fecha
  mínima de inicio pasa a ser el día siguiente al vencimiento del plan
  actual (no antes), reutilizando el helper de feriados que ya existía.
- `pages/edit-meals/index.js` y `pages/payment/index.js`: si el plan
  actual sigue activo, las elecciones de menú van a
  `pending_meal_selections` en vez de `meal_selections` (con el prefill
  correspondiente también corregido en `edit-meals.js`).
- `pages/payment/index.js`: la confirmación de pago sondea
  `payments.status` en vez de `clients.paid` cuando la aplicación quedó
  diferida; y si igual se llegara a intentar pagar una renovación
  duplicada (dos pestañas, caché vieja), muestra un mensaje claro en vez
  del error genérico.
- `pages/home/index.js`: **bug encontrado y arreglado** — `getDaysLeft()`
  mezclaba una fecha parseada como UTC con la hora local del dispositivo;
  en huso de Shanghai esto hacía que el banner de renovar pudiera no
  aparecer todavía entre las 00:00 y las 08:00 del día antes del
  vencimiento. Reescrito para comparar fechas de calendario (medianoche a
  medianoche, hora local), verificado con una simulación de horarios.
  De paso, `home.js` ahora también sabe si ya hay una renovación anticipada
  pagada-sin-aplicar (`get-client` la adjunta) — oculta el botón de
  renovar y muestra en su lugar "✓ Renewal confirmed" con la fecha en que
  arranca el ciclo nuevo.
- `get-client` (v7): adjunta `pending_renewal` (`{start_date,
  out_trade_no}` o `null`) a la fila del cliente en la misma respuesta.
- `app.js`: helpers nuevos `getPaymentStatus()`; `createPayment()` ahora
  adjunta `err.code` con el error estructurado del backend.
- `i18n/en.js` / `i18n/zh.js`: labels nuevos para los banners de Home y el
  mensaje de renovación duplicada.

**Pendiente antes de considerar esto terminado**: subir el build a WeChat
DevTools y probar el flujo completo en el simulador (o dispositivo real)
— lo de arriba está probado a nivel de API/base de datos, no a nivel de UI
del mini-program.

### De paso: bug real encontrado y arreglado (no relacionado con lo de arriba)
`increment_renewal_count` (llamada desde el panel admin en Desktop,
`App.jsx` línea 1340, al editar manualmente la fecha de vencimiento de un
cliente) estaba definida con el parámetro tipado `uuid` en vez de
`integer` — **nunca había funcionado**, fallaba en silencio porque el
call site tiene `.catch(()=>{})`. El contador de renovaciones en el panel
admin se incrementaba solo en el estado local de React, nunca se guardaba
en la base. Arreglado (migración `fix_increment_renewal_count_param_type`)
y verificado con una prueba real (incrementó y se restauró después).

---

## ✅ Ya arreglado y verificado — sesión 2026-08-20

### Seguridad — Supabase / RLS
- **`clients` y `new_orders`** tenían policies RLS abiertas a `anon` (`update_anon_clients` true/true, `select_all_new_orders`/`update_anon_new_orders` true) — permitían a cualquiera con la key pública marcar cualquier cliente como pagado, leer/editar todos los pedidos (PII: nombre, teléfono, dirección, alergias). **Cerradas.** Todo el acceso del mini-program ahora pasa por Edge Functions con `service_role`: `get-client`, `update-client`, `get-order`, `update-order`, `create-order`.
- **`complete-payment`** no validaba nada — cualquiera podía invocarla directo y activar cualquier cliente sin pagar. Ahora exige un `out_trade_no` de un pago que la tabla `payments` ya tenga en `status='paid'` (solo `wx-pay-webhook` puede escribir eso, tras desencriptar la notificación real de WeChat Pay).
- **Registro público de usuarios en Supabase Auth estaba abierto** (probado empíricamente con una cuenta descartable, luego borrada) — cualquiera podía crear una cuenta y quedar con `role: authenticated`, el mismo nivel que el admin real, porque todas las policies `_auth_` del proyecto solo chequeaban `auth.role()='authenticated'` sin verificar identidad. Se creó `public.is_admin()` (función `SECURITY DEFINER` que consulta una tabla `admin_emails` con RLS cerrado, sembrada con `tristan_loboviale@hotmail.com`) y se reescribieron **todas** las policies `_auth_` del proyecto (clients, new_orders, plans, menu, meal_library, meal_selections, checklist, delivery_status, settings, coaches, tiers, address_changes, notifications) para usar `is_admin()` en vez de `auth.role()='authenticated'`.
- **`address_changes` y `notifications`** también tenían `SELECT` público (`USING true`) — exponían direcciones (vieja/nueva) y el contenido de notificaciones (que a veces incluye la dirección en el texto). Cerradas igual que `new_orders`: nuevas Edge Functions `get-address-changes`, `submit-address-change`, `get-notifications`, `mark-notification-read`, todas con `service_role`.
- **Dedupe por `wechat_openid`** en `register.js` solo miraba la tabla `clients` (que recién existe cuando el admin aprueba) — dejaba mandar pedidos duplicados mientras el primero seguía en `draft`/`pending`. Ahora `create-order` chequea esto también, atómico con el insert.

### Bugs funcionales encontrados y arreglados
- **`payment.js`**: al migrar de `app.supabase()` a `app.getOrder()`, faltó el guard `if (!pendingOrderId) return;` que sí tenían todas las demás páginas — causaba un 400 (`Missing orderId`) si se llegaba a esa página sin una orden pendiente en storage. Arreglado en los 2 lugares donde pasaba (onLoad y `finishAfterPayment`).
- **`clients.status`** (columna en la DB) queda desactualizada — se escribe una vez al pagar y nunca más se sincroniza; el resto del sistema ya la ignora y recalcula Active/Upcoming/Inactive al vuelo desde `start_date`/`expiry_date`. Rompía dos cosas que sí confiaban en la columna:
  - `wx-notify-cron` (aviso diario de "tu plan vence/arranca mañana") — reescrito para filtrar por fecha en vez de por `status`. **Verificado con datos reales**: encontró correctamente 24 clientes con vencimiento al día siguiente (no les mandó nada porque son cuentas de prueba sin `wechat_openid`, esperado).
  - Notificación masiva por status en el panel admin (`App.jsx` línea ~932) — ahora usa `getRealStatus()` como el resto del archivo.

### Código muerto / limpieza
- `App.jsx` (panel admin): eliminadas ~14 variables/funciones sin usar (`no-unused-vars`) y un `fontWeight` duplicado. Bajó de 24 a 10 problemas de eslint (los que quedan son warnings de `exhaustive-deps` y 2 casos de "refs durante render" que son un patrón intencional, no bugs). Verificado con `npm run build` + prueba manual en `localhost:5173` por el usuario — **todo OK**.

### Copy / contenido (pedidos del usuario, no bugs)
- Sacado el botón "View Full Menu PDF" de `how-it-works` (bloqueaba el botón "Get Started").
- Textos de `order-summary`, `how-it-works`, `tiers`, `register`, `plans` actualizados/acortados varias veces según pedidos puntuales (ver historial de conversación si hace falta el detalle exacto).
- `pages/start-date`: después de las 20:00, la fecha mínima de inicio salta un día extra (no se puede más elegir "mañana" tarde en la noche).
- Botón de `how-it-works` cambiado de "Get started →" a "Choose your plan →" (no repetir el texto de `discovery`).
- Tiers page: agregada línea de kcal/proteína por tier (`tiers_balance_kcal`/`tiers_performance_kcal`).
- Plans page: hooks de cada plan actualizados + agregada proteína/día (calculada como proteína-por-comida-del-tier × cantidad de comidas: 35g Balance / 55g Performance).

---

## Verificado end-to-end por el usuario
- Flujo completo de pago (nuevo) — funcionó perfecto.
- Flujo completo de renovación, incluyendo cambio de dirección — funcionó perfecto.
- Notificación push recibida correctamente tras el cambio de dirección.
- Panel admin en localhost tras la limpieza de código muerto — sin problemas.

## Notas técnicas para retomar
- Todas las Edge Functions nuevas usan `verify_jwt: false` (consistente con las preexistentes) y `service_role` — nunca exponen esa key al cliente.
- Patrón establecido para "cerrar una tabla a anon": crear Edge Function(s) específicas con `service_role`, migrar las policies RLS relevantes a `is_admin()` (o borrarlas si nadie más las necesita), actualizar `app.js` con un helper, y actualizar cada page que la usaba directo. **Ojo con `Prefer: return=representation`**: si un INSERT/PATCH necesita devolver la fila, el rol que escribe también necesita poder leerla — por eso todo pasa por `service_role` ahora, no por policies anon combinadas con SELECT.
- `admin_emails` solo tiene `tristan_loboviale@hotmail.com` sembrado. Si Tati necesita su propio login al panel, hay que agregar su email ahí.
- **Cron jobs en pg_cron**: dos por ahora — `wx-notify-cron-daily` (09:01 Shanghai, llama a una Edge Function porque necesita pegarle a la API de WeChat) y `apply-pending-renewals-daily` (00:10 Shanghai, llama directo a una función de Postgres `apply_pending_renewals()` porque es todo lectura/escritura interna, sin necesidad de HTTP ni Edge Function). Ver `cron.job` en Supabase para la lista completa.
- Snapshot completo de "antes" de tocar el flujo de renovación (commits de ambos repos, schema, dump de `clients`/`payments`/`meal_selections`, código de las Edge Functions tocadas) en `C:\Users\USER\Desktop\FIT-IGNYTE-backups\2026-08-21-pre-renewal-flow\` por si hace falta comparar o revertir algo puntual.
