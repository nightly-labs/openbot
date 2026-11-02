import type { AgentDefaultKey, AgentDefaults, ClientAgentSummary } from "@openbot/contracts/ipc";
import type { AppTextKey } from "@openbot/i18n";
import {
  Alert,
  AlertContent,
  AlertDescription,
  Button,
  buttonVariants,
  Check,
  ChevronDown,
  ChevronRight,
  DropdownMenu,
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  SettingsSection,
  SwitchField,
  Text,
} from "@openbot/ui";
import { For, Show } from "solid-js";
import { useText } from "../../text";
import { AgentAvatar } from "../agents/AgentAvatar";

/** A setting of the Agents tab: the three account defaults, and "Steer agents while they work". */
export type AgentDefaultSetting = AgentDefaultKey | "busyMessageMode";

/** What one agent does for a setting: follow the default, or its own value. */
export type AgentDefaultChoice = "default" | "on" | "off";

const CHOICES: AgentDefaultChoice[] = ["default", "on", "off"];

/** An agent as the Agents tab shows it. */
export type AgentDefaultsAgent = Pick<
  ClientAgentSummary,
  "id" | "name" | "avatarSeed" | "avatarHue" | "avatarUrl" | AgentDefaultKey | "busyMessageMode"
>;

/** The settings in page order, with the title and description that agent settings show. */
export const AGENT_DEFAULT_SETTINGS = [
  {
    key: "allowAutomation",
    title: "agentSettings.automation.title",
    description: "agentSettings.automation.description",
  },
  {
    key: "allowNewChat",
    title: "agentSettings.agentNewChat.title",
    description: "agentSettings.agentNewChat.description",
  },
  {
    key: "quickAcknowledgement",
    title: "agentSettings.quickAcknowledgement.title",
    description: "agentSettings.quickAcknowledgement.description",
  },
  { key: "busyMessageMode", title: "settings.busyMessage.title", description: "settings.busyMessage.description" },
] as const satisfies ReadonlyArray<{ key: AgentDefaultSetting; title: AppTextKey; description: AppTextKey }>;

export function agentDefaultSettingTitle(setting: AgentDefaultSetting): AppTextKey {
  return AGENT_DEFAULT_SETTINGS.find((item) => item.key === setting)?.title ?? "settings.tab.agents.title";
}

/** The value that the agent stores, or "default" when it has none and follows the default. */
export function agentDefaultChoice(agent: AgentDefaultsAgent, setting: AgentDefaultSetting): AgentDefaultChoice {
  if (setting === "busyMessageMode") {
    if (agent.busyMessageMode === undefined) return "default";
    return agent.busyMessageMode === "steer" ? "on" : "off";
  }
  const own = agent[setting];
  if (own === undefined) return "default";
  return own ? "on" : "off";
}

const FACES = 4;

function AgentFaces(props: { agents: AgentDefaultsAgent[] }) {
  const { t } = useText();
  return (
    <Show when={props.agents.length > 0}>
      <span
        class="integrations-face-stack"
        role="img"
        aria-label={t("settings.agentDefaults.agentList", {
          names: props.agents.map((agent) => agent.name).join(", "),
        })}
      >
        <For each={props.agents.slice(0, FACES)}>
          {(agent) => (
            <span class="integrations-agent-face" data-size="sm">
              <AgentAvatar agent={agent} motion="idle" />
            </span>
          )}
        </For>
        <Show when={props.agents.length > FACES}>
          <span class="integrations-face-more" aria-hidden="true">{`+${props.agents.length - FACES}`}</span>
        </Show>
      </span>
    </Show>
  );
}

function MenuMark(props: { on: boolean }) {
  return (
    <span class="ui-menu-check" data-checked={props.on ? "" : undefined}>
      <Show when={props.on}>
        <Check aria-hidden="true" />
      </Show>
    </span>
  );
}

export interface SettingsAgentsTabProps {
  /** The agents on this computer. */
  agents: readonly AgentDefaultsAgent[];
  /** True when the agents could not be read. */
  loadFailed: boolean;
  defaults: AgentDefaults;
  /** The app default of "Steer agents while they work". */
  steer: boolean;
  /** The open setting, or null for the list of settings. */
  setting: AgentDefaultSetting | null;
  /** The dialog element that the menus portal into. */
  menuMount: HTMLElement | undefined;
  onOpen: (setting: AgentDefaultSetting) => void;
  onDefaultChange: (setting: AgentDefaultSetting, on: boolean) => void;
  /** Gives `choice` to each agent of `agentIds`. */
  onChoiceChange: (agentIds: readonly string[], setting: AgentDefaultSetting, choice: AgentDefaultChoice) => void;
}

/**
 * Settings › Agents, in the design of Server settings › Roles. The list has one row for each
 * setting, with the agents that have it on. A setting page has its default, and each agent with a
 * menu and Set all. An agent with no value of its own follows the default.
 */
export function SettingsAgentsTab(props: SettingsAgentsTabProps) {
  const { t } = useText();
  const defaultOn = (setting: AgentDefaultSetting) =>
    setting === "busyMessageMode" ? props.steer : props.defaults[setting];
  const isOn = (agent: AgentDefaultsAgent, setting: AgentDefaultSetting) => {
    const choice = agentDefaultChoice(agent, setting);
    return choice === "default" ? defaultOn(setting) : choice === "on";
  };
  const valueLabel = (setting: AgentDefaultSetting, on: boolean) => {
    if (setting === "busyMessageMode")
      return t(on ? "agentSettings.busyMessage.steer" : "agentSettings.busyMessage.queue");
    return t(on ? "settings.agentDefaults.on" : "settings.agentDefaults.off");
  };
  const choiceLabel = (setting: AgentDefaultSetting, choice: AgentDefaultChoice) => {
    if (choice !== "default") return valueLabel(setting, choice === "on");
    if (setting === "busyMessageMode")
      return t(props.steer ? "agentSettings.busyMessage.appDefaultSteer" : "agentSettings.busyMessage.appDefaultQueue");
    return t("settings.agentDefaults.followDefault", { value: valueLabel(setting, defaultOn(setting)) });
  };

  const loadError = () => (
    <Show when={props.loadFailed}>
      <Alert tone="danger" role="alert" report={{ operation: "settings", source: "system", cause_code: "unknown" }}>
        <AlertContent>
          <AlertDescription>{t("settings.agentDefaults.loadFailed")}</AlertDescription>
        </AlertContent>
      </Alert>
    </Show>
  );

  const list = () => (
    <SettingsSection title={t("settings.agentDefaults.title")} description={t("settings.agentDefaults.description")}>
      <ItemGroup class="settings-modal-card">
        <For each={AGENT_DEFAULT_SETTINGS}>
          {(setting) => {
            const on = () => props.agents.filter((agent) => isOn(agent, setting.key));
            return (
              <Item data-settings-row={setting.title} class="settings-modal-row integrations-hub-row">
                <Button
                  type="button"
                  variant="ghost"
                  class="integrations-hub-hitarea"
                  aria-label={t("settings.agentDefaults.open", { name: t(setting.title) })}
                  onClick={() => props.onOpen(setting.key)}
                />
                <ItemContent>
                  <ItemTitle>{t(setting.title)}</ItemTitle>
                  <ItemDescription>
                    {t("settings.agentDefaults.value", { value: valueLabel(setting.key, defaultOn(setting.key)) })}
                  </ItemDescription>
                </ItemContent>
                <ItemActions class="integrations-hub-actions">
                  <AgentFaces agents={on()} />
                  <Show when={props.agents.length > 0}>
                    <Text variant="label-sm" tone="muted" class="server-roles-member-count">
                      {t("settings.agentDefaults.count", {
                        on: String(on().length),
                        total: String(props.agents.length),
                      })}
                    </Text>
                  </Show>
                  <ChevronRight class="integrations-hub-chevron" aria-hidden="true" />
                </ItemActions>
              </Item>
            );
          }}
        </For>
      </ItemGroup>
    </SettingsSection>
  );

  const settingPage = (setting: AgentDefaultSetting) => {
    const title = () => t(agentDefaultSettingTitle(setting));
    const description = () =>
      t(AGENT_DEFAULT_SETTINGS.find((item) => item.key === setting)?.description ?? "settings.tab.agents.description");
    const common = () => {
      const choices = props.agents.map((agent) => agentDefaultChoice(agent, setting));
      const [first] = choices;
      return first !== undefined && choices.every((choice) => choice === first) ? first : undefined;
    };
    const setAllLabel = () => t("settings.agentDefaults.setAllLabel", { setting: title() });
    return (
      <>
        <SettingsSection
          title={t("settings.agentDefaults.defaultTitle")}
          description={t("settings.agentDefaults.defaultDescription")}
        >
          <ItemGroup class="settings-modal-card">
            <SwitchField
              checked={defaultOn(setting)}
              onChange={(next) => props.onDefaultChange(setting, next)}
              label={title()}
              description={description()}
            />
          </ItemGroup>
        </SettingsSection>
        <Show when={props.agents.length > 0}>
          <SettingsSection
            title={t("settings.agentDefaults.agents")}
            actions={
              <DropdownMenu.Root placement="bottom-end" gutter={4} modal={false}>
                <DropdownMenu.Trigger
                  class={`${buttonVariants({ variant: "ghost", size: "sm" })} server-roles-member-trigger`}
                  aria-label={setAllLabel()}
                >
                  <span class="server-roles-member-summary">{t("settings.agentDefaults.setAll")}</span>
                  <ChevronDown aria-hidden="true" />
                </DropdownMenu.Trigger>
                {/* A portal without a mount uses the document body. */}
                <DropdownMenu.Portal mount={props.menuMount ?? document.body}>
                  <DropdownMenu.Content>
                    {/* With mixed values no item is checked, so each choice is a change. */}
                    <DropdownMenu.RadioGroup
                      aria-label={setAllLabel()}
                      value={common() ?? ""}
                      onChange={(value: string) => {
                        const choice = CHOICES.find((item) => item === value);
                        if (!choice) return;
                        const changed = props.agents
                          .filter((agent) => agentDefaultChoice(agent, setting) !== choice)
                          .map((agent) => agent.id);
                        if (changed.length > 0) props.onChoiceChange(changed, setting, choice);
                      }}
                    >
                      <For each={CHOICES}>
                        {(choice) => (
                          <DropdownMenu.RadioItem value={choice} closeOnSelect>
                            <MenuMark on={common() === choice} />
                            {choiceLabel(setting, choice)}
                          </DropdownMenu.RadioItem>
                        )}
                      </For>
                    </DropdownMenu.RadioGroup>
                  </DropdownMenu.Content>
                </DropdownMenu.Portal>
              </DropdownMenu.Root>
            }
          >
            <ItemGroup class="settings-modal-card">
              <For each={props.agents}>
                {(agent) => (
                  <Item class="settings-modal-row">
                    <ItemMedia>
                      <span class="integrations-agent-face" data-size="md">
                        <AgentAvatar agent={agent} motion="idle" />
                      </span>
                    </ItemMedia>
                    <ItemContent>
                      <ItemTitle>{agent.name}</ItemTitle>
                    </ItemContent>
                    <ItemActions>
                      <Select<AgentDefaultChoice>
                        options={CHOICES}
                        value={agentDefaultChoice(agent, setting)}
                        placement="bottom-end"
                        onChange={(choice) => {
                          if (choice && choice !== agentDefaultChoice(agent, setting))
                            props.onChoiceChange([agent.id], setting, choice);
                        }}
                        itemComponent={(item) => (
                          <SelectItem item={item.item}>{choiceLabel(setting, item.item.rawValue)}</SelectItem>
                        )}
                      >
                        <SelectTrigger
                          size="sm"
                          class="server-roles-level"
                          aria-label={t("settings.agentDefaults.agentLabel", { setting: title(), agent: agent.name })}
                        >
                          <SelectValue<AgentDefaultChoice>>
                            {(state) => choiceLabel(setting, state.selectedOption())}
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
  };

  return (
    <>
      {loadError()}
      <Show when={props.setting} fallback={list()} keyed>
        {(setting) => settingPage(setting)}
      </Show>
    </>
  );
}
