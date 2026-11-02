import type { BackgroundProcess } from "@openbot/contracts/ipc";
import {
  Button,
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
  Server,
  SettingsSection,
} from "@openbot/ui";
import { For, Show } from "solid-js";
import { useText } from "../../text";
import { AgentAvatar } from "../agents/AgentAvatar";
import type { AgentDefaultsAgent } from "./SettingsAgentsTab";

export interface BackgroundProcessesSectionProps {
  processes: readonly BackgroundProcess[];
  /** True when the processes could not be read. */
  loadFailed: boolean;
  /** The agents on this computer, to name the agent that started each process. */
  agents: readonly AgentDefaultsAgent[];
  /** The ids of the processes that are stopping now. */
  stopping: readonly string[];
  onStop: (id: string) => void;
}

/**
 * Settings › Agents › Background processes: the programs that agents left running on this computer,
 * such as a dev server, each with the agent, the start time, its ports and Stop.
 */
export function BackgroundProcessesSection(props: BackgroundProcessesSectionProps) {
  const { t, format } = useText();
  const agentOf = (process: BackgroundProcess) => props.agents.find((agent) => agent.id === process.agentId);
  const details = (process: BackgroundProcess) =>
    [
      agentOf(process)?.name ?? t("settings.backgroundProcesses.noAgent"),
      t("settings.backgroundProcesses.started", {
        time: format.date(process.startedAt, { dateStyle: "medium", timeStyle: "short" }),
      }),
      ...(process.ports.length > 0
        ? [
            t("settings.backgroundProcesses.ports", {
              count: process.ports.length,
              ports: format.list(process.ports.map(String)),
            }),
          ]
        : []),
    ].join(" · ");
  const message = (text: string) => (
    <Item class="settings-modal-row">
      <ItemContent>
        <ItemDescription>{text}</ItemDescription>
      </ItemContent>
    </Item>
  );

  return (
    <SettingsSection
      title={t("settings.backgroundProcesses.title")}
      description={t("settings.backgroundProcesses.description")}
    >
      <ItemGroup class="settings-modal-card" data-settings-row="settings.backgroundProcesses.title">
        <Show
          when={props.processes.length > 0}
          fallback={message(
            t(props.loadFailed ? "settings.backgroundProcesses.loadFailed" : "settings.backgroundProcesses.empty"),
          )}
        >
          <For each={props.processes}>
            {(process) => (
              <Item class="settings-modal-row">
                <ItemMedia>
                  <Show when={agentOf(process)} fallback={<Server aria-hidden="true" />}>
                    {(agent) => (
                      <span class="integrations-agent-face" data-size="md">
                        <AgentAvatar agent={agent()} motion="idle" />
                      </span>
                    )}
                  </Show>
                </ItemMedia>
                <ItemContent>
                  <ItemTitle title={process.command}>{process.command}</ItemTitle>
                  <ItemDescription>{details(process)}</ItemDescription>
                </ItemContent>
                <ItemActions>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={props.stopping.includes(process.id)}
                    aria-label={t("settings.backgroundProcesses.stopLabel", { pid: String(process.pid) })}
                    onClick={() => props.onStop(process.id)}
                  >
                    {t("settings.backgroundProcesses.stop")}
                  </Button>
                </ItemActions>
              </Item>
            )}
          </For>
        </Show>
      </ItemGroup>
    </SettingsSection>
  );
}
