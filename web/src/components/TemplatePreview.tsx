import { Fragment, type ReactNode } from "react";
import { fill, part, type Template } from "../templates";

// Formato de WhatsApp: *negritas*, _cursivas_, ~tachado~ y `monoespaciado`.
function formatted(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(\*[^*\n]+\*|_[^_\n]+_|~[^~\n]+~|```[^`]+```|`[^`\n]+`)/g;
  let last = 0;
  let key = 0;
  for (const m of text.matchAll(re)) {
    if (m.index! > last) out.push(text.slice(last, m.index));
    const s = m[0];
    const inner = s.startsWith("```") ? s.slice(3, -3) : s.slice(1, -1);
    const Tag = ({ "*": "strong", _: "em", "~": "s", "`": "code" } as const)[s[0] as "*" | "_" | "~" | "`"];
    out.push(<Tag key={key++}>{inner}</Tag>);
    last = m.index! + s.length;
  }
  out.push(text.slice(last));
  return out;
}

const MEDIA_ICON: Record<string, string> = { IMAGE: "🖼️ Imagen", VIDEO: "🎥 Video", DOCUMENT: "📄 Documento", LOCATION: "📍 Ubicación" };
const BUTTON_ICON: Record<string, string> = { URL: "↗", PHONE_NUMBER: "📞", COPY_CODE: "⧉", OTP: "⧉", QUICK_REPLY: "↩" };

export default function TemplatePreview({
  template,
  values = {},
  headerValues = {},
  mediaUrl,
  mediaName
}: {
  template: Template;
  values?: Record<string, string>;
  headerValues?: Record<string, string>;
  mediaUrl?: string | null;
  mediaName?: string | null;
}) {
  const header = part(template, "HEADER");
  const body = part(template, "BODY");
  const footer = part(template, "FOOTER");
  const buttons = part(template, "BUTTONS")?.buttons ?? [];
  return (
    <div className="tpl-preview">
      <div className="tpl-bubble">
        {header?.format === "TEXT" && header.text && <div className="tpl-header">{formatted(fill(header.text, headerValues))}</div>}
        {header && header.format !== "TEXT" &&
          (mediaUrl && header.format === "IMAGE" ? (
            <img className="tpl-media-img" src={mediaUrl} alt="" />
          ) : (
            <div className="tpl-media">{mediaName ? `${MEDIA_ICON[header.format].split(" ")[0]} ${mediaName}` : MEDIA_ICON[header.format]}</div>
          ))}
        <div className="tpl-body">
          {body?.text ? (
            fill(body.text, values)
              .split("\n")
              .map((line, i) => (
                <Fragment key={i}>
                  {i > 0 && <br />}
                  {formatted(line)}
                </Fragment>
              ))
          ) : (
            <span className="muted">Escribe el mensaje…</span>
          )}
        </div>
        {footer?.text && <div className="tpl-footer">{footer.text}</div>}
        <div className="tpl-time">12:00</div>
      </div>
      {buttons.map((b, i) => (
        <div key={i} className="tpl-button">
          <span aria-hidden>{BUTTON_ICON[b.type] ?? ""}</span> {b.text}
        </div>
      ))}
    </div>
  );
}
