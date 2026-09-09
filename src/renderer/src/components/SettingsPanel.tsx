import type { JSX } from "@solidjs/web";
import { createSignal, createUniqueId, Show } from "solid-js";
import { PanelResizer, readPanelWidth, savePanelWidth } from "./PanelResizer";
import { Button, ChevronRight, FieldContext } from "./ui";

export const SETTINGS_PANEL_STORAGE_KEY = "openbot:settings-panel-width";
export const SETTINGS_PANEL_DEFAULT = 296;
export const SETTINGS_PANEL_MIN = 180;
export const SETTINGS_PANEL_MAX = 1600;
/** What the chat under the panel keeps for itself, however far the panel is dragged. */
const CONVERSATION_PANEL_MIN = 96;

/**
 * The right-hand settings panel: the shell, its header and its scrolling body.
 *
 * The agent chat and the channel chat both open a panel in this slot, and only one of them can be
 * open at a time, so they share one shape and one remembered width. Anything that only one owner
 * has - an avatar picker, a runtime section, a member list - is the caller's, and goes in the
 * children.
 */

/** The remembered width, read once from storage and written back when a drag ends. */
export function createSettingsPanelWidth() {
  return createSignal(
    readPanelWidth(SETTINGS_PANEL_STORAGE_KEY, SETTINGS_PANEL_DEFAULT, SETTINGS_PANEL_MIN, SETTINGS_PANEL_MAX),
  );
}

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
        onResizeEnd={(value) => savePanelWidth(SETTINGS_PANEL_STORAGE_KEY, value)}
      />
      {props.children}
    </aside>
  );
}

export interface SettingsPanelHeaderProps {
  title: JSX.Element;
  onBack?: () => void;
  backLabel?: string;
  backIcon?: JSX.Element;
  onClose: () => void;
  closeLabel: string;
  closeIcon: JSX.Element;
}

/**
 * Three columns of a fixed width, so the title stays centred whether or not the panel offers a way
 * back. A panel with no back action leaves the left cell empty rather than closing the gap, which
 * is what keeps the two panels the same height and the title in the same place.
 */
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
          {props.backIcon}
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
        {props.closeIcon}
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

/**
 * A label over its control. The control is the caller's, so any `Input` or `Textarea` fits; the
 * shared field context gives it an id, so the label points at it as well as wraps it.
 */
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
