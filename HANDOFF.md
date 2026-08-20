# FIT IGNYTE — Estado y pendientes (2026-08-20)

Repos involucrados:
- **Mini-program**: `C:\Users\USER\WeChatProjects\miniprogram-1` (este repo)
- **Panel admin (web)**: `C:\Users\USER\Desktop\FIT-IGNYTE` (repo git separado, `github.com/BautiLobo/FIT-IGNYTE`)
- **Supabase**: proyecto `ychpcxloiwelyrwcsebf` (compartido por ambas apps)

Contexto: la app está por mandarse como **beta a varios testers** (no producción completa todavía). Legal/licencias ya aprobado por WeChat; solo falta la aprobación del código.

---

## 🔴 Pendiente — hacer antes de producción completa (NO antes de la beta)

- **Delivery fee en $0**, a propósito, para la beta actual. Volver a **$35** cuando se pase a producción completa, en 4 lugares:
  - `pages/order-summary/index.js` (2 ocurrencias: alta nueva y renovación)
  - `pages/payment/index.js` (2 ocurrencias: carga inicial y al aplicar código de referido)
  - Edge Function `create-payment` (`const DELIVERY_FEE = 0` → volver a `35`) — **esta es la que de verdad cobra**, las otras son solo visuales.

## 🟡 Pendiente — decisión del usuario, no urgente

- **Toggle "Allow new users to sign up" en Supabase Dashboard** (Authentication → Sign In / Providers → Email) — sin tocar. No es crítico (`is_admin()` ya neutraliza el riesgo si alguien se registra), pero es recomendable cerrarlo. No hay herramienta de Claude que llegue a esa config, lo tiene que hacer el usuario a mano.
- **`meal_selections` sigue con `SELECT` público** (`USING true`) — decisión consciente de dejarlo así. Migrarlo es más quilombo que `new_orders`/`clients` porque `edit-meals.js` también lo toca con las mismas keys (`client_id/day/slot`), y no queremos repetir el bug que rompió el flujo de `new_orders` la primera vez. Bajo riesgo real: solo expone comidas elegidas + horario + notas, sin nombre/teléfono/dirección directos.
- **Modal "Edit Menu" huérfano** en el panel admin (`App.jsx`) — se encontró que `openEditMenu` (la única función que abría ese modal) ya estaba muerta antes de cualquier cambio nuestro; se borró la función muerta pero el modal (`showMenuModal`/`saveMenu`/`menuForm`) sigue en el código, inalcanzable. Decidir: ¿reconectarlo a algún botón o borrarlo del todo?
- Hardening cosmético sin apuro: 3 funciones de Postgres con `search_path` mutable (`notifications_restrict_anon_update`, `increment_renewal_count`, `clean_menu_on_plan_delete`), extensión `pg_net` instalada en schema `public`, "leaked password protection" desactivada en Supabase Auth (solo afecta la cuenta de admin con login por password).

---

## ✅ Ya arreglado y verificado esta sesión

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
