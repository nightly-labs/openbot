import { type ServerPlushColor, serverPlushColor } from "@openbot/brand/bloub-avatar";
import type { JSX } from "@solidjs/web";
import ambre from "./assets/plush/server/ambre.webp";
import bleu from "./assets/plush/server/bleu.webp";
import orange from "./assets/plush/server/orange.webp";
import rose from "./assets/plush/server/rose.webp";
import rouge from "./assets/plush/server/rouge.webp";
import turquoise from "./assets/plush/server/turquoise.webp";
import vert from "./assets/plush/server/vert.webp";
import violet from "./assets/plush/server/violet.webp";
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
