import type { AvatarHue } from "@openbot/contracts/ipc";
import type { AppTextKey } from "@openbot/i18n";

/** The name of each avatar color. `AVATAR_HUE_OPTIONS` in `@openbot/brand` keeps English labels. */
export const AVATAR_HUE_LABEL = {
  0: "agent.color.red",
  30: "agent.color.orange",
  55: "agent.color.yellow",
  100: "agent.color.lime",
  150: "agent.color.green",
  185: "agent.color.cyan",
  215: "agent.color.blue",
  245: "agent.color.indigo",
  280: "agent.color.violet",
  320: "agent.color.magenta",
} as const satisfies Record<AvatarHue, AppTextKey>;
