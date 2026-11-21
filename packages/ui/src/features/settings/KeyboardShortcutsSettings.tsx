import {
  Button,
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
  SettingsSection,
} from "@openbot/ui";
import { useText } from "@openbot/ui/text";
import type { JSX } from "@solidjs/web";
import { createSignal, createUniqueId, For, onCleanup, Show } from "solid-js";
import { TalkKeyCaps } from "../conversation/TalkKeyCaps";
import { isModifierCode, type KeyLayout, type TalkKey, talkKeyOfEvent } from "../conversation/talk-key";
import {
  defaultShortcut,
  FIXED_SHORTCUT_TITLES,
  type FixedShortcut,
  fixedShortcutChords,
  fixedShortcuts,
  resolveShortcut,
  SHORTCUT_COMMANDS,
  SHORTCUT_TITLES,
  type ShortcutChord,
  type ShortcutCommand,
  type ShortcutEnvironment,
  type ShortcutOverrides,
  type ShortcutRefusal,
  sameShortcut,
  shortcutRefusal,
  shortcutText,
} from "./keyboard-shortcuts";

export interface KeyboardShortcutsSettingsProps {
  environment: ShortcutEnvironment;
  overrides: ShortcutOverrides;
  layout?: KeyLayout | undefined;
  onChange: (command: ShortcutCommand, key: ShortcutChord | null) => void;
  onResetAll: () => void;
}

interface ShortcutRowProps {
  command: ShortcutCommand;
  environment: ShortcutEnvironment;
  overrides: ShortcutOverrides;
  layout?: KeyLayout | undefined;
  onChange: (key: ShortcutChord | null) => void;
}

function hasNoModifier(event: KeyboardEvent): boolean {
  return !event.ctrlKey && !event.altKey && !event.shiftKey && !event.metaKey;
}

function heldModifiers(event: KeyboardEvent): TalkKey | null {
  if (hasNoModifier(event)) return null;
  return { ctrl: event.ctrlKey, alt: event.altKey, shift: event.shiftKey, meta: event.metaKey, code: null };
}

function ShortcutRow(props: ShortcutRowProps): JSX.Element {
  const { t } = useText();
  const [recording, setRecording] = createSignal(false);
  const [pressed, setPressed] = createSignal<TalkKey | null>(null);
  const [refusal, setRefusal] = createSignal<ShortcutRefusal | null>(null);
  let recorder!: HTMLDivElement;
  const keysId = `keyboard-shortcut-keys-${createUniqueId()}`;
  const title = () => t(SHORTCUT_TITLES[props.command]);
  const current = () => resolveShortcut(props.command, props.overrides, props.environment);
  const isDefault = () => sameShortcut(current(), defaultShortcut(props.command, props.environment));
  const refusedState = () => (refusal() === null ? undefined : "true");
  const recordingState = () => (recording() ? "true" : "false");

  const refusalText = (value: ShortcutRefusal): string => {
    if (value.kind === "invalid") return t("settings.shortcuts.refused.invalid");
    if (value.kind === "reserved") return t("settings.shortcuts.refused.reserved");
    return t("settings.shortcuts.refused.taken", { command: t(SHORTCUT_TITLES[value.command]) });
  };

  const swallow = (event: KeyboardEvent) => {
    event.preventDefault();
    event.stopImmediatePropagation();
  };
  const down = (event: KeyboardEvent) => {
    swallow(event);
    if (event.code === "Escape" && hasNoModifier(event)) {
      stop();
      return;
    }
    if (event.repeat) return;
    if (isModifierCode(event.code)) {
      setRefusal(null);
      setPressed(heldModifiers(event));
      return;
    }
    const key = talkKeyOfEvent(event);
    const refused = shortcutRefusal(props.command, key, props.overrides, props.environment);
    if (refused || key.code === null) {
      setPressed(key);
      setRefusal(refused ?? { kind: "invalid" });
      return;
    }
    const chord: ShortcutChord = { ...key, code: key.code };
    stop();
    if (sameShortcut(chord, current())) return;
    props.onChange(sameShortcut(chord, defaultShortcut(props.command, props.environment)) ? null : chord);
  };
  const up = (event: KeyboardEvent) => {
    swallow(event);
    if (refusal() === null) setPressed(heldModifiers(event));
  };
  const pressOutside = (event: PointerEvent) => {
    if (!(event.target instanceof Node && recorder.contains(event.target))) stop();
  };

  function start(): void {
    if (recording()) return;
    setPressed(null);
    setRefusal(null);
    setRecording(true);
    window.addEventListener("keydown", down, true);
    window.addEventListener("keyup", up, true);
    window.addEventListener("blur", stop);
    window.addEventListener("pointerdown", pressOutside, true);
  }

  function stop(): void {
    if (!recording()) return;
    setRecording(false);
    setPressed(null);
    setRefusal(null);
    window.removeEventListener("keydown", down, true);
    window.removeEventListener("keyup", up, true);
    window.removeEventListener("blur", stop);
    window.removeEventListener("pointerdown", pressOutside, true);
  }

  onCleanup(stop);

  return (
    <Item data-settings-row={SHORTCUT_TITLES[props.command]} class="settings-modal-row">
      <ItemContent>
        <ItemTitle>{title()}</ItemTitle>
        <Show when={refusal()}>
          {(value) => (
            <ItemDescription class="keyboard-shortcut-refusal" role="alert">
              {refusalText(value())}
            </ItemDescription>
          )}
        </Show>
      </ItemContent>
      <ItemActions>
        <div class="keyboard-shortcut-recorder" ref={recorder}>
          <span id={keysId} class="sr-only">
            {shortcutText(current(), props.environment.platform, t)}
          </span>
          <Show when={!isDefault() && !recording()}>
            <Button variant="ghost" size="sm" type="button" onClick={() => props.onChange(null)}>
              {t("settings.shortcuts.reset")}
            </Button>
          </Show>
          <Button
            variant="ghost"
            size="sm"
            type="button"
            class="keyboard-shortcut-button"
            aria-label={t("settings.shortcuts.change", { command: title() })}
            aria-describedby={keysId}
            aria-pressed={recordingState()}
            data-refused={refusedState()}
            onClick={start}
            onBlur={stop}
          >
            <Show
              when={recording()}
              fallback={
                <TalkKeyCaps
                  binding={{ key: current(), platform: props.environment.platform, layout: props.layout }}
                  class="keyboard-shortcut-caps"
                />
              }
            >
              <Show
                when={pressed()}
                fallback={<span class="keyboard-shortcut-prompt">{t("settings.shortcuts.recording")}</span>}
              >
                {(key) => (
                  <TalkKeyCaps
                    binding={{ key: key(), platform: props.environment.platform, layout: props.layout }}
                    class="keyboard-shortcut-caps"
                  />
                )}
              </Show>
            </Show>
          </Button>
        </div>
      </ItemActions>
    </Item>
  );
}

function FixedShortcutCaps(props: {
  fixed: FixedShortcut;
  environment: ShortcutEnvironment;
  layout?: KeyLayout | undefined;
}): JSX.Element {
  const chords = () => fixedShortcutChords(props.fixed, props.environment);
  const separator = () => (props.fixed === "switchServer" ? "–" : " ");
  return (
    <span class="keyboard-shortcut-fixed">
      <For each={chords()}>
        {(key, index) => (
          <>
            <Show when={index() > 0}>
              <span class="keyboard-shortcut-separator" aria-hidden="true">
                {separator()}
              </span>
            </Show>
            <TalkKeyCaps
              binding={{ key, platform: props.environment.platform, layout: props.layout }}
              class="keyboard-shortcut-caps"
            />
          </>
        )}
      </For>
    </span>
  );
}

export function KeyboardShortcutsSettings(props: KeyboardShortcutsSettingsProps): JSX.Element {
  const { t } = useText();
  const changed = () => SHORTCUT_COMMANDS.some((command) => props.overrides[command] !== undefined);

  return (
    <>
      <SettingsSection
        title={t("settings.shortcuts.section")}
        actions={
          <Show when={changed()}>
            <Button variant="ghost" size="sm" type="button" onClick={() => props.onResetAll()}>
              {t("settings.shortcuts.resetAll")}
            </Button>
          </Show>
        }
      >
        <ItemGroup class="settings-modal-card">
          <For each={SHORTCUT_COMMANDS}>
            {(command) => (
              <ShortcutRow
                command={command}
                environment={props.environment}
                overrides={props.overrides}
                layout={props.layout}
                onChange={(key) => props.onChange(command, key)}
              />
            )}
          </For>
        </ItemGroup>
      </SettingsSection>

      <SettingsSection title={t("settings.shortcuts.fixed.section")}>
        <ItemGroup class="settings-modal-card">
          <For each={fixedShortcuts(props.environment)}>
            {(fixed) => (
              <Item data-settings-row={FIXED_SHORTCUT_TITLES[fixed]} class="settings-modal-row">
                <ItemContent>
                  <ItemTitle>{t(FIXED_SHORTCUT_TITLES[fixed])}</ItemTitle>
                </ItemContent>
                <ItemActions>
                  <FixedShortcutCaps fixed={fixed} environment={props.environment} layout={props.layout} />
                </ItemActions>
              </Item>
            )}
          </For>
        </ItemGroup>
      </SettingsSection>
    </>
  );
}
