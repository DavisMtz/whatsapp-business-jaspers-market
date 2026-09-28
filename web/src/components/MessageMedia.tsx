import { useState } from "react";
import type { Message } from "../api";
import { formatSize } from "../format";
import Icon from "./Icon";

// Muestra la imagen, video, audio o documento de un mensaje (servido por /api/media con sesión).
export default function MessageMedia({ message }: { message: Message }) {
  const [failed, setFailed] = useState(false);
  const src = `/api/media/${message.id}`;
  const mime = message.media_mime ?? "";

  if (failed) {
    return (
      <div className="media-missing">
        No se pudo cargar el archivo.{" "}
        <a href={src} target="_blank" rel="noreferrer">
          Reintentar
        </a>
      </div>
    );
  }

  if (message.type === "image" || message.type === "sticker") {
    return (
      <a href={src} target="_blank" rel="noreferrer" className={`media-image ${message.type}`}>
        <img src={src} alt={message.caption ?? "Imagen"} loading="lazy" onError={() => setFailed(true)} />
      </a>
    );
  }
  if (message.type === "video") {
    return <video className="media-video" src={src} controls playsInline preload="metadata" onError={() => setFailed(true)} />;
  }
  if (message.type === "audio") {
    return <audio className="media-audio" src={src} controls preload="metadata" onError={() => setFailed(true)} />;
  }

  const name = message.media_name ?? "Documento";
  const ext = name.includes(".") ? name.split(".").pop()!.toUpperCase().slice(0, 4) : "DOC";
  return (
    <div className="media-doc">
      <div className="media-doc-icon">{mime === "application/pdf" ? "PDF" : ext}</div>
      <div className="media-doc-info">
        <a href={src} target="_blank" rel="noreferrer" className="media-doc-name">
          {name}
        </a>
        <span className="muted small">{formatSize(message.media_size)}</span>
      </div>
      <a href={`${src}?download=1`} className="icon-btn" title="Descargar" aria-label="Descargar" download={name}>
        <Icon name="download" />
      </a>
    </div>
  );
}
