import { Badge, Button, Clock3, Lock } from "@openbot/ui";
import { ProviderModelPicker } from "@openbot/ui/components/ProviderModelPicker";
import type { AgentProfile } from "@openbot/ui/data";
import { AgentAvatar } from "@openbot/ui/features/agents/AgentAvatar";
import { agentAccessLockLabel } from "@openbot/ui/features/agents/agent-access";
import { RemoteDesktopIcon } from "@openbot/ui/features/conversation/ConversationIcons";
import { PinnedMessages, type PinnedMessagesProps } from "@openbot/ui/features/conversation/PinnedMessages";
import { SidePanelToggle, type SidePanelToggleProps } from "@openbot/ui/features/conversation/SidePanel";
import { TabShape } from "@openbot/ui/features/conversation/TabShape";
import { useText } from "@openbot/ui/text";
import type { ComponentProps, JSX } from "@solidjs/web";
import { createEffect, onSettled, Show } from "solid-js";
import { modelPickerFit } from "./model-picker-fit";

export interface ConversationHeaderProps {
  agent: AgentProfile | null | undefined;
  title?: JSX.Element | undefined;
  modelPicker: ComponentProps<typeof ProviderModelPicker>;
  pendingModel?: ConversationHeaderPendingModel | undefined;
  onSettingsIntent: () => void;
  onOpenSettings: () => void;
  onOpenChat?: (() => void) | undefined;
  remoteControl?: ConversationHeaderRemoteControl | undefined;
  pinnedMessages?: PinnedMessagesProps | undefined;
  sidePanel?: SidePanelToggleProps | undefined;
  threads?: JSX.Element | undefined;
  titleSelected?: boolean | undefined;
}

export interface ConversationHeaderPendingModel {
  running: string;
  next: string;
}

export interface ConversationHeaderRemoteControl {
  enabled: boolean;
  active: boolean;
  visible: boolean;
  onOpen: (trigger: HTMLButtonElement) => void;
}

const AGENT_TITLE_MIN_EM = 4;

function AgentTitle(props: { title: string }) {
  let room: HTMLSpanElement | undefined;
  let title: HTMLSpanElement | undefined;
  let schedule: (() => void) | undefined;
  createEffect(
    () => props.title,
    () => schedule?.(),
  );
  onSettled(() => {
    const header = room?.closest(".conversation-header");
    if (!room || !header) return;
    let frame = 0;
    schedule = () => {
      if (frame === 0)
        frame = requestAnimationFrame(() => {
          frame = 0;
          measure();
        });
    };
    const observer = new ResizeObserver(schedule);
    const measure = () => {
      if (!room) return;
      for (const part of header.querySelectorAll(
        ".conversation-title, .conversation-heading-group, .conversation-header-actions, .agent-threads-header",
      )) {
        observer.observe(part);
      }
      room.removeAttribute("data-hidden");
      const style = getComputedStyle(room);
      if (style.display === "none") return;
      const minimum = AGENT_TITLE_MIN_EM * (Number.parseFloat(style.fontSize) || 12);
      const cut = title ? title.scrollWidth > title.clientWidth : false;
      room.toggleAttribute("data-hidden", cut && room.getBoundingClientRect().width < minimum);
    };
    observer.observe(room);
    observer.observe(header);
    measure();
    return () => {
      schedule = undefined;
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  });
  return (
    <span ref={room} class="conversation-agent-title-room">
      <span ref={title} class="conversation-agent-title" dir="auto">
        {props.title}
      </span>
    </span>
  );
}

function fitHeaderPicker(header: HTMLElement) {
  const parts = () =>
    header.querySelectorAll<HTMLElement>(
      ":scope > .conversation-heading-group, :scope > .conversation-header-actions, :scope > .conversation-header-actions > *",
    );
  const overflows = () => [...parts()].some((part) => part.scrollWidth - part.clientWidth > 1);
  const picker = modelPickerFit(header, overflows, () => measure());
  const measure = () => {
    for (const part of parts()) observer.observe(part);
    const row = header.querySelector(":scope > .conversation-heading-group > .agent-threads-header");
    if (row) observer.observe(row);
    if (header.querySelector('.agent-threads-tabs, .agent-threads-header:not([data-mode="tabs"])')) return;
    if (header.querySelector(".provider-model-trigger")) picker.fit();
    else delete header.dataset.modelFit;
  };
  const observer = new ResizeObserver(measure);
  observer.observe(header);
  measure();
  return () => {
    observer.disconnect();
    picker.stop();
  };
}

export function ConversationHeader(props: ConversationHeaderProps) {
  const { t } = useText();
  const titleTab = () => (props.titleSelected === undefined ? undefined : "");
  const titleSelected = () => (props.titleSelected ? "" : undefined);
  let header: HTMLElement | undefined;
  onSettled(() => (header ? fitHeaderPicker(header) : undefined));
  return (
    <header ref={header} class="window-drag conversation-header">
      <div class="conversation-heading-group">
        <Show when={props.agent} fallback={props.title}>
          {(agent) => (
            <Button
              variant="ghost"
              size="sm"
              type="button"
              class="conversation-title no-drag"
              data-tab={titleTab()}
              data-selected={titleSelected()}
              aria-label={props.onOpenChat ? t("conversation.header.mainChat") : t("conversation.header.settings")}
              onPointerEnter={() => props.onOpenChat || props.onSettingsIntent()}
              onFocus={() => props.onOpenChat || props.onSettingsIntent()}
              onClick={() => (props.onOpenChat ?? props.onOpenSettings)()}
            >
              <AgentAvatar agent={agent()} />
              <h1 class="conversation-agent-heading" dir="auto">
                <span class="conversation-agent-name">{agent().name}</span>
                <Show when={agent().title.trim()}>{(title) => <AgentTitle title={title()} />}</Show>
              </h1>
            </Button>
          )}
        </Show>
        <Show when={props.agent && agentAccessLockLabel(props.agent, t)}>
          {(label) => (
            <span class="conversation-access-lock" role="img" aria-label={label()} title={label()}>
              <Lock aria-hidden="true" />
            </span>
          )}
        </Show>
        {props.threads}
      </div>
      <div class="conversation-header-actions no-drag">
        <Show when={props.agent && props.pendingModel}>
          {(change) => {
            const detail = () => t("conversation.header.modelNextTurnDetail", change());
            return (
              <Badge variant="info-light" class="conversation-model-pending" role="status" title={detail()}>
                <Clock3 aria-hidden="true" />
                {t("conversation.header.modelNextTurn")}
                <span class="sr-only">{detail()}</span>
              </Badge>
            );
          }}
        </Show>
        <Show when={props.agent}>
          <ProviderModelPicker {...props.modelPicker} />
        </Show>
        <Show when={props.remoteControl}>
          {(control) => (
            <Button
              variant="ghost"
              type="button"
              class="header-panel-toggle remote-desktop-button"
              aria-label={t(control().active ? "conversation.header.resumeRemote" : "conversation.header.openRemote")}
              aria-expanded={control().visible ? "true" : "false"}
              disabled={!control().enabled}
              onClick={(event) => control().onOpen(event.currentTarget)}
              data-cuelume-tap="open"
            >
              <RemoteDesktopIcon />
              <Show when={control().active}>
                <span class="remote-desktop-button-dot" aria-hidden="true" />
              </Show>
            </Button>
          )}
        </Show>
        <Show when={props.pinnedMessages}>{(pins) => <PinnedMessages {...pins()} />}</Show>
        <Show when={props.sidePanel}>{(sidePanel) => <SidePanelToggle {...sidePanel()} />}</Show>
      </div>
      <Show when={props.agent && titleTab() !== undefined}>
        <TabShape
          selected='.conversation-title[data-tab][data-selected], .agent-threads-tab[aria-selected="true"], .agent-threads-switcher'
          sized=".conversation-title, .agent-threads-tabs, .agent-threads-tab, .agent-threads-switcher"
          scroller=".agent-threads-tabs"
        />
      </Show>
    </header>
  );
}
