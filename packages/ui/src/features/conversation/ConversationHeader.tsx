import { Button } from "@openbot/ui";
import { ProviderModelPicker } from "@openbot/ui/components/ProviderModelPicker";
import type { AgentProfile } from "@openbot/ui/data";
import { AgentAvatar } from "@openbot/ui/features/agents/AgentAvatar";
import { ComputerIcon, RemoteDesktopIcon } from "@openbot/ui/features/conversation/ConversationIcons";
import type { ComponentProps } from "@solidjs/web";
import { Show } from "solid-js";

export interface ConversationHeaderProps {
  agent: AgentProfile | null | undefined;
  modelPicker: ComponentProps<typeof ProviderModelPicker>;
  onSettingsIntent: () => void;
  onOpenSettings: () => void;
  remoteControl?: {
    enabled: boolean;
    active: boolean;
    visible: boolean;
    onOpen: (trigger: HTMLButtonElement) => void;
  };
  browser?: {
    acting: boolean;
    agentName?: string;
    open: boolean;
    disabled?: boolean;
    onToggle: () => void;
  };
}

export function ConversationHeader(props: ConversationHeaderProps) {
  return (
    <header class="window-drag conversation-header">
      <div class="conversation-heading-group">
        <Show when={props.agent}>
          {(agent) => (
            <Button
              variant="ghost"
              size="sm"
              type="button"
              class="conversation-title no-drag"
              aria-label="View agent settings"
              onPointerEnter={props.onSettingsIntent}
              onFocus={props.onSettingsIntent}
              onClick={props.onOpenSettings}
            >
              <AgentAvatar agent={agent()} />
              <h1>{agent().name}</h1>
            </Button>
          )}
        </Show>
      </div>
      <div class="conversation-header-actions no-drag">
        <Show when={props.agent}>
          <ProviderModelPicker {...props.modelPicker} />
        </Show>
        <Show when={props.remoteControl}>
          {(control) => (
            <Button
              variant="ghost"
              type="button"
              class="header-panel-toggle remote-desktop-button"
              aria-label={control().active ? "Resume remote control" : "Open remote control"}
              aria-expanded={control().visible ? "true" : "false"}
              disabled={!control().enabled}
              onClick={(event) => control().onOpen(event.currentTarget)}
            >
              <RemoteDesktopIcon />
              <Show when={control().active}>
                <span class="remote-desktop-button-dot" aria-hidden="true" />
              </Show>
            </Button>
          )}
        </Show>
        <Show when={props.browser}>
          <Button
            variant="ghost"
            type="button"
            class={[
              "header-panel-toggle computer-button",
              { "computer-button-agent-active": props.browser?.acting === true },
            ]}
            aria-label={
              props.browser?.acting
                ? `${props.browser?.agentName ?? "Agent"} is controlling the browser`
                : props.browser?.open
                  ? "Hide computer"
                  : "Open computer"
            }
            aria-expanded={props.browser?.open ? "true" : "false"}
            disabled={props.browser?.disabled}
            onClick={() => props.browser?.onToggle()}
          >
            <ComputerIcon />
            <Show when={props.browser?.acting}>
              <span class="computer-control-dot" aria-hidden="true" />
            </Show>
          </Button>
        </Show>
      </div>
    </header>
  );
}
