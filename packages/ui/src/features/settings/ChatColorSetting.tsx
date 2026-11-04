/**
 * The Chat color setting: a row that opens the chat color picker in a popup. The agent settings use
 * a link row; Settings › General uses a select-like trigger. Only the tint of chat bubbles changes;
 * avatars keep their own colors.
 *
 * The popup keeps a draft while it is open and shows it in the dot of the row. It saves once, when it
 * closes, and only when the color changed, so a drag does not send a save for each frame.
 */

import type { AvatarColor } from "@openbot/contracts/ipc";
import { createEffect, createSignal, onSettled, Show } from "solid-js";
import { type ColorPickerAnchor, ColorPickerPopover, ColorPickerTrigger } from "../../color-picker";
import { SettingsLinkGroup, SettingsLinkRow } from "../../components/SettingsPanel";
import { Palette } from "../../icons";
import { useText } from "../../text";
import { ChatColorPicker, useChatColorName } from "./ChatColorPicker";

export function ChatColorDot(props: {
  color: AvatarColor | null;
  open?: boolean;
  ref?: (element: HTMLSpanElement) => void;
}) {
  return (
    <span
      ref={(element) => props.ref?.(element)}
      class={[
        "chat-color-dot",
        { "chat-color-none": props.color === null, "chat-color-dot-open": props.open === true },
      ]}
      style={props.color ? `--chat-color-value: ${props.color}` : ""}
      aria-hidden="true"
    />
  );
}

function ChatColorPopup(props: {
  anchor: ColorPickerAnchor;
  label: string;
  value: AvatarColor | null;
  onDraft: (value: AvatarColor | null) => void;
  onClose: () => void;
  controls: (close: () => void) => void;
}) {
  return (
    <ColorPickerPopover anchor={props.anchor} label={props.label} onClose={props.onClose} controls={props.controls}>
      <ChatColorPicker label={props.label} value={props.value} onChange={props.onDraft} />
    </ColorPickerPopover>
  );
}

/**
 * The open state of a Chat color popup: the draft color and the trigger it opens from. The draft is
 * saved through `save` when the popup closes or the row goes away, and only when it changed.
 */
function createChatColorPopup(value: () => AvatarColor | null, save: (value: AvatarColor | null) => void) {
  const [anchor, setAnchor] = createSignal<ColorPickerAnchor | null>(null);
  const [draft, setDraft] = createSignal<AvatarColor | null>(null);
  let close: (() => void) | undefined;
  let dot: HTMLSpanElement | undefined;
  /** The value when the popup opened. A keyed row can unmount after its props moved to another agent. */
  let opened: AvatarColor | null = null;

  const commit = () => {
    if (anchor() === null) return;
    const next = draft();
    if (next !== opened) save(next);
  };

  onSettled(() => commit);

  return {
    open: () => anchor() !== null,
    /** The color to show: the draft while the popup is open, the saved value after. */
    shown: () => (anchor() === null ? value() : draft()),
    dot: (element: HTMLSpanElement) => (dot = element),
    toggle: (trigger: HTMLElement) => {
      if (anchor()) close?.();
      else {
        opened = value();
        setDraft(opened);
        setAnchor({ trigger, dot });
      }
    },
    popup: (label: string) => (
      <Show when={anchor()} keyed>
        {(open) => (
          <ChatColorPopup
            anchor={open}
            label={label}
            value={draft()}
            onDraft={setDraft}
            onClose={() => {
              commit();
              setAnchor(null);
            }}
            controls={(next) => (close = next)}
          />
        )}
      </Show>
    ),
  };
}

export interface ChatColorSettingProps {
  /** The saved chat color, or null for none. */
  value: AvatarColor | null;
  onChange: (value: AvatarColor | null) => void;
}

/** The Chat color row of the agent settings: a link row with the color name and dot. */
export function AgentChatColorRow(props: ChatColorSettingProps & { agentName: string }) {
  const { t } = useText();
  const name = useChatColorName();
  const popup = createChatColorPopup(
    () => props.value,
    (value) => props.onChange(value),
  );
  let trigger: HTMLButtonElement | undefined;
  // The link row does not take ARIA props, so the state goes on its button.
  createEffect(popup.open, (open) => trigger?.setAttribute("aria-expanded", open ? "true" : "false"));
  return (
    <SettingsLinkGroup inset>
      <SettingsLinkRow
        ref={(element) => {
          trigger = element;
          element.setAttribute("aria-haspopup", "dialog");
          element.setAttribute("aria-expanded", "false");
        }}
        icon={<Palette aria-hidden="true" />}
        label={t("settings.chatColor.title")}
        value={
          <>
            <span class="settings-link-text ui-text-truncate">{name(popup.shown())}</span>
            <ChatColorDot ref={popup.dot} color={popup.shown()} open={popup.open()} />
          </>
        }
        onClick={popup.toggle}
      />
      {popup.popup(t("settings.chatColor.agentLabel", { name: props.agentName }))}
    </SettingsLinkGroup>
  );
}

/** The trigger of the own Chat color row in Settings: it looks like the select triggers beside it. */
export function OwnChatColorTrigger(props: ChatColorSettingProps) {
  const { t } = useText();
  const name = useChatColorName();
  const popup = createChatColorPopup(
    () => props.value,
    (value) => props.onChange(value),
  );
  return (
    <div class="settings-modal-select">
      <ColorPickerTrigger label={t("settings.chatColor.title")} expanded={popup.open()} onClick={popup.toggle}>
        <ChatColorDot ref={popup.dot} color={popup.shown()} open={popup.open()} />
        <span class="ui-select-value">{name(popup.shown())}</span>
      </ColorPickerTrigger>
      {popup.popup(t("settings.chatColor.yours"))}
    </div>
  );
}
