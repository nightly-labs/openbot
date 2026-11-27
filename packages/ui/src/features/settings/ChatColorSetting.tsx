import type { AvatarColor } from "@openbot/contracts/ipc";
import type { JSX } from "@solidjs/web";
import { createEffect, createSignal, onSettled, Show, untrack } from "solid-js";
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

export type ColorPopupPicker = (props: {
  label: string;
  value: AvatarColor | null;
  onChange: (value: AvatarColor | null) => void;
}) => JSX.Element;

function ChatColorPopup(props: {
  anchor: ColorPickerAnchor;
  label: string;
  value: AvatarColor | null;
  picker: ColorPopupPicker;
  onDraft: (value: AvatarColor | null) => void;
  onClose: () => void;
  controls: (close: () => void) => void;
}) {
  return (
    <ColorPickerPopover anchor={props.anchor} label={props.label} onClose={props.onClose} controls={props.controls}>
      {untrack(() =>
        props.picker({
          get label() {
            return props.label;
          },
          get value() {
            return props.value;
          },
          onChange: props.onDraft,
        }),
      )}
    </ColorPickerPopover>
  );
}

export function createChatColorPopup(
  value: () => AvatarColor | null,
  save: (value: AvatarColor | null) => void,
  picker: ColorPopupPicker = ChatColorPicker,
) {
  const [anchor, setAnchor] = createSignal<ColorPickerAnchor | null>(null);
  const [draft, setDraft] = createSignal<AvatarColor | null>(null);
  let close: (() => void) | undefined;
  let dot: HTMLSpanElement | undefined;
  let opened: AvatarColor | null = null;

  const commit = () => {
    if (anchor() === null) return;
    const next = draft();
    if (next !== opened) save(next);
  };

  onSettled(() => commit);

  return {
    open: () => anchor() !== null,
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
            picker={picker}
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
  value: AvatarColor | null;
  onChange: (value: AvatarColor | null) => void;
}

export function AgentChatColorRow(props: ChatColorSettingProps & { agentName: string }) {
  const { t } = useText();
  const name = useChatColorName();
  const popup = createChatColorPopup(
    () => props.value,
    (value) => props.onChange(value),
  );
  let trigger: HTMLButtonElement | undefined;
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
