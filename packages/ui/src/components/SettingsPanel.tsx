import { Button, ChevronRight, FieldContext } from "@openbot/ui";
import type { JSX } from "@solidjs/web";
import { children, createUniqueId, onSettled, Show } from "solid-js";
import { useText } from "../text";
import { holdFlag } from "../utils";
import { createScrollFades } from "./createScrollFades";
import { PanelResizer } from "./PanelResizer";

export const SETTINGS_PANEL_DEFAULT = 360;
export const SETTINGS_PANEL_MAX = 1600;
const CONVERSATION_PANEL_MIN = 96;

export function settingsPanelMaxWidth(host: HTMLElement | undefined): number {
  const available = (host?.clientWidth || window.innerWidth) - CONVERSATION_PANEL_MIN;
  return Math.min(SETTINGS_PANEL_MAX, Math.max(SETTINGS_PANEL_DEFAULT, available));
}

export interface SettingsPanelProps {
  id: string;
  label: string;
  width: number;
  maxWidth: number | (() => number);
  onResize: (width: number) => void;
  onResizeEnd: (width: number) => void;
  preferredWidth?: (() => number) | undefined;
  children: JSX.Element;
}

export function SettingsPanel(props: SettingsPanelProps): JSX.Element {
  const { t } = useText();
  let panel!: HTMLElement;
  onSettled(() => {
    const conversation = panel.closest("[data-side-split]") ? null : panel.closest(".conversation-panel");
    return conversation ? holdFlag(conversation, "settings-panel") : undefined;
  });
  return (
    <aside ref={panel} id={props.id} class="settings-panel" aria-label={props.label}>
      <PanelResizer
        class="right-panel-resizer"
        label={t("settings.panel.resize")}
        controls={props.id}
        direction="right"
        value={props.width}
        defaultValue={SETTINGS_PANEL_DEFAULT}
        min={SETTINGS_PANEL_DEFAULT}
        max={props.maxWidth}
        onResize={props.onResize}
        onResizeEnd={props.onResizeEnd}
        onParentResize={() => {
          const max = typeof props.maxWidth === "function" ? props.maxWidth() : props.maxWidth;
          const next = Math.round(Math.min(max, props.preferredWidth?.() ?? props.width));
          if (next !== props.width) props.onResize(next);
        }}
      />
      {props.children}
    </aside>
  );
}

export function SettingsBackIcon(): JSX.Element {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" class="ui-glyph-20 settings-back-icon fill-none stroke-current">
      <path d="m12.5 4-6 6 6 6" stroke-linecap="round" stroke-linejoin="round" />
    </svg>
  );
}

export function SettingsForwardIcon(): JSX.Element {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 20 20"
      class="ui-glyph-20 settings-forward-icon fill-none stroke-current ui-rtl-mirror"
    >
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
  paneRoot?: boolean;
}

export function SettingsPanelHeader(props: SettingsPanelHeaderProps): JSX.Element {
  const { t } = useText();
  return (
    <header class={["settings-panel-header", { "side-panel-pane-header": props.paneRoot === true }]}>
      <Show when={props.onBack} fallback={<span />}>
        <Button
          variant="ghost"
          type="button"
          class="settings-panel-nav-button"
          aria-label={props.backLabel ?? t("common.back")}
          data-cuelume-tap="navigate"
          onClick={() => props.onBack?.()}
        >
          <SettingsBackIcon />
        </Button>
      </Show>
      <h2>{props.title}</h2>
      <Button
        variant="ghost"
        type="button"
        class="settings-panel-nav-button side-panel-pane-close"
        aria-label={props.closeLabel}
        data-cuelume-tap="close"
        onClick={() => props.onClose()}
      >
        <SettingsForwardIcon />
      </Button>
    </header>
  );
}

export function SettingsPanelContent(props: { children: JSX.Element }): JSX.Element {
  const fades = createScrollFades();
  onSettled(() => fades.stop);
  return (
    <div class={["settings-panel-content", fades.classes()]} ref={fades.bind} onScroll={fades.measure}>
      <div ref={fades.watch}>{props.children}</div>
    </div>
  );
}

export interface SettingsFieldProps {
  label: JSX.Element;
  class?: string;
  children: JSX.Element;
}

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

export interface SettingsLinkGroupProps {
  title?: JSX.Element;
  inset?: boolean;
  class?: string;
  children: JSX.Element;
}

export function SettingsLinkGroup(props: SettingsLinkGroupProps): JSX.Element {
  const titleId = createUniqueId();
  const rows = () => (
    <div class={["settings-link-group", props.class ?? "", { "settings-link-group-inset": Boolean(props.inset) }]}>
      {props.children}
    </div>
  );
  return (
    <Show when={props.title} fallback={rows()}>
      <section class="settings-link-section" aria-labelledby={titleId}>
        <h3 id={titleId} class="settings-link-section-title">
          {props.title}
        </h3>
        {rows()}
      </section>
    </Show>
  );
}

export interface SettingsLinkRowProps {
  icon?: JSX.Element;
  label: JSX.Element;
  value?: JSX.Element;
  onClick: (trigger: HTMLButtonElement) => void;
  ref?: (element: HTMLButtonElement) => void;
}

export function SettingsLinkRow(props: SettingsLinkRowProps): JSX.Element {
  const value = children(() => props.value);
  return (
    <Button
      ref={(element) => props.ref?.(element)}
      variant="ghost"
      type="button"
      class="settings-link"
      data-cuelume-tap="navigate"
      onClick={(event) => props.onClick(event.currentTarget)}
    >
      <span class="settings-link-label">
        <Show when={props.icon}>
          <span class="settings-link-icon">{props.icon}</span>
        </Show>
        <span class="settings-link-text ui-text-truncate">{props.label}</span>
      </span>
      <span class="settings-link-value">
        <Show when={typeof value() === "string"} fallback={value()}>
          <span class="settings-link-text ui-text-truncate">{value()}</span>
        </Show>
        <ChevronRight />
      </span>
    </Button>
  );
}
