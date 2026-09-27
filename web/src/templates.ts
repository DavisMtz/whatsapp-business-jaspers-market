// Plantillas de WhatsApp: tipos, variables y armado de componentes para Meta.

export type Button = {
  type: "QUICK_REPLY" | "URL" | "PHONE_NUMBER" | "COPY_CODE" | "OTP" | string;
  text: string;
  url?: string;
  phone_number?: string;
  example?: string[] | string;
};

export type Component =
  | { type: "HEADER"; format: "TEXT" | "IMAGE" | "VIDEO" | "DOCUMENT" | "LOCATION"; text?: string; example?: any }
  | { type: "BODY"; text: string; example?: any }
  | { type: "FOOTER"; text: string }
  | { type: "BUTTONS"; buttons: Button[] };

export type Template = {
  id: string;
  name: string;
  language: string;
  category: "MARKETING" | "UTILITY" | "AUTHENTICATION";
  status: string;
  parameter_format: "POSITIONAL" | "NAMED";
  components: Component[];
  rejected_reason: string | null;
  quality: string | null;
  updated_at: number;
};

export type Rates = { currency: string; MARKETING: number; UTILITY: number; AUTHENTICATION: number };

export const CATEGORY_LABEL: Record<string, string> = {
  MARKETING: "Marketing",
  UTILITY: "Utilidad",
  AUTHENTICATION: "Autenticación"
};

export const STATUS: Record<string, { label: string; tone: "ok" | "wait" | "bad" | "off" }> = {
  APPROVED: { label: "Aprobada", tone: "ok" },
  PENDING: { label: "En revisión", tone: "wait" },
  IN_APPEAL: { label: "En apelación", tone: "wait" },
  REINSTATED: { label: "Restablecida", tone: "ok" },
  REJECTED: { label: "Rechazada", tone: "bad" },
  FLAGGED: { label: "Con alertas", tone: "wait" },
  PAUSED: { label: "Pausada", tone: "bad" },
  DISABLED: { label: "Desactivada", tone: "bad" },
  LIMIT_EXCEEDED: { label: "Límite excedido", tone: "bad" },
  PENDING_DELETION: { label: "Borrándose", tone: "off" },
  ARCHIVED: { label: "Archivada", tone: "off" }
};

export const REJECTION: Record<string, string> = {
  ABUSIVE_CONTENT: "Contenido abusivo o que infringe las políticas.",
  INCORRECT_CATEGORY: "La categoría no corresponde al contenido.",
  INVALID_FORMAT: "Formato no válido (variables, espacios o ejemplos).",
  SCAM: "Meta lo consideró posible fraude.",
  TAG_CONTENT_MISMATCH: "El contenido no coincide con la categoría.",
  PROMOTIONAL: "Tiene contenido promocional en una categoría que no lo permite."
};

export const QUALITY: Record<string, string> = { GREEN: "Alta", YELLOW: "Media", RED: "Baja", UNKNOWN: "Sin datos" };

export const LANGUAGES: [string, string][] = [
  ["es_MX", "Español (México)"],
  ["es", "Español"],
  ["en_US", "Inglés (EE. UU.)"],
  ["en", "Inglés"]
];

export function languageLabel(code: string) {
  return LANGUAGES.find(([c]) => c === code)?.[1] ?? code;
}

export function estimatedCost(rates: Rates | null, category: string): string | null {
  const v = rates?.[category as keyof Omit<Rates, "currency">];
  if (typeof v !== "number") return null;
  const symbol = rates!.currency === "USD" ? "US$" : rates!.currency === "MXN" ? "MX$" : `${rates!.currency} `;
  return `≈ ${symbol}${v.toFixed(4)} por mensaje entregado`;
}

const VAR = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;

// Variables de un texto en orden de aparición, sin repetir.
export function varsIn(text = ""): string[] {
  return [...new Set([...text.matchAll(VAR)].map(m => m[1]))];
}

export function fill(text: string, values: Record<string, string>): string {
  return text.replace(VAR, (m, k: string) => values[k]?.trim() || m);
}

export function part<T extends Component["type"]>(t: { components: Component[] }, type: T) {
  return t.components.find(c => c.type === type) as Extract<Component, { type: T }> | undefined;
}

// ── Envío ────────────────────────────────────────────────────

export type SendValues = {
  header: Record<string, string>;
  body: Record<string, string>;
  buttons: Record<number, string>;
  headerMedia?: { id: string; name?: string } | null;
};

function ordered(keys: string[], named: boolean) {
  return named ? keys : [...keys].sort((a, b) => Number(a) - Number(b));
}

function textParams(keys: string[], values: Record<string, string>, named: boolean) {
  return ordered(keys, named).map(k => ({ type: "text", text: values[k]?.trim() ?? "", ...(named ? { parameter_name: k } : {}) }));
}

// Lo que falta por llenar antes de enviar (texto para el usuario) o null.
export function missingValue(t: Template, v: SendValues): string | null {
  const header = part(t, "HEADER");
  if (header && header.format !== "TEXT" && header.format !== "LOCATION" && !v.headerMedia) return "Elige el archivo del encabezado";
  if (varsIn(header?.format === "TEXT" ? header.text : "").some(k => !v.header[k]?.trim())) return "Llena las variables del encabezado";
  if (varsIn(part(t, "BODY")?.text).some(k => !v.body[k]?.trim())) return "Llena las variables del mensaje";
  const buttons = part(t, "BUTTONS")?.buttons ?? [];
  if (buttons.some((b, i) => dynamicButton(b) && !v.buttons[i]?.trim())) return "Llena las variables de los botones";
  return null;
}

export function dynamicButton(b: Button) {
  return b.type === "COPY_CODE" || (b.type === "URL" && varsIn(b.url).length > 0);
}

export function sendComponents(t: Template, v: SendValues): unknown[] {
  const named = t.parameter_format === "NAMED";
  const out: unknown[] = [];
  const header = part(t, "HEADER");
  if (header?.format === "TEXT") {
    const keys = varsIn(header.text);
    if (keys.length) out.push({ type: "header", parameters: textParams(keys, v.header, named) });
  } else if (header && header.format !== "LOCATION" && v.headerMedia) {
    const kind = header.format.toLowerCase();
    const media: Record<string, string> = { id: v.headerMedia.id };
    if (kind === "document" && v.headerMedia.name) media.filename = v.headerMedia.name;
    out.push({ type: "header", parameters: [{ type: kind, [kind]: media }] });
  }
  const bodyKeys = varsIn(part(t, "BODY")?.text);
  if (bodyKeys.length) out.push({ type: "body", parameters: textParams(bodyKeys, v.body, named) });
  (part(t, "BUTTONS")?.buttons ?? []).forEach((b, i) => {
    if (!dynamicButton(b)) return;
    const value = v.buttons[i]?.trim() ?? "";
    out.push(
      b.type === "COPY_CODE"
        ? { type: "button", sub_type: "copy_code", index: String(i), parameters: [{ type: "coupon_code", coupon_code: value }] }
        : { type: "button", sub_type: "url", index: String(i), parameters: [{ type: "text", text: value }] }
    );
  });
  return out;
}

// ── Creación y edición ───────────────────────────────────────

export type HeaderFormat = "NONE" | "TEXT" | "IMAGE" | "VIDEO" | "DOCUMENT";

export type Draft = {
  name: string;
  language: string;
  category: "MARKETING" | "UTILITY";
  headerFormat: HeaderFormat;
  headerText: string;
  headerHandle: string | null; // ejemplo multimedia subido a Meta
  headerExample: any; // ejemplo que ya tenía la plantilla (al editar)
  body: string;
  footer: string;
  headerExamples: Record<string, string>;
  examples: Record<string, string>; // de las variables del mensaje
  buttons: { type: "QUICK_REPLY" | "URL" | "PHONE_NUMBER"; text: string; url: string; phone: string; example: string }[];
};

export const EMPTY_DRAFT: Draft = {
  name: "",
  language: "es_MX",
  category: "UTILITY",
  headerFormat: "NONE",
  headerText: "",
  headerHandle: null,
  headerExample: null,
  body: "",
  footer: "",
  headerExamples: {},
  examples: {},
  buttons: []
};

function headerExampleValues(t: Template): Record<string, string> {
  const out: Record<string, string> = {};
  const header = part(t, "HEADER");
  const ex = header?.example ?? {};
  varsIn(header?.format === "TEXT" ? header.text : "").forEach((k, i) => {
    out[k] = ex.header_text_named_params?.find((p: any) => p.param_name === k)?.example ?? ex.header_text?.[i] ?? "";
  });
  return out;
}

function bodyExampleValues(t: Template): Record<string, string> {
  const out: Record<string, string> = {};
  const body = part(t, "BODY");
  const ex = body?.example ?? {};
  const positional = ordered(varsIn(body?.text), false);
  varsIn(body?.text).forEach(k => {
    out[k] =
      ex.body_text_named_params?.find((p: any) => p.param_name === k)?.example ??
      ex.body_text?.[0]?.[positional.indexOf(k)] ??
      "";
  });
  return out;
}

export function draftFrom(t: Template): Draft {
  const header = part(t, "HEADER");
  const buttons = part(t, "BUTTONS")?.buttons ?? [];
  return {
    name: t.name,
    language: t.language,
    category: t.category === "MARKETING" ? "MARKETING" : "UTILITY",
    headerFormat: (header && header.format !== "LOCATION" ? header.format : "NONE") as HeaderFormat,
    headerText: header?.text ?? "",
    headerHandle: null,
    headerExample: header && header.format !== "TEXT" ? header.example ?? null : null,
    body: part(t, "BODY")?.text ?? "",
    footer: part(t, "FOOTER")?.text ?? "",
    headerExamples: headerExampleValues(t),
    examples: bodyExampleValues(t),
    buttons: buttons
      .filter(b => b.type === "QUICK_REPLY" || b.type === "URL" || b.type === "PHONE_NUMBER")
      .map(b => {
        const ex = Array.isArray(b.example) ? b.example[0] : b.example;
        const prefix = (b.url ?? "").split("{{")[0];
        return {
          type: b.type as "QUICK_REPLY" | "URL" | "PHONE_NUMBER",
          text: b.text,
          url: b.url ?? "",
          phone: b.phone_number ?? "",
          example: ex && prefix && ex.startsWith(prefix) ? ex.slice(prefix.length) : ex ?? ""
        };
      })
  };
}

// Revisa el borrador y arma lo que se manda a Meta. Devuelve un error legible o el cuerpo.
export function buildTemplate(d: Draft): { error: string } | { body: Record<string, unknown> } {
  const headerVars = d.headerFormat === "TEXT" ? varsIn(d.headerText) : [];
  const bodyVars = varsIn(d.body);
  const all = [...headerVars, ...bodyVars];
  const numeric = all.filter(k => /^\d+$/.test(k));
  if (numeric.length && numeric.length !== all.length) {
    return { error: "No mezcles variables numeradas ({{1}}) con variables con nombre ({{nombre}})" };
  }
  const named = all.length > 0 && numeric.length === 0;
  if (named && all.some(k => !/^[a-z][a-z0-9_]*$/.test(k))) {
    return { error: "Las variables con nombre van en minúsculas y sin espacios, por ejemplo {{nombre_cliente}}" };
  }
  for (const [label, keys] of [["encabezado", headerVars], ["mensaje", bodyVars]] as const) {
    if (!named && keys.length && ordered(keys, false).some((k, i) => Number(k) !== i + 1)) {
      return { error: `Las variables del ${label} deben ir en orden: {{1}}, {{2}}, …` };
    }
  }
  if (headerVars.length > 1) return { error: "El encabezado admite una sola variable" };
  if (headerVars.some(k => !d.headerExamples[k]?.trim()) || bodyVars.some(k => !d.examples[k]?.trim())) return { error: "Escribe un ejemplo para cada variable (Meta lo pide para revisarla)" };
  const body = d.body.trim();
  if (!body) return { error: "El mensaje es obligatorio" };
  if (/^\{\{[^}]+\}\}|\{\{[^}]+\}\}$/.test(body)) return { error: "El mensaje no puede empezar ni terminar con una variable" };
  if (body.length > 1024) return { error: "El mensaje admite hasta 1,024 caracteres" };

  const components: Record<string, unknown>[] = [];
  if (d.headerFormat === "TEXT") {
    if (!d.headerText.trim()) return { error: "Escribe el texto del encabezado o quítalo" };
    const h: Record<string, unknown> = { type: "HEADER", format: "TEXT", text: d.headerText.trim() };
    if (headerVars.length) {
      const k = headerVars[0];
      const example = d.headerExamples[k].trim();
      h.example = named ? { header_text_named_params: [{ param_name: k, example }] } : { header_text: [example] };
    }
    components.push(h);
  } else if (d.headerFormat !== "NONE") {
    const example = d.headerHandle ? { header_handle: [d.headerHandle] } : d.headerExample;
    if (!example) return { error: "Sube un archivo de ejemplo para el encabezado" };
    components.push({ type: "HEADER", format: d.headerFormat, example });
  }
  const b: Record<string, unknown> = { type: "BODY", text: body };
  if (bodyVars.length) {
    b.example = named
      ? { body_text_named_params: bodyVars.map(k => ({ param_name: k, example: d.examples[k].trim() })) }
      : { body_text: [ordered(bodyVars, false).map(k => d.examples[k].trim())] };
  }
  components.push(b);
  if (d.footer.trim()) {
    if (varsIn(d.footer).length) return { error: "El pie de página no admite variables" };
    components.push({ type: "FOOTER", text: d.footer.trim() });
  }
  if (d.buttons.length) {
    const quick = d.buttons.map(b => b.type === "QUICK_REPLY");
    if (quick.slice(1).filter((q, i) => q !== quick[i]).length > 1) {
      return { error: "Agrupa los botones: primero todas las respuestas rápidas y luego los de enlace o llamada (o al revés)" };
    }
    const buttons: Record<string, unknown>[] = [];
    for (const btn of d.buttons) {
      const text = btn.text.trim();
      if (!text) return { error: "Todos los botones necesitan texto" };
      if (btn.type === "QUICK_REPLY") buttons.push({ type: "QUICK_REPLY", text });
      else if (btn.type === "PHONE_NUMBER") {
        const phone = btn.phone.replace(/[^\d+]/g, "");
        if (!/^\+?\d{8,15}$/.test(phone)) return { error: `Número no válido en el botón "${text}"` };
        buttons.push({ type: "PHONE_NUMBER", text, phone_number: phone.startsWith("+") ? phone : `+${phone}` });
      } else {
        const url = btn.url.trim();
        if (!/^https:\/\/\S+$/.test(url)) return { error: `El botón "${text}" necesita un enlace https://` };
        const vars = varsIn(url);
        if (vars.length > 1 || (vars.length && (vars[0] !== "1" || !url.endsWith("{{1}}")))) {
          return { error: "El enlace solo admite una variable {{1}} al final" };
        }
        const button: Record<string, unknown> = { type: "URL", text, url };
        if (vars.length) {
          if (!btn.example.trim()) return { error: `Escribe un ejemplo para el enlace del botón "${text}"` };
          button.example = [url.replace(/\{\{1\}\}$/, btn.example.trim())];
        }
        buttons.push(button);
      }
    }
    components.push({ type: "BUTTONS", buttons });
  }
  return {
    body: {
      name: d.name,
      language: d.language,
      category: d.category,
      parameter_format: named ? "NAMED" : "POSITIONAL",
      components
    }
  };
}

// Plantilla “de mentira” a partir del borrador, para la vista previa.
export function draftPreview(d: Draft): Template {
  const components: Component[] = [];
  if (d.headerFormat === "TEXT") components.push({ type: "HEADER", format: "TEXT", text: d.headerText });
  else if (d.headerFormat !== "NONE") components.push({ type: "HEADER", format: d.headerFormat });
  components.push({ type: "BODY", text: d.body });
  if (d.footer.trim()) components.push({ type: "FOOTER", text: d.footer });
  if (d.buttons.length) {
    components.push({
      type: "BUTTONS",
      buttons: d.buttons.map(b => ({ type: b.type, text: b.text || "Botón", url: b.url, phone_number: b.phone }))
    });
  }
  return {
    id: "",
    name: d.name,
    language: d.language,
    category: d.category,
    status: "DRAFT",
    parameter_format: "POSITIONAL",
    components,
    rejected_reason: null,
    quality: null,
    updated_at: 0
  };
}
