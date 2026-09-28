import type { CSSProperties } from "react";
import type { Conversation } from "../api";
import { avatarProps } from "../format";
import Icon from "./Icon";

export default function Avatar({
  contact,
  size = 44
}: {
  contact: Pick<Conversation, "custom_name" | "profile_name" | "wa_id">;
  size?: number;
}) {
  const { initials, hue } = avatarProps(contact);
  const style = { "--hue": hue, width: size, height: size, fontSize: size * 0.38 } as CSSProperties;
  return (
    <div className="avatar" style={style} aria-hidden="true">
      {initials || <Icon name="person" size={size * 0.5} />}
    </div>
  );
}
