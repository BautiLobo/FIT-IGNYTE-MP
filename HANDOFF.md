# FIT IGNYTE — Estado y pendientes (2026-09-26)

Repos involucrados:
- **Mini-program**: `C:\Users\USER\WeChatProjects\miniprogram-1-dev` (este repo — **activo**, es el que hay que abrir en WeChat DevTools). Existe también `C:\Users\USER\WeChatProjects\miniprogram-1` (sin `-dev`), una copia vieja/desactualizada que **no** tiene nada del trabajo reciente y sigue apuntando a producción — evaluar borrarla para no confundirla con la activa (causó un incidente real, ver sesión 2026-09-14).
- **Panel admin (web)**: `C:\Users\USER\Desktop\FIT-IGNYTE` (repo git separado, `github.com/BautiLobo/FIT-IGNYTE`, apunta a producción) — y una copia nueva **solo local** `C:\Users\USER\Desktop\FIT-IGNYTE-dev` (sin git remoto), apuntando al proyecto de test, para poder tocar el panel admin sin riesgo. Ver sesión 2026-09-14.
- **Supabase producción**: proyecto `ychpcxloiwelyrwcsebf` (compartido por ambas apps).
- **Supabase test/dev**: proyecto `fit-ignyte-dev` (`cnsthdlgncdjuxatskon`) — base separada, para probar sin tocar clientes/pedidos reales. `config.js` del mini-program y `.env`/`.env.development` del panel admin-dev ya apuntan acá.

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
- **Renovación anticipada (feature de la sesión 2026-08-21)**: probada de
  punta a punta de nuevo en la sesión 2026-09-23 (ver más abajo), con varios
  bugs reales encontrados y arreglados. Sigue faltando probar manualmente:
  address change, notificaciones push reales, y repasar las pantallas en
  chino (`i18n`) — nada de eso se tocó en ninguna sesión reciente pero
  comparte código con lo que sí se tocó.

---

## 🔴 Pendiente — plan completo hacia producción (actualizado 2026-09-26)

**Nada de esto se aplicó todavía a producción.** El usuario pidió armar el
plan de despliegue esta noche (60 clientes activos hoy); se acordó
repasarlo primero, sin tocar nada, y ejecutar en otra sesión con más
tiempo. Orden acordado, cada fase depende de que la anterior ya esté:

- **Fase 0 — Portar lo de la sesión 2026-09-23** (renovación anticipada,
  pago tardío, huso horario, "Start Over") a producción. Probado de punta
  a punta en dev, nunca desplegado. Va primero porque las fases siguientes
  se construyen encima de este código.
- **Fase 1 — Migración aditiva de schema** en `ychpcxloiwelyrwcsebf`:
  columna nueva `delivery_date` (date) en `meal_selections`/
  `pending_meal_selections`, sincronizada por triggers con la `day` vieja
  (texto), + `UNIQUE(client_id, delivery_date, slot)` (nunca existió una
  constraint real, ver hallazgo de la sesión 2026-09-18 más abajo).
  Aditiva y reversible, **sin ventana de mantenimiento** — viejo y nuevo
  conviven indefinidamente, justamente porque no hay
  `wx.getUpdateManager()` en ninguna versión del mini-program y un cliente
  con la app cacheada puede seguir con el código viejo horas o días
  después de publicar. Migración ya escrita y ensayada 45/45 en un schema
  aislado: `supabase/migrations/20260917000000_add_delivery_date.sql`.
  **Es el paso de menor riesgo de todo el plan** y todo lo demás depende
  de que exista.
- **Fase 2 — Backend a `delivery_date`**: `apply_pending_renewals()`,
  `complete-payment`, `wx-notify-cron`, panel admin real. Deploy
  instantáneo (Edge Functions + función de Postgres), pero **no es
  opcional antes de la Fase 5**: si un cliente ya con el mini-program
  nuevo renueva con un patrón "dos lunes" antes de que esto salga, la
  renovación falla contra el UNIQUE nuevo (ver test 35-38, sesión
  2026-09-18).
- **Fase 3 — Lo de la sesión 2026-09-25/26** (ver detalle en la sección de
  esa sesión más abajo): `save-meal-selections` + `change-date` (ventana
  de 14 días hábiles + auto-sync de `expiry_date`) + segundo fix de
  `changePlan()` + rediseño de `renewal` + botón de menú en Home. Depende
  de que `delivery_date` ya exista (Fase 1) — `save-meal-selections` hoy
  asume que `day` es una fecha real; contra el `day` de texto que todavía
  tiene producción, rompería en el momento para cualquier cliente que use
  el `edit-meals` nuevo.
- **Fase 4 — Panel admin real**: portar `FIT-IGNYTE-dev` (local, sin git)
  → `FIT-IGNYTE` (con remoto, `github.com/BautiLobo/FIT-IGNYTE`). Implica
  un commit/push real al repo de producción — pedir OK aparte llegado el
  momento.
- **Fase 5 — Mini-program**: restaurar `config.js` a producción, subir
  versión, publicar. **Confirmado con el usuario (2026-09-26): el canal de
  publicación sin revisión sigue disponible** — no hay ninguna revisión de
  WeChat de por medio, el código queda en vivo apenas se sube. Igual
  aplica el mismo aviso de la Fase 1: los teléfonos con la app ya abierta
  no actualizan solos.
- **Fase 6 — Limpieza**, semanas después: borrar `day` y los triggers una
  vez que todos los clientes renovaron con el código nuevo (la rotación es
  rápida porque todos renuevan semanalmente).
- Validación server-side de fechas en `create-payment` (hoy no valida nada
  de lo que manda el cliente) — mejora opcional, no bloqueante.

### ✅ Fase 1 aplicada a producción (2026-09-26)

Migración `add_delivery_date` corrida contra `ychpcxloiwelyrwcsebf` (vía
`apply_migration`, transaccional). Pre-chequeos re-hechos el mismo día
(no los de la sesión 2026-09-18, que ya tenían 8 días): 501 filas en
`meal_selections` / 5 en `pending_meal_selections`, 0 `day` no
reconocido, 0 sin `start_date`, 0 duplicados simulados contra el
`UNIQUE` nuevo. Post-migración verificado: 501/501 `meal_selections` con
`delivery_date` backfillado; las 5 filas de `pending_meal_selections`
(un solo cliente, `id 368`) quedaron en NULL a propósito — no tiene
ningún pago pendiente `paid/applied=false` todavía, confirmado por
query aparte. Advisors de seguridad revisados: sin hallazgos nuevos
(los warnings preexistentes siguen igual, ver sección de hardening
cosmético). **Nada más de la Fase 1 quedó pendiente** — sigue la Fase 2
(backend a `delivery_date`), todavía sin escribir.

### 🟡 Fases 2/3 escritas (2026-09-26) — NADA desplegado a producción

Regla única en todo el código: las lecturas/escrituras de
`meal_selections`/`pending_meal_selections` usan `delivery_date`, nunca
`day`. En prod el trigger de la Fase 1 deriva `day` para la app vieja. La
tabla `menu` también tiene una columna `day` (rotación Lun-Vie) — esa NO
se tocó.

- **Schema de dev alineado con prod**: en `fit-ignyte-dev` se renombró
  `day`→`delivery_date` (nullable) y se agregó `day` texto legacy + los
  mismos helpers/triggers de la Fase 1. Dev es ahora espejo de prod.
- **`supabase/migrations/20260926000000_apply_pending_renewals_delivery_date.sql`**
  (pendiente para prod, aplicada en dev):
  - `apply_pending_renewals()` inserta `delivery_date` explícito + trae a
    prod la rama `payments.selections` (antes solo en dev). Fallback de
    filas legacy re-deriva la fecha; `on conflict do nothing` para que un
    duplicado no tire la renovación entera.
  - Trigger nuevo `backfill_pending_dates_on_paid` en `payments`: la app
    vieja escribe pendientes antes de que el pago sea `paid` → quedaban con
    fecha NULL. Al pasar a `paid` se completan. Nunca hace fallar el pago
    (captura cualquier error).
  - Probado en dev con rollback: "dos lunes", fila legacy, choque
    legacy-vs-explícita, backfill al pagar, choque forzado en el backfill.
- **Edge Functions** (`save-meal-selections`, `complete-payment`,
  `wx-notify-cron`): a `delivery_date`. `save-meal-selections` además borra
  filas NULL legacy al reemplazar un rango; `complete-payment` ignora
  duplicados y ya no deja al cliente sin comidas si falla el fallback.
  Desplegadas en **dev** (2026-09-26, CLI con `--project-ref` explícito;
  prod verificado sin cambios). `save-meal-selections` probada contra dev
  con cliente descartable: borra la fila legacy NULL al reemplazar un
  rango, respeta filas fuera del rango, guarda "dos martes" y sincroniza
  `expiry_date`, rechaza fechas fuera de la ventana de 14 días hábiles.
- **Ramas para revisar**: `FIT-IGNYTE-MP` → `dev`; `FIT-IGNYTE` →
  `migration-dev` (la `dev` vieja de ese repo tiene código de mini-program
  de junio sin relación con `master` — no se tocó, se puede borrar).
- **✅ Probado end-to-end en dev (2026-09-26/27)** con el usuario en
  WeChat DevTools + panel dev, cliente de prueba `#36` / pedido `#22`:
  alta con 5 fechas no consecutivas → aprobación en el panel (upsert con
  `delivery_date` OK) → pago simulado (`complete-payment` aplica start /
  expiry reales) → Edit Meals → Change date (movió 2 entregas, expiry
  sincronizado a 22/10) → renovación anticipada con cambio de plan y
  **dos lunes** (quedaron como filas separadas en pendientes, Home muestra
  "Renewal confirmed") → `apply_pending_renewals()` simulado en
  transacción con rollback: aplica plan/expiry nuevos y las 5 fechas
  intactas, vacía pendientes, notifica. El ciclo de `#36` se ajustó a mano
  para poder renovar; el cron de dev aplica la renovación real el 29/9.
- **Siguiente**: el usuario revisa/mergea `dev` y `migration-dev`; después
  prod, cada paso con OK aparte: migración 20260926 → 3 Edge Functions →
  panel → mini-program (restaurar `config.js` en `miniprogram-1`).
- **Mini-program**: `edit-meals`, `home`, `welcome`, `start-date` leen
  `delivery_date` y omiten filas NULL.
- **Panel admin** (`FIT-IGNYTE-dev/src/lib/supabase.js`): lecturas,
  upsert (`onConflict: client_id,delivery_date,slot` — en prod ese upsert
  nunca funcionó porque no existía la constraint) y delete. Build OK.
- Orden en prod cuando se apruebe: migración 20260926 → deploy de las 3
  Edge Functions → panel → mini-program.

### Refinamiento 2026-09-26 (noche) — cómo se va a ejecutar, arrancar por acá mañana

Hallazgo que cambia el mecanismo de las Fases 3/4: **`miniprogram-1-dev` y
`miniprogram-1` (prod) son el MISMO repo git** (remoto
`github.com/BautiLobo/FIT-IGNYTE-MP.git`), ambos en `main`, mismo commit
base `0bf3548`, working tree de `miniprogram-1` (prod) limpio. Esto NO
estaba marcado como "acción de producción" en las reglas del proyecto —
un push/merge ahí toca lo mismo que el del panel admin y merece el mismo
cuidado. `config.js` está en `.gitignore` (no viaja con los commits/merges
— cada checkout mantiene el suyo, dev apunta a `fit-ignyte-dev`, prod a
`ychpcxloiwelyrwcsebf`, sin relación con el git).

`miniprogram-1-dev` tiene **42 archivos sin commitear** encima de esa base
compartida (`git status`/`git diff --stat HEAD`: 2639 inserciones / 830
borrados) — es la acumulación de varias sesiones (calendario de fechas
09-14, fixes 08-2x, renovación anticipada 08-21/23, lo de hoy), nunca
comiteada. Incluye 2 funciones nuevas sin trackear todavía
(`save-meal-selections`, `delete-pending-client`) y `supabase/migrations/`
(la migración de la Fase 1). `supabase/functions/` sí está versionado en
este mismo repo, así que el diff real contra lo que hoy corre en
`ychpcxloiwelyrwcsebf` se puede leer directo de `git diff HEAD` por
función, sin adivinar.

**División de trabajo acordada con el usuario:**
1. Claude escribe el código que todavía falta para las Fases 2 y 3
   (re-apuntar de `day` a `delivery_date` en `apply_pending_renewals()`,
   `complete-payment`, `wx-notify-cron`, panel admin, y en los ~7 archivos
   del mini-program que hoy asumen `day` como fecha real) — nada de esto
   existe todavía, ni en dev.
2. Claude comitea todo (lo ya acumulado + lo nuevo de 2/3) a una **rama
   nueva** en cada repo (`FIT-IGNYTE-MP` y `FIT-IGNYTE`) y la sube —
   **nunca push directo a `main`/`master`**.
3. El usuario revisa y mergea cada rama cuando quiera — esa parte queda
   de su lado.
4. En paralelo, Claude corre la Fase 1 (migración aditiva) directo contra
   `ychpcxloiwelyrwcsebf` — ya escrita, ya ensayada 45/45, aditiva y
   reversible, sin ventana de mantenimiento.
5. Recién después de los merges: deploy de las Edge Functions actualizadas
   a producción + Fase 5 (restaurar `config.js` en la carpeta
   `miniprogram-1`, subir, publicar).

**Nombre de rama**: sin decidir todavía (a elección de Claude si el
usuario no da uno puntual al arrancar) — sugerido:
`feature/delivery-date-migration`.

**Nada de esto se ejecutó todavía** — plan cerrado para retomar la
próxima sesión.
- **✅ RESUELTO (2026-09-16)** — la app funciona en celular real, confirmado por el usuario. No quedó registrado qué lo destrabó exactamente. Contexto histórico de cuando fallaba, por si vuelve a aparecer: `wx-login` + `create-payment` simulado funcionaban de punta a punta en el simulador de WeChat DevTools. Al probar en un celular real vía 预览 (Preview), la pantalla de Plans no mostraba nada — los datos y RLS de `plans` en el proyecto de test están confirmados OK (6 filas, `status='Active'`, policy `select_all_plans` abierta), así que no parece ser un problema de datos. Se agregó `https://cnsthdlgncdjuxatskon.supabase.co` a la whitelist de dominios de WeChat (mp.weixin.qq.com → 开发设置 → 服务器域名, junto con el de producción que ya estaba) pero seguía sin andar en el celular después de eso. Quedó pendiente usar 真机调试 (Remote Debug, no 预览) para ver la consola real del teléfono y encontrar el error exacto — no se llegó a ver ese log todavía.

## 🟠 EN CURSO — sesión 2026-09-16: plan de migración del calendario a producción

**Estado: Fase 1 escrita y probada en dev. NADA aplicado a producción todavía.**

### El problema
Migrar `meal_selections.day` / `pending_meal_selections.day` de texto a fecha
rompe a los **65 clientes activos** que están corriendo la versión vieja del
mini-program. Y publicar la versión nueva requiere revisión de WeChat, que
tarda lo que tarda. Además 发布 no actualiza a todos al instante: los que no
hacen cold start siguen con el código viejo por horas o días. O sea que un
cutover duro a medianoche rompe gente sí o sí.

### La decisión: expand/contract en vez de cambiar el tipo
En vez de cambiarle el tipo a `day`, se agrega una columna nueva
`delivery_date` (date) y las dos conviven, sincronizadas por triggers. Esto
disuelve dos problemas a la vez:
- No hace falta ventana de medianoche: viejo y nuevo conviven indefinidamente.
- **No hace falta apuntar la revisión de WeChat a dev**: como producción ya
  soporta el schema nuevo después de la Fase 1, el código nuevo anda contra
  prod durante la revisión. Se cae la idea del flag de remote config.

Clave que lo habilita: el mini-program es lo único con release lento. Edge
Functions, funciones de Postgres, cron y panel admin se despliegan en segundos.

### Hallazgo que hace que el backfill sea trivial
Las etiquetas `Monday..Friday` **nunca fueron posicionales**: significaban el
día de semana calendario real de la semana del ciclo, corrido a la semana
siguiente si caía antes del `start_date`. Confirmado en el `toMonday()` +
`dayNumMap {mon:1..fri:5}` de `app.js` (versión commiteada, antes del cambio).
Por eso el backfill es matemática de calendario pura, **sin feriados**.

Validado read-only contra producción: para los 65 activos, la fecha mínima
calculada da exactamente el `start_date`, el máximo cae dentro del
`expiry_date`, y cada uno da 5 fechas distintas. **Cero excepciones.**

### Fases
1. **Migración aditiva en prod** (columna + backfill + triggers + constraint
   `UNIQUE(client_id, delivery_date, slot)`). Aditiva, reversible, sin ventana
   de mantenimiento (438 filas). ⬅️ **acá quedamos, falta el OK para aplicarla**
2. Backend a `delivery_date`: `apply_pending_renewals()`, `complete-payment`,
   `wx-notify-cron`, panel admin. Deploy instantáneo.
3. Repuntar el mini-program nuevo de `day` a `delivery_date` (~7 archivos).
4. Revisión de WeChat **apuntando a producción**.
5. Publicar (se puede gradual con 分阶段发布).
6. Semanas después: borrar `day` y los triggers. Como todos renuevan
   semanalmente y la renovación reescribe las filas, la rotación es rápida.

### Lo que ya está hecho
- `supabase/migrations/20260917000000_add_delivery_date.sql` — la migración de
  Fase 1, comentada, lista para correr tal cual en producción.
- Ensayo completo en `fit-ignyte-dev`, esquema aislado `rehearsal_expand`
  (replica la forma vieja de prod; el `public` de dev quedó intacto). Pasaron
  los 10 tests: backfill para los 5 casos de start_date, cliente sin fechas,
  INSERT/UPDATE desde código viejo y nuevo en las dos direcciones, dos lunes
  distintos para el mismo cliente, y duplicado real bloqueado por la
  constraint. **El esquema `rehearsal_expand` sigue existiendo en dev** — sirve
  para probar la Fase 2, borrarlo cuando no haga falta.

### Ojo con esto en la Fase 2
`apply_pending_renewals()` inserta en `meal_selections` listando las columnas
explícitamente, **sin** `delivery_date`, así que el trigger la recalcularía
desde `day`. Para patrones Lun-Vie normales da bien, pero perdería un patrón
tipo "dos lunes" que solo la versión nueva puede generar. Actualizar esa
función y `complete-payment` (que hace la misma copia) **no es opcional**:
tiene que salir antes de que cualquier cliente en versión nueva renueve.

### Pendiente de limpieza
- **Rama `dev` de Supabase rota** (`xyvlhyrrigkfxitqcvdo`, estado
  `MIGRATIONS_FAILED`): se intentó usar la feature de Branching y falló porque
  la primera migración de `fit-ignyte` es un `ALTER TABLE` — el schema base se
  creó a mano, nunca quedó registrado como migración, así que el replay desde
  cero no tiene tablas que alterar. **Cualquier rama sobre este proyecto va a
  fallar igual** hasta que exista una migración baseline. Este plan no la
  necesita. Borrarla: consume cómputo propio.

---

## 🟠 Sesión 2026-09-18 — ensayo de 45 tests de la Fase 1 (nada aplicado a producción)

**Resultado: 45/45 PASS.** Ensayo rehecho de cero en `fit-ignyte-dev`, esquema
`rehearsal_expand`, ahora con `payments` fiel a producción (`client_id`,
`status`, `applied`) — el ensayo anterior tenía esa tabla recortada y por eso
no detectó el bug de abajo.

### 🐛 Bug encontrado en la migración (arreglado antes de tocar prod)
El backfill de `pending_meal_selections` buscaba el ciclo nuevo con
`payments.out_trade_no = p.out_trade_no`. En producción **esa columna está
siempre en NULL** (35/35 filas el 2026-09-18): ningún insert del mini-program
ni de las Edge Functions la setea, la columna quedó muerta. El join nunca
matcheaba y todas las filas caían al fallback `clients.start_date`, que es el
ciclo **actual** — una semana temprano, en el 100% de los casos.

Hoy sería inerte (`apply_pending_renewals()` actualiza `clients.start_date`
antes de copiar, e inserta sin `delivery_date`, así que el trigger la re-deriva
bien). Pero la Fase 2 tiene que hacer que esa copia lleve `delivery_date`
explícito para no perder el patrón "dos lunes" — y ahí la fecha equivocada se
propaga a `meal_selections` de clientes reales.

Arreglado: nueva función `pending_cycle_start()` que resuelve el pago por
`client_id` (cobrado y sin aplicar), **sin** fallback a `clients.start_date`.
Cuando no hay pago pendiente la fecha es desconocida y queda en NULL a
propósito: es el valor seguro (el UNIQUE trata los NULL como distintos y la
fecha se deriva sola al aplicar la renovación).

### Confirmado sobre la Fase 2 (test 35-38)
Con la función **actual** de producción, un `pending` con patrón "dos lunes"
hace fallar la renovación: las dos filas se re-derivan a la misma fecha y
chocan contra la constraint UNIQUE nueva. La falla es transaccional y aislada
(el cliente queda en el ciclo viejo con el pago sin aplicar, y las renovaciones
de los demás clientes siguen andando), pero **es una renovación perdida**.
Confirma que actualizar `apply_pending_renewals()` y `complete-payment` no es
opcional y tiene que salir antes de que cualquier cliente en versión nueva
renueve.

También: **no existe** unique sobre `(client_id, day, slot)`, así que el
`upsert(..., {onConflict:"client_id,day,slot"})` del panel admin tiene que
pasar a `delivery_date` en la Fase 2.

### Reversibilidad (test 44/45)
El rollback es sin pérdida **solo hasta que se publique el mini-program nuevo**.
Después, un patrón "dos lunes" colapsa al dropear `delivery_date` y la
migración ya no se puede re-aplicar (falla el ADD CONSTRAINT por duplicado).
La migración tampoco es re-corrible tal cual; el backfill solo sí es
idempotente por valor.

### Pre-chequeos read-only contra producción (2026-09-18)
`meal_selections`: 464 filas / 93 clientes. `pending_meal_selections`: 35 filas
/ 7 clientes. Cero filas sin `start_date`, cero `day` no reconocidos, y **cero
duplicados** `(client_id, delivery_date, slot)` en las dos tablas — el
`ADD CONSTRAINT` no va a fallar.

### Deadline
`apply_pending_renewals()` aplica 4 pagos pendientes el **2026-09-21**. La
Fase 2 tiene que estar desplegada antes de esa corrida.

### Plan acordado: ventana única con el servicio apagado
El usuario confirmó que 暂停服务 restaura inmediato (intentos limitados) y que
hay canal de publicación sin revisión. Eso colapsa la latencia de revisión,
pero **no** la cola de actualización del paquete en los celulares (confirmado:
no hay `wx.getUpdateManager()` en ninguna versión, así que no hay update
forzado). Por eso se mantiene el expand/contract con triggers: son la red para
el cliente que abre la app con el paquete viejo cacheado después de 恢复服务.

---

## ✅ Ya arreglado y verificado — sesión 2026-09-25/26 (cambiar fecha de una comida + testing end-to-end)

Todo en `fit-ignyte-dev` (mini-program + Edge Functions + `FIT-IGNYTE-dev`
local para aprobar/rechazar órdenes de prueba). **Nada de esto se
desplegó a producción** — depende de las Fases 1-2 de arriba para poder
subirse (`save-meal-selections` asume `day` como fecha real).

### Feature nueva: cambiar la fecha de una comida en Edit Meals
Pedido original: poder mover una entrega a otro día sin perder lo demás.
Terminó en **`pages/change-date`** (pantalla nueva, no reusa
`pages/start-date`): calendario que llega con las N fechas restantes del
ciclo ya marcadas, se deselecciona/reselecciona hasta volver a tener N, y
confirma en bloque — no un swap de a uno (diseño pivotado en vivo con el
usuario). Al volver a `edit-meals`: los días que se mantienen conservan
comida/horario/notas, los sacados se descartan, los nuevos entran en
blanco para elegir comida.

**Ventana ampliada a pedido del usuario**: al principio acotada al
`expiry_date` actual (no extender el plan pagado); el usuario después pidió
poder mover una entrega más allá del vencimiento de hoy, dentro de una
ventana de **14 días hábiles** desde el piso del ciclo (misma ventana que
`start-date` usa al comprar). Como `expiry_date` siempre fue "la fecha de
la última entrega" (no un tope independiente), correrla es legítimo — pero
`update-client` excluye `expiry_date` a propósito de sus campos editables
(comentario explícito: "nunca extender su expiry_date" es precisamente
para que el mini-program, con la anon key pública, no pueda regalarse
ciclo gratis). Se resolvió recalculando y sincronizando `expiry_date`
**del lado del servidor** en `save-meal-selections`, a partir de los `day`
que el mismo servidor ya validó — nunca confiando en lo que mande el
cliente — y volviendo a chequear el límite de 14 días hábiles ahí mismo
(no solo en la pantalla), para que nadie se estire el ciclo mandando un
pedido armado a mano.

### Bug encontrado: `dayConfirmed` no se recalculaba
En un día sin comidas todavía (nuevo, blanco), completar el cupo con el
stepper no mostraba el bloque de horario/notas/guardar hasta cambiar de
tab y volver — `dayConfirmed` se calculaba una sola vez en `loadMenu()`
contra lo que ya estaba guardado, nunca de nuevo mientras se tocaba el
stepper. Preexistente (afectaba cualquier día sin comidas previas, no solo
los de `change-date`), pero pasaba desapercibido porque antes casi todos
los días ya tenían algo cargado. Arreglado recalculándolo en
`persistCurrentDay()`.

### Guardas nuevas al salir de Edit Meals
- Si hay cambios sin guardar (comida/horario/notas, o fechas
  agregadas/sacadas), un menú nativo pregunta Guardar/Descartar antes de
  salir — cubre tanto la flecha del topbar como el gesto nativo de "atrás"
  de WeChat (`onBackPress`, que si no se intercepta se salta el aviso
  igual).
- Si algún día quedó sin comida completa, bloquea la salida directamente
  (ni ofrece guardar/descartar) hasta completarlo.

### Segundo bug real en `changePlan()` (`meal-select.js`)
El fix del 23/9 (`getCurrentPages()` + `navigateBack` cuando no hay
`tiers.js` en la pila) seguía fallando en el caso "pagar tarde": terminaba
en `start-date.js` en vez de `tiers.js`, encontrado por el usuario
probando en vivo. Causa: `wx.navigateBack({delta, success, fail})` no
siempre dispara esos callbacks, sobre todo con `delta` mayor a la
cantidad real de páginas (exactamente ese caso). Arreglado reemplazando
ese branch por `wx.reLaunch` directo a `tiers.js` — no depende de ningún
callback de navegación.

### `payment.js` — aviso de fecha vencida manda a `tiers`, no a `start-date`
A pedido del usuario: si el pago se demoró tanto que la fecha quedó
vieja, antes reabría `start-date.js` directo (mismo plan de siempre, solo
re-elegir fecha). Ahora manda a `tiers.js` primero, para poder reconsiderar
plan/tier — `dateResync` sigue viajando por todo el camino sin que
ninguna pantalla lo toque, así que al final igual salta directo a
`order-summary?from=repay` sin repetir `register.js`.

### Diseño / copy
- **Home**: botón "☰ View full menu PDF" nuevo, reusa `app.openBrochure()`
  (mismo que ya usaba `tiers`).
- **`renewal`**: rediseño completo a pedido del usuario — sin emojis (el
  ⏰ del aviso principal y el 💬 de "Leave us feedback"), flecha de volver
  conectada (el CSS ya existía, sin usar), "status hero" con el número de
  días restantes y color distinto si venció (rojo) vs. si está por vencer
  (ámbar, antes los dos casos se veían igual), acento de color en la
  tarjeta del plan. De paso, dos textos desactualizados corregidos: "DUE
  FRIDAY" (asumía que siempre vence un viernes) → "PLAN ENDING SOON", y
  "meals/day · Mon-Fri" (ya no hay patrón fijo) → "meals/day".

### Testing end-to-end (WeChat DevTools + panel admin `FIT-IGNYTE-dev`)
Recorrido completo en 3 niveles, con clientes de prueba reales creados y
descartados en `fit-ignyte-dev`:
- **Nivel 1**: alta nueva completa, renovación anticipada, renovación
  después de vencido, rechazo de orden + "Start Over", edit-profile
  (nombre directo, dirección pendiente de aprobación).
- **Nivel 2**: reingreso con orden `draft` sin terminar, colisión de
  mismo openid contra un cliente `Pending Payment` (con y sin plan
  elegido), "repay" con fecha vencida + cambio de plan en el camino.
- **Nivel 3**: código de referido (inválido/válido, 10% recalculado
  server-side, `referral_used` solo se marca tras pago real, no al
  aplicar el código), cutlery, corte de las 23hs Shanghai — este último
  verificado con un script aparte que simula "ahora" (sin tocar el reloj
  del sistema ni el código real), confirmando que cliente y servidor
  coinciden en el mismo corte.

### Pendiente, mencionado pero deliberadamente no tocado
- `change-date` no soporta el hueco de renovación anticipada
  (`deferToPending` — el botón se oculta ahí, `cycleStart`/`cycleEnd` no
  están calculados en ese branch de `edit-meals`) ni clientes con más de
  una entrega el mismo día (slot > 1, cargados a mano desde el panel) —
  el botón avisa y no deja entrar en ese segundo caso.
- Pestaña **Referrals** del panel admin cuenta contra `new_orders.referral_code`,
  que no se completa en el camino "repay sin orden asociada" (`pendingOrderId`
  ausente) — subcuenta ese caso puntual. La pestaña **Accounting** sí cuenta
  bien (filtra `payments` por `paid_at`). No se tocó.
- Botón/handler de logout en `edit-profile.js` — el JS existe
  (`logout()`), pero no hay ningún botón en el `.wxml` que lo dispare;
  confirmado con el usuario que así debe quedar (no se agregó ninguno).

---

## ✅ Ya arreglado y verificado — sesión 2026-09-23 (renovación anticipada, pago tardío, huso horario)

Sesión larga disparada por el usuario probando a fondo en WeChat DevTools
**renovación anticipada** y **cliente aprobado que paga tarde** (nunca pagó,
la fecha que había elegido ya venció). Todo en `fit-ignyte-dev` — **nada de
esto se desplegó a producción**. El panel admin tocado es
`FIT-IGNYTE-dev` (local, sin git).

### Bugs de "Start Over" / cliente aprobado sin orden asociada
- **"Start Over" no borraba al cliente**, solo el pedido (`new_orders`) — un
  cliente ya aprobado por el admin (fila en `clients`, `status='Pending
  Payment'`, creada por `approveOrder` ANTES de pagar) quedaba huérfano, y
  la próxima vez que se registraba caía en loop infinito de "ya tenés
  cuenta". Nueva Edge Function `delete-pending-client` (borra el cliente
  solo si sigue en `Pending Payment`, nunca si ya pagó) + `app.js`
  (`deleteClient`) + `rejected.js`/`payment.js` (`startOver()` ahora
  resuelve el clientId — por storage o buscando la orden por teléfono si
  hace falta — y lo borra antes de limpiar el storage local).
  `address_changes`, `meal_selections`, `notifications` y
  `pending_meal_selections` tienen `ON DELETE CASCADE` hacia `clients` y se
  limpian solas; `payments.client_id` NO tiene FK, así que la función
  también borra los pagos huérfanos de ese cliente aparte.
- **`payment.js`/`order-summary.js` en blanco** para un cliente ya aprobado
  que llega a pagar SIN `pendingOrderId` en el storage del dispositivo (se
  re-registra por `openid` desde otro dispositivo/reinstalación, o
  `discovery.js` lo detecta directo) — las dos pantallas asumían que
  siempre había una orden de la que leer. Agregado un camino "solo cliente"
  en ambas (`loadRepayFromClient` en order-summary.js), que arma todo desde
  `clients` + lo que haya en storage.
- **`order-summary.js` — `editAddress()`** mandaba a `register.js`, que sin
  `pendingOrderId` entraba con el formulario vacío y, al guardar, volvía a
  caer en el loop de "ya tenés cuenta". Ahora, sin `pendingOrderId`, va a
  `edit-profile.js` (el camino correcto para que un cliente existente edite
  sus datos, por `clientId` + `updateClient`).
- **Bug crítico, con riesgo real de plata**: **`complete-payment` exigía
  `pendingOrderId` para pagos `type='new'`**, pero un cliente ya aprobado
  que paga por primera vez sin una orden asociada (exactamente el camino de
  arriba) no tiene ninguna. El pago se cobraba de verdad (o se simulaba)
  pero `complete-payment` cortaba con error 500 antes de tocar `clients` —
  quedaba `status='paid'`, `applied=false` **para siempre**, sin plan
  activado, sin que nada lo reintentara. Arreglado: el `PATCH` a
  `new_orders` ahora es condicional a que `pendingOrderId` exista; si no,
  se sigue de largo y se aplica igual el resto (`clients` +
  `meal_selections`). Confirmado con el pago real atascado de la prueba
  (se reaplicó a mano) y después de punta a punta por la UI, dos veces más,
  sin intervención. De paso, `dev-simulate-payment` dejó de devolver
  `ok:true` aunque `complete-payment` fallara adentro (antes escondía
  errores como este).
- **`payment.js` — loop infinito de "actualizá tu fecha"**: al volver de
  re-elegir fecha/comidas (`start-date.js`/`meal-select.js`, flujo
  `dateResync`), el chequeo de fecha vencida seguía priorizando
  `client.start_date`/`order.start_date` (siempre vieja, por algo se
  volvió a elegir) por sobre lo recién guardado en storage — mandaba de
  nuevo a elegir fecha en loop. Arreglado con una señal de un solo uso
  (`freshResyncDate`, seteada por `order-summary.js` justo antes de volver
  a `payment.js`) que hace confiar en el storage SOLO cuando se acaba de
  escribir de verdad.

### Bug de huso horario (device/servidor vs Shanghai) — mismo patrón que ya se había arreglado para el corte de pago, pero faltaba acá
- **`app.getRealStatus()` (mini-program) y la copia de `getRealStatus()` en
  `create-payment`** calculaban "hoy" con `new Date()` — hora del
  dispositivo o del servidor (UTC), no de Shanghai. Cualquier cliente con
  el teléfono en otro huso (o probando desde fuera de China) podía ver
  Active/Upcoming/Inactive equivocado hasta un día, y el `client_status`
  que graba `create-payment` en `payments` podía quedar mal durante la
  ventana de 8hs en que la fecha de Shanghai ya cambió pero la de UTC no.
  Arreglado reusando `shanghaiNow()`/`toDateString()` (ya existían en
  `utils/business-days.js`, agregadas ahí mismo hoy para el corte de pago)
  en las dos copias. **El panel admin ya estaba bien** (`chinaTodayIso()`
  con `Intl.DateTimeFormat({timeZone:'Asia/Shanghai'})`, arreglado en una
  sesión anterior) — no hizo falta tocarlo.
- **Corte de pago movido de las 22 a las 23 horas de Shanghai** (pedido
  explícito del usuario) — `utils/business-days.js` y `create-payment`.

### Plan/tier equivocado durante el "hueco" de renovación anticipada
Un cliente con una renovación paga pero todavía sin aplicar sigue teniendo
`clients.plan_id` apuntando al plan VIEJO hasta que el cron corre — varios
lugares mostraban ese plan viejo en vez del nuevo:
- **`edit-meals.js`**: usaba `client.plan_id` para el tier/cantidad de
  comidas incluso editando el ciclo pendiente — si el cliente cambiaba de
  tier al renovar, el filtro de "comida ya no está en el menú" comparaba
  contra el tier equivocado y **vaciaba todas las selecciones nuevas**.
- **`home.js`**: el nombre de plan mostrado (`client.plan_name`) también
  venía de `client.plan_id`, mostrando el plan viejo mientras las comidas
  de abajo (correctamente, desde `pending_meal_selections`) eran del nuevo
  — inconsistente.
- **`get-client`** ahora expone `plan_id` dentro de `pending_renewal`
  (antes solo `start_date`/`out_trade_no`) para que estos dos puedan
  resolver el plan correcto.
- **Panel admin (`FIT-IGNYTE-dev`)**: mismo patrón — la insignia "Plan"
  (`PlanBadge`, vía `c.planName`) en Dashboard, tabla de Clientes, tarjetas
  de Meal Selections, hoja de reparto/delivery y alertas de alergias
  mostraba el plan viejo durante el hueco, sin coincidir con las comidas
  reales de la hoja de reparto (esa sí ya estaba bien, ver
  `mealSlotsForDate`). Arreglado: `getPaidPayments()` ahora trae también
  `plan_id`; nuevo `pendingRenewalPlanByClient` (mismo criterio que
  `pendingRenewalStartByClient`, ya existía) + helper `clientPlanName(c)`,
  usado en las 6 apariciones de `PlanBadge`. `npm run build` y `npm run
  lint` OK — **sin confirmar todavía en el navegador** (`localhost:5173`).

### Edit Meals dejaba editar el día de hoy (bug de negocio, encontrado por el usuario)
`edit-meals.js`/`save-meal-selections` no tenían NINGÚN chequeo de fecha —
un cliente podía reescribir la comida de HOY (o de un día ya pasado),
aunque la cocina ya la tuviera confirmada. Mismo criterio que el corte de
pago (nunca hoy, mañana si ya pasó el corte de las 23h Shanghai), aplicado
acá por primera vez:
- **`save-meal-selections`** (servidor): calcula el mismo mínimo editable y
  rechaza con `409 locked_day` cualquier día anterior — solo para
  `meal_selections` (el ciclo vigente); `pending_meal_selections` no tiene
  este límite, ninguna de esas fechas está en manos de la cocina todavía.
- **`edit-meals.js`** (cliente): ya ni muestra esos días como pestañas
  editables.
- Las pestañas (`.day-tab`, `flex:1`) se estiraban feo con menos de 5 días
  visibles (texto de tamaño fijo, pensado para siempre-5) — tamaño de
  fuente ahora se calcula en JS según la cantidad real de pestañas.
  Confirmado con 3 y con 4 pestañas.

### `changePlan()` en `meal-select.js` — asunción de navegación rota
Asumía que siempre se llega por `plans → start-date → meal-select`
(`navigateBack({delta:2})` fijo) y solo dejaba cambiar cantidad de comidas
dentro del mismo tier. Se rompía en cualquier camino con otra profundidad
de pila (pagar tarde, renovación) — terminaba en `start-date.js` en vez de
`plans.js`. Reescrito con `getCurrentPages()`: si ya hay una `tiers.js` más
abajo en la pila real, vuelve a ESA instancia (sin duplicar pantallas, así
"atrás" sigue yendo a `renewal.js` como corresponde); si no hay ninguna
(pagar tarde), recién ahí entra a una `tiers.js` nueva. De paso se extendió
para ir primero a `tiers.js` (no directo a `plans.js`), a pedido del
usuario: ahora "Change plan" también permite cambiar de tier, no solo de
cantidad de comidas dentro del mismo.

### Verificado end-to-end por el usuario (WeChat DevTools, cliente de prueba real, dos rondas completas)
- Renovación anticipada: básica (cambio de plan con ciclo viejo activo),
  doble renovación bloqueada, aplicación del cron, referido ignorado en
  renovación, el "hueco" (ciclo viejo vencido, renovación sin aplicar
  mostrando plan/fecha/comidas del nuevo en Home).
- Pagar tarde (cliente aprobado, nunca pagó, fecha vencida): cartel de
  fecha vencida → elegir fecha/comidas de nuevo (incluyendo "Change plan" →
  tiers) → pago aplicándose solo, sin intervención manual, dos veces
  seguidas.
- "Start Over" en el camino de pago tardío: borra al cliente
  correctamente.
- Edit Meals: día de hoy/pasado bloqueado, probado con 3 y 4 pestañas
  editables.

### Pendiente, mencionado pero deliberadamente no tocado
- `order-summary.js` — `editMeals()` (el botón de comidas, no el de
  dirección) tiene el mismo problema de asunción de pila que tenía
  `changePlan()`, para el camino `?from=order-summary`. No se tocó.
- Cliente de prueba viejo `id=5` ("Test Order (DEV)") en `fit-ignyte-dev` —
  sigue en la base, no se decidió si borrarlo.
- Copia duplicada de `apply_pending_renewals()` en el schema
  `rehearsal_expand` (dev, del ensayo de la Fase 1 del calendario, sesión
  2026-09-18) — sin determinar si sigue haciendo falta.

---

## ✅ Ya arreglado y verificado — sesión 2026-09-14 (calendario de días de entrega + incidente dev/prod)

### Feature: calendario propio de días de entrega
Reemplaza el modelo viejo "5 días hábiles consecutivos desde `start_date`" por un calendario donde el cliente elige explícitamente 5 fechas reales (no necesariamente consecutivas) dentro de una ventana de 14 días hábiles, con feriados/fines de semana bloqueados. Al renovar con "keep same meals", se repite el mismo patrón relativo de días (no resetea a 5 seguidos). Implementado de punta a punta:
- **Schema** (proyecto de test únicamente): `meal_selections.day`/`pending_meal_selections.day` de `text` a `date`.
- **Mini-program**: `pages/start-date` reescrito como calendario (grilla mensual estilo referencia de Nutrition Kitchen SG); `edit-meals`, `meal-select`, `order-summary`, `home`, `welcome`, `payment`, `approved` migrados de las 5 etiquetas fijas Lun-Vie a fechas reales (`"19/9 Mon"`). Nuevos helpers en `utils/business-days.js` (`getValidDeliveryWindow`, `deriveRenewalDates`) y `utils/date-format.js` (`formatShortDate`, `formatDateParts`).
- **Panel admin** (`FIT-IGNYTE-dev`, copia local sin git, `.env` a proyecto de test): `clientActiveOnDay` (reconstruía "ocurrencia más cercana de este día de semana") reemplazado por lookups directos por fecha real — simplificación real, no solo puerto. Kitchen Prep / Delivery Sheet / Shopping List / Meal Selections / Accounting pasan de tabs fijos Lun-Vie a tabs por fecha. De paso arreglado un bug latente: imprimir la hoja de cocina/reparto de "otro día" mostraba la fecha de HOY en vez de la del día elegido.

### 🐛 Bug crítico encontrado (preexistente, no de esta sesión): Edge Functions con URL de producción hardcodeada
`app.js` tenía las URLs de **todas** las llamadas a Edge Functions (`create-order`, `create-payment`, `get-client`, `update-client`, `wx-login`, etc. — 15 en total) escritas a mano apuntando a `ychpcxloiwelyrwcsebf` (prod), sin pasar por `config.SUPABASE_URL`. Solo las consultas directas a tablas vía `app.supabase()` (menu, meal_selections, plans) respetaban `config.js`. Esto significa que **cualquier prueba anterior en modo dev que involucrara registrar un cliente, pagar, o consultar/actualizar un cliente terminaba escribiendo en producción igual, en silencio** — no es algo que empezó hoy. Se encontró porque un pedido de prueba (`new_orders` id 278, "bkjghi") apareció en prod en vez de en la base de test; el usuario lo borró de prod.

**Arreglado**: las 15 URLs ahora usan `` `${config.SUPABASE_URL}/functions/v1/...` ``. Verificado en vivo: un pedido de prueba posterior sí llegó a la base de test.

**Recomendación pendiente para el usuario**: revisar si quedaron más filas de prueba sueltas en producción de sesiones de testing anteriores a hoy (no solo la que ya se encontró) — este bug estuvo ahí desde antes.

### Otros hallazgos de esta sesión
- No existía ninguna constraint `UNIQUE(client_id, day, slot)` real en `meal_selections`/`pending_meal_selections` — la "unicidad" la garantizaba solo el código a mano (GET antes de PATCH-o-POST). El panel admin ya asumía que existía (`upsert(..., {onConflict:"client_id,day,slot"})`). Agregada en el proyecto de test; falta agregarla también en producción cuando se migre el schema ahí.
- `pages/approved/index.js` leía `meals['mon']` a mano para mostrar la primera entrega — con fechas reales como key nunca iba a matchear. Arreglado (toma la fecha más temprana con `Object.keys(...).sort()[0]`).
- **`create-payment` nunca respetaba `ALLOW_PAYMENT_SIMULATION`**: siempre armaba y firmaba una orden real de WeChat Pay (necesitaba `WX_MCH_ID`/`WX_API_V3_KEY`/`WX_CERT_SERIAL_NO`/`WX_PRIVATE_KEY` sí o sí), y recién `dev-simulate-payment` (función separada, llamada después) evitaba el cobro real. Arreglado: ahora `create-payment` chequea `ALLOW_PAYMENT_SIMULATION` y devuelve directo (sin tocar WeChat Pay) si está en `'true'` — el mini-program en modo simulado nunca leía esos campos firmados igual, así que no rompe nada. Desplegado a `fit-ignyte-dev` (versión 12). **No desplegado a producción** — ahí `ALLOW_PAYMENT_SIMULATION` no debería estar seteado nunca, así que el cambio no afecta el comportamiento real, pero la actualización de código todavía no se subió a prod.
- Secrets de WeChat cargados en el proyecto de test (`WECHAT_APPID`, `WECHAT_APPSECRET`, `ADMIN_OPENIDS`, `ADMIN_AUTH_EMAIL`/`PASSWORD`, `ALLOW_PAYMENT_SIMULATION=true`) — el primer intento de `WECHAT_APPSECRET` estaba mal copiado (WeChat devolvía `errcode 40125 invalid appsecret`, visible en los logs del Edge Function vía `query_logs`), se corrigió.
- **Flujo de pago probado de punta a punta en dev y confirmado en la base**: alta nueva → elegir plan → calendario (5 días no todos consecutivos, saltea el finde) → elegir comidas → pagar (simulado) → `payments.status='paid'`, `applied=true` → `meal_selections` con las 5 fechas reales y sus comidas. Todo en el proyecto de test, cliente `id 6`.

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
- `pages/start-date`: después de las 22:00, la fecha mínima de inicio salta un día extra (no se puede más elegir "mañana" tarde en la noche).
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
