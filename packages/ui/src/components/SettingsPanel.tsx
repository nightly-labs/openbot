import { Button, ChevronRight, FieldContext } from "@openbot/ui";
import type { JSX } from "@solidjs/web";
import { createUniqueId, Show } from "solid-js";
import { PanelResizer } from "./PanelResizer";

export const SETTINGS_PANEL_DEFAULT = 296;
export const SETTINGS_PANEL_MIN = 180;
export const SETTINGS_PANEL_MAX = 1600;
/** What the chat under the panel keeps for itself, however far the panel is dragged. */
const CONVERSATION_PANEL_MIN = 96;

/** Shared right-panel shell; caller owns per-owner sections. */

/** How wide the panel may be drawn before the chat beside it is squeezed out of readability. */
export function settingsPanelMaxWidth(host: HTMLElement | undefined): number {
  const available = (host?.clientWidth || window.innerWidth) - CONVERSATION_PANEL_MIN;
  return Math.min(SETTINGS_PANEL_MAX, Math.max(SETTINGS_PANEL_MIN, available));
}

export interface SettingsPanelProps {
  id: string;
  label: string;
  width: number;
  maxWidth: number | (() => number);
  onResize: (width: number) => void;
  onResizeEnd: (width: number) => void;
  children: JSX.Element;
}

export function SettingsPanel(props: SettingsPanelProps): JSX.Element {
  return (
    <aside id={props.id} class="settings-panel" aria-label={props.label}>
      <PanelResizer
        class="right-panel-resizer"
        label="Resize right panel"
        controls={props.id}
        direction="right"
        value={props.width}
        defaultValue={SETTINGS_PANEL_DEFAULT}
        min={SETTINGS_PANEL_MIN}
        max={props.maxWidth}
        onResize={props.onResize}
        onResizeEnd={props.onResizeEnd}
      />
      {props.children}
    </aside>
  );
}

/** Header glyphs stay here to stop agent/channel drift. */
export function SettingsBackIcon(): JSX.Element {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" class="ui-glyph-20 settings-back-icon fill-none stroke-current">
      <path d="m12.5 4-6 6 6 6" stroke-linecap="round" stroke-linejoin="round" />
    </svg>
  );
}

export function SettingsForwardIcon(): JSX.Element {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" class="ui-glyph-20 settings-forward-icon fill-none stroke-current">
      <path d="m5.5 4 6 6-6 6m5-12 6 6-6 6" stroke-linecap="round" stroke-linejoin="round" />
    </svg>
  );
}

export interface SettingsPanelHeaderProps {
  title: JSX.Element;
  onBack?: () => void;
  backLabel?: string;
  onClose: () => void;
  closeLabel: string;
}

/** Fixed 3-column header keeps title centred. */
export function SettingsPanelHeader(props: SettingsPanelHeaderProps): JSX.Element {
  return (
    <header class="settings-panel-header">
      <Show when={props.onBack} fallback={<span />}>
        <Button
          variant="ghost"
          type="button"
          class="settings-panel-nav-button"
          aria-label={props.backLabel ?? "Back"}
          onClick={() => props.onBack?.()}
        >
          <SettingsBackIcon />
        </Button>
      </Show>
      <h2>{props.title}</h2>
      <Button
        variant="ghost"
        type="button"
        class="settings-panel-nav-button"
        aria-label={props.closeLabel}
        onClick={() => props.onClose()}
      >
        <SettingsForwardIcon />
      </Button>
    </header>
  );
}

export function SettingsPanelContent(props: { children: JSX.Element }): JSX.Element {
  return <div class="settings-panel-content">{props.children}</div>;
}

export interface SettingsFieldProps {
  label: JSX.Element;
  class?: string;
  children: JSX.Element;
}

/** Label over caller control via shared field id. */
export function SettingsField(props: SettingsFieldProps): JSX.Element {
  const controlId = `${createUniqueId()}-control`;
  return (
    <FieldContext value={{ controlId }}>
      <label class={props.class ? `settings-field ${props.class}` : "settings-field"} for={controlId}>
        <span>{props.label}</span>
        {props.children}
      </label>
    </FieldContext>
  );
}

/** The bordered stack the link rows sit in; the rows draw the dividers between themselves. */
export function SettingsLinkGroup(props: { children: JSX.Element }): JSX.Element {
  return <div class="settings-link-group">{props.children}</div>;
}

export interface SettingsLinkRowProps {
  label: JSX.Element;
  /** The state on the right of the row, such as `3 saved`. A row with none shows only the chevron. */
  value?: JSX.Element;
  onClick: (trigger: HTMLButtonElement) => void;
}

/** One row of the group: what it opens on the left, where that stands on the right. */
export function SettingsLinkRow(props: SettingsLinkRowProps): JSX.Element {
  return (
    <Button variant="ghost" type="button" class="settings-link" onClick={(event) => props.onClick(event.currentTarget)}>
      <span class="settings-link-label">{props.label}</span>
      <span class="settings-link-value">
        {props.value}
        <ChevronRight />
      </span>
    </Button>
  );
}
