import ambre from "@openbot/brand/assets/server-plush/ambre.webp";
import bleu from "@openbot/brand/assets/server-plush/bleu.webp";
import orange from "@openbot/brand/assets/server-plush/orange.webp";
import rose from "@openbot/brand/assets/server-plush/rose.webp";
import rouge from "@openbot/brand/assets/server-plush/rouge.webp";
import turquoise from "@openbot/brand/assets/server-plush/turquoise.webp";
import vert from "@openbot/brand/assets/server-plush/vert.webp";
import violet from "@openbot/brand/assets/server-plush/violet.webp";
import { type ServerPlushColor, serverPlushColor } from "@openbot/brand/bloub-avatar";
import type { JSX } from "@solidjs/web";
import { cx } from "./utils";

const PICTURES: Readonly<Record<ServerPlushColor, string>> = {
  rouge,
  orange,
  ambre,
  vert,
  turquoise,
  bleu,
  violet,
  rose,
};

export interface ServerPlushLogoProps {
  /** The server ID. It chooses the colour. */
  seed: string;
  class?: JSX.HTMLAttributes<HTMLImageElement>["class"];
}

/** The felt squircle that a server shows when it has no logo of its own. */
export function ServerPlushLogo(props: ServerPlushLogoProps): JSX.Element {
  return (
    <img
      class={cx("ui-server-plush-logo", props.class)}
      src={PICTURES[serverPlushColor(props.seed)]}
      alt=""
      draggable={false}
      aria-hidden="true"
    />
  );
}
