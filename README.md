# Agente Logidma

Servidor de WhatsApp Business para **Logidma**, corriendo en **Cloudflare Workers**.

- Recibe los mensajes de WhatsApp en `/webhook` (validando la firma de Meta).
- Guarda los últimos 200 mensajes en un Durable Object (SQLite).
- Incluye un panel web protegido con contraseña para ver el historial y enviar textos o plantillas.

Basado en el ejemplo [Jasper's Market](https://github.com/fbsamples/whatsapp-business-jaspers-market) de Meta.

## Datos de Meta

| Dato | Valor |
|---|---|
| App de desarrollador | Agente Logidma (`4790523007843058`) |
| Negocio | Logidma (`1966123967356413`) |
| Número | +52 1 443 848 0153 — Phone Number ID `1253350567872957` |
| Dominio | https://wa.logidma.com (webhook en `/webhook`) |

## Configuración

Valores públicos (en `wrangler.jsonc`, sección `vars`):

| Variable | Descripción |
|---|---|
| `PHONE_NUMBER_ID` | Número desde el que se envían mensajes |
| `GRAPH_API_VERSION` | Versión de la Graph API de Meta |

Secretos (se cargan en Cloudflare, **nunca** en el repositorio):

| Secreto | De dónde sale |
|---|---|
| `ACCESS_TOKEN` | Token permanente de un usuario del sistema (Business Settings → Usuarios del sistema) con `business_management`, `whatsapp_business_messaging` y `whatsapp_business_management` |
| `APP_SECRET` | developers.facebook.com → Agente Logidma → Configuración de la app → Básica → Clave secreta |
| `VERIFY_TOKEN` | Una frase que tú eliges; debe coincidir con la configurada en el webhook de Meta |
| `DASHBOARD_PASSWORD` | Contraseña para entrar al panel (el usuario puede ser cualquiera) |

## Despliegue

### Opción A: desde el panel de Cloudflare (sin terminal)

1. Cloudflare → **Workers & Pages** → **Create** → **Import a repository** → elige este repositorio.
2. Deploy command: `npx wrangler deploy`. Rama de producción: `main`.
3. Una vez creado, en el Worker **agente-logidma** → **Settings** → **Variables and Secrets**, agrega los 4 secretos como tipo **Secret**.
4. El Worker responde en `https://wa.logidma.com` (definido en `routes` de `wrangler.jsonc`; Cloudflare crea el DNS y el certificado) y también en `https://agente-logidma.logidma.workers.dev`.

Cada push a `main` vuelve a desplegar automáticamente.

### Opción B: desde la terminal

```bash
npm install
npx wrangler login
npx wrangler secret put ACCESS_TOKEN
npx wrangler secret put APP_SECRET
npx wrangler secret put VERIFY_TOKEN
npx wrangler secret put DASHBOARD_PASSWORD
npm run deploy
```

### Conectar con Meta

Con el dominio del Worker:

1. Webhook de Agente Logidma → Callback URL `https://wa.logidma.com/webhook`, Verify token = `VERIFY_TOKEN`, campo `messages` suscrito.
2. Suscribir la cuenta de WhatsApp de Logidma a la app.
3. Publicar la app y agregar un método de pago en Meta.

## Desarrollo local

```bash
cp .dev.vars.example .dev.vars   # y llena los valores
npm run dev                      # http://localhost:8787
```

## Licencia

Apache 2.0, ver [LICENSE](LICENSE).
