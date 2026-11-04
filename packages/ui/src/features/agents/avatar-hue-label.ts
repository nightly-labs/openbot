import type { AvatarColorChoice, AvatarColorPresetId } from "@openbot/brand/bloub-avatar";
import type { AvatarHue } from "@openbot/contracts/ipc";
import type { AppTextKey } from "@openbot/i18n";

/** The name of each avatar hue. `AVATAR_HUE_CHOICES` in `@openbot/brand` keeps English labels. */
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

const AVATAR_PRESET_LABEL = {
  pink: "agent.color.pink",
  sky: "agent.color.sky",
  navy: "agent.color.navy",
  wine: "agent.color.wine",
  brown: "agent.color.brown",
  sand: "agent.color.sand",
  grey: "agent.color.grey",
} as const satisfies Record<AvatarColorPresetId, AppTextKey>;

/** The name of a colour in an agent colour picker. */
export function avatarColorChoiceLabel(choice: AvatarColorChoice): AppTextKey {
  return choice.kind === "hue" ? AVATAR_HUE_LABEL[choice.hue] : AVATAR_PRESET_LABEL[choice.preset];
}
