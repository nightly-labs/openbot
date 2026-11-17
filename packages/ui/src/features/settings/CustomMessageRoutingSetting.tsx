import type {
  CustomMessageMode,
  CustomMessageRoutingSettings,
  SetCustomMessageRoutingInput,
} from "@openbot/contracts/ipc";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemGroup,
  ItemMedia,
  ItemTitle,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  SettingsSection,
} from "@openbot/ui";
import { For, Show } from "solid-js";
import { useText } from "../../text";
import { AgentAvatar } from "../agents/AgentAvatar";
import type { AgentDefaultsAgent } from "./SettingsAgentsTab";

export interface CustomMessageRoutingOptions {
  settings: CustomMessageRoutingSettings;
  saving: boolean;
  onChange(input: SetCustomMessageRoutingInput): void;
}

const MODES: CustomMessageMode[] = ["queue", "steer", "thread"];
type ModeChoice = CustomMessageMode | "default";
const AGENT_MODES: ModeChoice[] = ["default", ...MODES];

/** Optional local-host controls. Consumers that omit these props keep the released settings UI. */
export function CustomMessageRoutingSetting(props: {
  options: CustomMessageRoutingOptions;
  agents: readonly AgentDefaultsAgent[];
  menuMount: HTMLElement | undefined;
}) {
  const { t } = useText();
  const modeLabel = (mode: CustomMessageMode) =>
    t(
      mode === "queue"
        ? "agentSettings.busyMessage.queue"
        : mode === "steer"
          ? "agentSettings.busyMessage.steer"
          : "agentSettings.busyMessage.thread",
    );
  const choiceLabel = (mode: ModeChoice) =>
    mode === "default"
      ? t("settings.agentDefaults.followDefault", { value: modeLabel(props.options.settings.defaultMode) })
      : modeLabel(mode);
  const agentChoice = (id: string): ModeChoice => props.options.settings.agents[id] ?? "default";

  return (
    <>
      <SettingsSection
        title={t("settings.agentDefaults.defaultTitle")}
        description={t("settings.customMessageRouting.description")}
      >
        <ItemGroup class="settings-modal-card">
          <Item class="settings-modal-row">
            <ItemContent>
              <ItemTitle>{t("settings.customMessageRouting.title")}</ItemTitle>
            </ItemContent>
            <ItemActions>
              <Select<CustomMessageMode>
                options={MODES}
                value={props.options.settings.defaultMode}
                disabled={props.options.saving}
                onChange={(mode) => {
                  if (mode && mode !== props.options.settings.defaultMode) props.options.onChange({ mode });
                }}
                itemComponent={(item) => <SelectItem item={item.item}>{modeLabel(item.item.rawValue)}</SelectItem>}
              >
                <SelectTrigger size="sm" aria-label={t("settings.customMessageRouting.title")}>
                  <SelectValue<CustomMessageMode>>
                    {(state) => modeLabel(state.selectedOption() ?? props.options.settings.defaultMode)}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent mount={props.menuMount} />
              </Select>
            </ItemActions>
          </Item>
        </ItemGroup>
      </SettingsSection>
      <Show when={props.agents.length > 0}>
        <SettingsSection title={t("settings.agentDefaults.agents")}>
          <ItemGroup class="settings-modal-card">
            <For each={props.agents}>
              {(agent) => (
                <Item class="settings-modal-row">
                  <ItemMedia>
                    <AgentAvatar agent={agent} motion="idle" />
                  </ItemMedia>
                  <ItemContent>
                    <ItemTitle>{agent.name}</ItemTitle>
                  </ItemContent>
                  <ItemActions>
                    <Select<ModeChoice>
                      options={AGENT_MODES}
                      value={agentChoice(agent.id)}
                      disabled={props.options.saving}
                      placement="bottom-end"
                      onChange={(mode) => {
                        if (mode && mode !== agentChoice(agent.id))
                          props.options.onChange({ mode: mode === "default" ? null : mode, agentIds: [agent.id] });
                      }}
                      itemComponent={(item) => (
                        <SelectItem item={item.item}>{choiceLabel(item.item.rawValue)}</SelectItem>
                      )}
                    >
                      <SelectTrigger
                        size="sm"
                        class="server-roles-level"
                        aria-label={t("settings.agentDefaults.agentLabel", {
                          setting: t("settings.customMessageRouting.title"),
                          agent: agent.name,
                        })}
                      >
                        <SelectValue<ModeChoice>>
                          {(state) => choiceLabel(state.selectedOption() ?? "default")}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent mount={props.menuMount} />
                    </Select>
                  </ItemActions>
                </Item>
              )}
            </For>
          </ItemGroup>
        </SettingsSection>
      </Show>
    </>
  );
}
