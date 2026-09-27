import type { CSSProperties } from "react";
import type { Tag } from "../api";
import { TAG_HEX } from "../format";

export default function TagChip({
  tag,
  active = true,
  onClick,
  small
}: {
  tag: Pick<Tag, "name" | "color">;
  active?: boolean;
  onClick?: () => void;
  small?: boolean;
}) {
  const style = { "--tag-color": TAG_HEX[tag.color] ?? TAG_HEX.gray } as CSSProperties;
  const className = `tag ${active ? "active" : ""} ${small ? "small" : ""} ${onClick ? "clickable" : ""}`;
  return onClick ? (
    <button type="button" className={className} style={style} onClick={onClick} aria-pressed={active}>
      {tag.name}
    </button>
  ) : (
    <span className={className} style={style}>
      {tag.name}
    </span>
  );
}
