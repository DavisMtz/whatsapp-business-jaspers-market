# CLAUDE.md — Agente Logidma

Guía para continuar el proyecto sin el historial de conversaciones previas. Escribe en **español** al usuario (David Martínez, dueño de Logidma). Nunca guardes secretos en el repositorio.

## Qué es

Bandeja de WhatsApp Business de **Logidma**, para una sola persona, en **Cloudflare Workers**: https://wa.logidma.com

- `src/worker/` — API y webhook (Hono + TypeScript). Punto de entrada: `index.ts`.
  - `auth.ts`: login, sesiones y cambio de contraseña. `crypto.ts`: PBKDF2, HMAC, tokens.
  - `webhook.ts`: verifica la firma `X-Hub-Signature-256` con `APP_SECRET` y guarda mensajes y estados.
  - `store.ts`: acceso a D1 (contactos, conversaciones, mensajes).
  - `graph.ts`: llamadas a la Graph API (enviar, subir y descargar multimedia).
  - `media.ts`: archivos en R2 (`/api/media/:id` con sesión y `Range`; `/api/media/send`).
  - `realtime.ts`: Durable Object `RealtimeHub` (WebSocket con hibernación en `/api/ws`). Solo manda ids; el navegador vuelve a pedir los datos.
  - `contacts.ts`: notas y etiquetas.
  - `templates.ts`: plantillas (listar/crear/editar/borrar en Meta, copia en D1, cambios por webhook, tarifas).
  - `ai.ts`: asistente de IA (config en `settings.ai_config`, respuesta automática desde el webhook, sugerencia, resumen, traspaso a humano, uso en `ai_runs`). Proveedores: Workers AI (binding `AI`) o Claude API (`@anthropic-ai/sdk`, secreto opcional `ANTHROPIC_API_KEY`).
- `web/` — frontend React + Vite (se compila a `dist/`). Páginas en `web/src/pages/`.
- `web/public/` — páginas legales públicas: `/privacidad`, `/terminos`, `/eliminacion-datos`. Meta las exige, ya están registradas en la app y no hay que moverlas.
- `migrations/` — esquema de D1. Nunca edites una migración aplicada: crea `0002_...sql`.

## Infraestructura (IDs, no secretos)

| Recurso | Valor |
|---|---|
| Cuenta de Cloudflare | `1ef6a06b0e674b43f95c90a63863bc69` |
| Worker | `agente-logidma` (solo `wa.logidma.com`; workers.dev y preview URLs apagados) |
| D1 | `agente-logidma` (`8e3a8d25-afc0-4a0c-b60d-625c8ac5022f`), binding `DB` |
| R2 | `agente-logidma-media`, binding `MEDIA` (privado; créalo con `wrangler r2 bucket create` si no existe) |
| Durable Object | `RealtimeHub`, binding `HUB` (migración `v3`) |
| Workers AI | binding `AI` (`remote: true`: en `wrangler dev` también llama a Cloudflare y consume neuronas) |
| Zona DNS | `logidma.com` en la misma cuenta (tiene otros subdominios de otros proyectos: no tocarlos) |
| Negocio Meta | Logidma `1966123967356413` |
| App Meta | Agente Logidma `4790523007843058` (publicada, en modo live) |
| Cuenta de WhatsApp | `4659287351061167` (suscrita a la app) |
| `WABA_ID` / `APP_ID` | Vars en `wrangler.jsonc` (plantillas y subida del ejemplo de encabezado) |
| Número | +52 1 443 848 0153 — Phone Number ID `1253350567872957` |
| Webhook | `https://wa.logidma.com/webhook` (11 campos suscritos, incluye `messages` y `message_statuses`) |
| Usuario del sistema | "David Martinez", rol Employee, con control total de la app y de la cuenta de WhatsApp |

Secretos del Worker (ya cargados en Cloudflare): `ACCESS_TOKEN`, `APP_SECRET`, `VERIFY_TOKEN`, `ADMIN_EMAIL`, `DASHBOARD_PASSWORD`. Opcional (Fase 4): `ANTHROPIC_API_KEY`, solo si se elige Claude como proveedor. `DASHBOARD_PASSWORD` solo sirvió para crear el usuario; la contraseña real vive hasheada en D1 y se cambia desde Configuración.

El conector MCP **WhatsApp Business** (Meta) sirve para consultar el estado (`whatsapp_biz_onboarding_status`), las plantillas y los números. Sus acciones de escritura piden confirmación explícita del usuario.

## Comandos

```bash
npm install
npm run typecheck                 # worker + web
npm run build                     # frontend → dist/
npm run deploy                    # build + migraciones D1 remotas + wrangler deploy
npx wrangler d1 migrations apply agente-logidma --local   # D1 local para `npm run dev:worker`
```

Para desplegar desde una sesión hacen falta `CLOUDFLARE_API_TOKEN` y `CLOUDFLARE_ACCOUNT_ID` en el entorno. Pídelos al usuario y sugiere guardarlos como secretos del entorno, no en el chat. Antes de desplegar, prueba en local con `wrangler dev`, usando un `.dev.vars` basado en `.dev.vars.example`.

## Convenciones

- Fechas en D1: milisegundos (epoch). Estados de salida: `accepted → sent → delivered → read` (o `failed`), sin retroceder.
- Todo `/api/*` requiere sesión, salvo `/api/auth/login`. Las peticiones que cambian datos deben traer un `Origin` del propio sitio (CSRF).
- Textos de la interfaz en español de México. Diseño adaptable: el usuario trabaja mucho desde iPad.
- Un PR por fase o cambio. Commits en español.

## Plan (roadmap)

- [x] **Fase 1** — Login con correo (solo `ADMIN_EMAIL`), D1, bandeja de chats, envío de texto y plantillas, ventana de 24 h, archivar y renombrar, configuración.
- [x] **Fase 2** (desplegada el 2026-09-27) — Multimedia en R2 (recibir y enviar imágenes, video, audio, notas de voz y documentos), tiempo real con Durable Object + WebSocket (el polling queda de respaldo: 60 s conectado, 5 s/4 s sin conexión), notas y etiquetas por contacto.
- [x] **Fase 3** (desplegada el 2026-09-27) — Plantillas: listar, crear, editar y borrar vía Graph API (`/{waba-id}/message_templates`), con estado de aprobación en vivo (webhook `message_template_status_update`), vista previa, variables al enviar y costo estimado por categoría. Webhook: `message_template_status_update`, `template_category_update`, `message_template_quality_update` (confirmar que estén suscritos). Tarifas editables en Plantillas → Tarifas.
- [x] **Fase 4** (desplegada el 2026-09-27) — IA en Configuración → Asistente de IA: proveedor **Workers AI** (Llama 3.3 70B por defecto, sin llave) o **Claude API** (Opus 5 por defecto; Sonnet 5 y Haiku 4.5 a elegir), respuesta automática global o por chat (auto/activa/apagada), nombre del negocio, instrucciones y base de conocimiento, horario (siempre / en horario / fuera de horario), límite de respuestas por chat en 24 h, pausa tras respuesta manual, traspaso a humano (palabras clave, la IA responde `[[HUMANO]]` o se llega al límite), respuesta sugerida (✨ en el chat), resumen del chat, probador sin enviar y uso de 30 días. Solo contesta dentro de la ventana de 24 h, a mensajes de menos de 10 min, con 4 s de espera para juntar mensajes seguidos. El prompt limita al asistente a temas del negocio (política de Meta). Pendiente a futuro: transcribir notas de voz.
- [ ] **Fase 5** — Métricas (volumen, tiempo de respuesta, gasto estimado), respuestas rápidas con `/` y notificaciones del navegador.

## Costos (contexto para el usuario)

- Cloudflare: plan gratis suficiente. Workers Paid (US$5/mes) solo si se excede.
- Meta cobra por mensaje de plantilla. **Desde el 1 de octubre de 2026 también cobra las respuestas de servicio**, a la tarifa de utilidad, con 1,000 gratis al mes por número según 360dialog. La cuenta ya tiene método de pago.

## Pendientes de seguridad

Algunas credenciales se compartieron en un chat anterior. Hay que rotarlas y cargar los valores nuevos **directo en Cloudflare**:

1. Token de API de Cloudflare: *roll* o borrarlo.
2. Llaves de R2 y secreto de Cloudinary: regenerarlos, aunque este proyecto no los usa todavía.
3. Meta: restablecer el App Secret → actualizar `APP_SECRET` en el Worker. Revocar el token del usuario del sistema y generar uno nuevo → actualizar `ACCESS_TOKEN`.
4. Conectar el repo a Workers Builds:
   - Build: `npm run build`
   - Deploy: `npx wrangler d1 migrations apply agente-logidma --remote && npx wrangler deploy`
