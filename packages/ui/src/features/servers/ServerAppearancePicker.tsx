import { AVATAR_COLOR_CHOICES } from "@openbot/brand/bloub-avatar";
import {
  isServerAppearanceColor,
  SERVER_APPEARANCE_SHAPES,
  type ServerAppearance,
  type ServerAppearanceShape,
} from "@openbot/contracts/team-protocol/host-appearance-v1";
import { Button, IconButton, RotateCcw } from "@openbot/ui";
import { For, Show } from "solid-js";
import { ServerPlushLogo } from "../../server-plush-logo";
import { useText } from "../../text";
import { avatarColorChoiceLabel } from "../agents/avatar-hue-label";

/** The agent colours, saved as the lower-case `#rrggbb` of their swatch. */
const COLOR_CHOICES = AVATAR_COLOR_CHOICES.flatMap((choice) => {
  const hex = choice.swatch.toLowerCase();
  return isServerAppearanceColor(hex) ? [{ choice, hex }] : [];
});

export interface ServerAppearancePickerProps {
  /** The server ID. It chooses the automatic colour. */
  serverId: string;
  /** The look that the server shows now. Null is the automatic look. */
  appearance: ServerAppearance | null;
  disabled?: boolean;
  /** Called with the new look at each choice. Null gives the automatic look again. */
  onChange: (appearance: ServerAppearance | null) => void;
}

/**
 * The shapes and colours of the plush that a server shows with no logo. It uses the markup of the
 * agent avatar picker, with no eyes.
 */
export function ServerAppearancePicker(props: ServerAppearancePickerProps) {
  const { t } = useText();
  const shape = (): ServerAppearanceShape => props.appearance?.shape ?? "squircle";
  const color = (): ServerAppearance["color"] => props.appearance?.color ?? null;
  /** The squircle in the automatic colour is the automatic look, so it is saved as null. */
  const choose = (next: ServerAppearance) =>
    props.onChange(next.shape === "squircle" && next.color === null ? null : next);
  return (
    <>
      <div class="avatar-editor-heading">
        <span>{t("agentSettings.avatar.shape")}</span>
        <div class="avatar-editor-actions">
          <Show when={props.appearance}>
            <IconButton
              variant="outline"
              type="button"
              label={t("server.settings.appearanceReset")}
              disabled={props.disabled}
              onClick={() => props.onChange(null)}
            >
              <RotateCcw aria-hidden="true" />
            </IconButton>
          </Show>
        </div>
      </div>
      <fieldset class="avatar-face-grid avatar-shape-grid" aria-label={t("server.settings.appearanceShapes")}>
        <For each={SERVER_APPEARANCE_SHAPES}>
          {(option, index) => (
            <Button
              variant="ghost"
              type="button"
              class={["avatar-face-choice", { "avatar-choice-selected": shape() === option }]}
              aria-label={t("server.settings.appearanceShapeOption", { number: index() + 1 })}
              aria-pressed={shape() === option ? "true" : "false"}
              data-cuelume-tap="select"
              disabled={props.disabled}
              onClick={() => choose({ shape: option, color: color() })}
            >
              <ServerPlushLogo
                class="server-appearance-choice"
                seed={props.serverId}
                appearance={{ shape: option, color: color() }}
              />
            </Button>
          )}
        </For>
      </fieldset>
      <div class="avatar-editor-divider" />
      <div class="avatar-editor-heading">
        <span>{t("agentSettings.avatar.color")}</span>
      </div>
      <fieldset class="avatar-color-grid" aria-label={t("server.settings.appearanceColors")}>
        <Button
          variant="ghost"
          type="button"
          class={["avatar-color-choice", { "avatar-choice-selected": color() === null }]}
          aria-label={t("server.settings.appearanceAutoColor")}
          aria-pressed={color() === null ? "true" : "false"}
          data-cuelume-tap="select"
          disabled={props.disabled}
          onClick={() => choose({ shape: shape(), color: null })}
        >
          <span class="avatar-color-swatch avatar-color-swatch-auto">{t("agentSettings.avatar.autoInitial")}</span>
        </Button>
        <For each={COLOR_CHOICES}>
          {(option) => (
            <Button
              variant="ghost"
              type="button"
              class={["avatar-color-choice", { "avatar-choice-selected": color() === option.hex }]}
              aria-label={t("server.settings.appearanceColorOption", {
                color: t(avatarColorChoiceLabel(option.choice)),
              })}
              aria-pressed={color() === option.hex ? "true" : "false"}
              data-cuelume-tap="select"
              disabled={props.disabled}
              onClick={() => choose({ shape: shape(), color: option.hex })}
            >
              <span class="avatar-color-swatch" style={{ background: option.choice.swatch }} />
            </Button>
          )}
        </For>
      </fieldset>
    </>
  );
}
