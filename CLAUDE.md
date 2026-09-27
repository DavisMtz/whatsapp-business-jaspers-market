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
| Zona DNS | `logidma.com` en la misma cuenta (tiene otros subdominios de otros proyectos: no tocarlos) |
| Negocio Meta | Logidma `1966123967356413` |
| App Meta | Agente Logidma `4790523007843058` (publicada, en modo live) |
| Cuenta de WhatsApp | `4659287351061167` (suscrita a la app) |
| Número | +52 1 443 848 0153 — Phone Number ID `1253350567872957` |
| Webhook | `https://wa.logidma.com/webhook` (11 campos suscritos, incluye `messages` y `message_statuses`) |
| Usuario del sistema | "David Martinez", rol Employee, con control total de la app y de la cuenta de WhatsApp |

Secretos del Worker (ya cargados en Cloudflare): `ACCESS_TOKEN`, `APP_SECRET`, `VERIFY_TOKEN`, `ADMIN_EMAIL`, `DASHBOARD_PASSWORD`. `DASHBOARD_PASSWORD` solo sirvió para crear el usuario; la contraseña real vive hasheada en D1 y se cambia desde Configuración.

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
- [ ] **Fase 3** — Plantillas: listar, crear, editar y borrar vía Graph API (`/{waba-id}/message_templates`), con estado de aprobación en vivo (webhook `message_template_status_update`), vista previa, variables al enviar y costo estimado por categoría.
- [ ] **Fase 4** — IA configurable en Configuración → IA: respuesta automática global o por chat, instrucciones y base de conocimiento, horario, límite por chat, traspaso a humano, respuesta sugerida y resumen. El proveedor se elige entre **Workers AI** y **Claude API**. Debe ser un asistente específico del negocio (Meta prohíbe chatbots de IA de propósito general). Solo responde dentro de la ventana de 24 h.
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
