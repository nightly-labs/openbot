import type { AvatarHue } from "@openbot/contracts/ipc";
import { buttonVariants, Check, DropdownMenu } from "@openbot/ui";
import { For, Show } from "solid-js";
import { AVATAR_HUE_CHOICES, avatarHueSwatch } from "../../bloub-avatar";
import { useText } from "../../text";
import { AVATAR_HUE_LABEL } from "../agents/avatar-hue-label";

/** The color of a named profile, as the labels of its tabs show it. */
export function browserProfileColor(hue: AvatarHue): string {
  return avatarHueSwatch(hue);
}

/**
 * The color mark of a profile. The shared profile is gray, which no named profile can be. The name
 * beside it says the same, so screen readers skip it.
 */
export function BrowserProfileDot(props: { hue: AvatarHue | "shared" }) {
  return (
    <span
      class={props.hue === "shared" ? "browser-profile-dot browser-profile-dot-shared" : "browser-profile-dot"}
      style={props.hue === "shared" ? undefined : { background: browserProfileColor(props.hue) }}
      aria-hidden="true"
    />
  );
}

/** The color of one profile in its settings: the dot opens the colors that agents also use. */
export function BrowserProfileColorMenu(props: {
  name: string;
  hue: AvatarHue;
  disabled: boolean;
  /** Where the menu opens. Absent means the document body. */
  mount?: HTMLElement | undefined;
  onChange: (hue: AvatarHue) => void;
}) {
  const { t } = useText();
  return (
    <DropdownMenu.Root placement="bottom-start" gutter={4}>
      <DropdownMenu.Trigger
        class={buttonVariants({ variant: "ghost", size: "icon-sm", class: "browser-profile-color-trigger" })}
        aria-label={t("browser.profiles.colorLabel", { name: props.name })}
        disabled={props.disabled}
      >
        <BrowserProfileDot hue={props.hue} />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal mount={props.mount ?? document.body}>
        <DropdownMenu.Content class="browser-profile-color-menu">
          <DropdownMenu.RadioGroup
            value={String(props.hue)}
            onChange={(value) => {
              const hue = AVATAR_HUE_CHOICES.find((choice) => String(choice.hue) === value)?.hue;
              if (hue !== undefined && hue !== props.hue) props.onChange(hue);
            }}
          >
            <For each={AVATAR_HUE_CHOICES}>
              {(choice) => (
                <DropdownMenu.RadioItem value={String(choice.hue)} closeOnSelect class="browser-profile-color-option">
                  <BrowserProfileDot hue={choice.hue} />
                  <span>{t(AVATAR_HUE_LABEL[choice.hue])}</span>
                  <Show when={props.hue === choice.hue}>
                    <Check aria-hidden="true" class="browser-profile-color-check" />
                  </Show>
                </DropdownMenu.RadioItem>
              )}
            </For>
          </DropdownMenu.RadioGroup>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
