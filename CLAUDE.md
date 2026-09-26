# FIT IGNYTE — reglas de trabajo

## 🔴 Nada va a producción sin orden explícita del usuario

Regla dura, sin excepciones y sin interpretación. Ninguna acción que llegue a
producción se ejecuta por iniciativa propia, por más chica, reversible u
"obvia" que parezca, y por más que sea el paso siguiente evidente de algo que
el usuario ya aprobó en dev.

Cuenta como producción:

- Migraciones, DDL o cualquier `INSERT/UPDATE/DELETE` en el Supabase de
  producción `ychpcxloiwelyrwcsebf`.
- Deploy de Edge Functions al proyecto de producción.
- `git push`, merge o commit en el repo del panel admin con remoto
  (`FIT-IGNYTE`, `github.com/BautiLobo/FIT-IGNYTE`).
- Subir, previsualizar o publicar el mini-program en WeChat (上传 / 预览 /
  发布), o restaurar `config.js` apuntando a producción.
- Cambiar secrets, settings de Auth, dominios o cron del proyecto de producción.

**Aprobar algo en dev NO aprueba su versión de producción.** "Hacelo",
"dale", "subilo" sin decir el entorno significa dev; si hay duda, preguntar
cuál antes de tocar nada.

Lo único que se puede hacer contra producción sin pedir permiso son
**consultas de solo lectura** para juntar datos (`SELECT`, leer logs, leer
advisors). Eso no necesita aviso previo.

Cuando el usuario sí pide algo de producción: primero explicar qué toca, si es
reversible y cómo, si necesita ventana de mantenimiento y qué se rompe si sale
mal. Después esperar el OK. Recién después, actuar.

Contexto de por qué: hay ~65 clientes activos pagando y plata real moviéndose
por WeChat Pay. Un error en producción son entregas y pagos reales.

## Entornos

| | Producción | Dev / test |
|---|---|---|
| Supabase | `ychpcxloiwelyrwcsebf` | `fit-ignyte-dev` (`cnsthdlgncdjuxatskon`) |
| Mini-program | — | `C:\Users\USER\WeChatProjects\miniprogram-1-dev` (este repo, **el activo**) |
| Panel admin | `C:\Users\USER\Desktop\FIT-IGNYTE` (con remoto) | `C:\Users\USER\Desktop\FIT-IGNYTE-dev` (solo local) |

`C:\Users\USER\WeChatProjects\miniprogram-1` (sin `-dev`) es una copia vieja
que apunta a producción — no trabajar ahí, ya causó un incidente real.

No confiar solo en `config.js` para saber a qué entorno apunta algo: hubo
Edge Functions con la URL de producción hardcodeada. Grepear la URL antes de
dar por sentado el aislamiento.

Ver `HANDOFF.md` para el estado y los pendientes del proyecto.
