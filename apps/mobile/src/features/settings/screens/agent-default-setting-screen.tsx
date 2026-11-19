import type { AgentDefaultChoice, AgentDefaultSetting, AgentDefaultsOverview } from "@openbot/contracts/ipc";
import { Stack, useLocalSearchParams } from "expo-router";
import { Typography } from "heroui-native";
import { useUniwind } from "uniwind";
import {
  AgentDefaultsAvatar,
  AgentDefaultsError,
  AgentDefaultsStatus,
  agentDefaultChoiceLabel,
} from "@/features/settings/components/agent-defaults-parts";
import { SettingsContent, SettingsRow, SettingsSection } from "@/features/settings/components/settings-content";
import { SettingsPicker, SettingsSwitch } from "@/features/settings/components/settings-controls";
import {
  AGENT_DEFAULT_CHOICE_ORDER,
  type AgentDefaultsRow,
  agentDefaultChoice,
  agentDefaultInput,
  agentDefaultOn,
  agentDefaultSettingInfo,
  useAgentDefaults,
} from "@/features/settings/model/agent-defaults";
import { CoveringMenuView } from "@/shared/components/covering-menu-view";
import type { MenuAction } from "@/shared/components/menu-view";
import { type MobileText, useText } from "@/shared/lib/text";

const PLAN_START_PRESETS: readonly number[] = [10_000, 30_000, 60_000, 300_000];
const LIMIT_PRESETS: readonly number[] = [30, 60, 120, 300, 1_000];

type PlanStartChoice = "wait" | `${number}`;

function planStartChoice(ms: number | null): PlanStartChoice {
  return ms === null ? "wait" : `${ms}`;
}

function planStartChoices(ms: number | null): PlanStartChoice[] {
  const custom = ms !== null && !PLAN_START_PRESETS.includes(ms) ? [ms] : [];
  return ["wait", ...[...PLAN_START_PRESETS, ...custom].map((value) => `${value}` as const)];
}

function limitChoices(limit: number): number[] {
  return LIMIT_PRESETS.includes(limit) ? [...LIMIT_PRESETS] : [...LIMIT_PRESETS, limit].sort((a, b) => a - b);
}

function delayText({ t, format }: MobileText, ms: number): string {
  const total = Math.round(ms / 1_000);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  if (minutes === 0) return t("mobile.settings.agents.planStart.seconds", { seconds: format.number(seconds) });
  if (seconds === 0) return t("mobile.settings.agents.planStart.minutes", { minutes: format.number(minutes) });
  return t("mobile.settings.agents.planStart.minutesSeconds", {
    minutes: format.number(minutes),
    seconds: format.number(seconds),
  });
}

function commonChoice(
  agents: readonly AgentDefaultsRow[],
  setting: AgentDefaultSetting,
): AgentDefaultChoice | undefined {
  const [first, ...rest] = agents.map((row) => agentDefaultChoice(row.values, setting));
  return first !== undefined && rest.every((choice) => choice === first) ? first : undefined;
}

export function AgentDefaultSettingScreen() {
  const text = useText();
  const { t, format } = text;
  const { theme } = useUniwind();
  const dark = theme === "dark";
  const { serverId, setting } = useLocalSearchParams<{ serverId: string; setting: string }>();
  const state = useAgentDefaults(serverId);
  const info = agentDefaultSettingInfo(setting);
  if (!info) return null;
  const { overview, agents, enabled } = state;
  const { key } = info;
  const title = t(info.title);
  const choiceLabel = (current: AgentDefaultsOverview, choice: AgentDefaultChoice) =>
    agentDefaultChoiceLabel(t, current, key, choice);

  const setAll = (current: AgentDefaultsOverview) => {
    const common = commonChoice(agents, key);
    const label = t("mobile.settings.agents.setAllLabel", { setting: title });
    const row = (
      <SettingsRow disabled={!enabled} value={common ? choiceLabel(current, common) : undefined}>
        <Typography.Paragraph className="text-accent">{t("mobile.settings.agents.setAll")}</Typography.Paragraph>
      </SettingsRow>
    );
    if (!enabled) return row;
    return (
      <CoveringMenuView
        accessibilityLabel={label}
        title={label}
        actions={AGENT_DEFAULT_CHOICE_ORDER.map<MenuAction>((choice) => ({
          id: choice,
          title: choiceLabel(current, choice),
          state: common === choice ? "on" : "off",
        }))}
        onPressAction={({ nativeEvent }) => {
          const choice = AGENT_DEFAULT_CHOICE_ORDER.find((candidate) => candidate === nativeEvent.event);
          if (!choice) return;
          const changed = agents
            .filter((row) => agentDefaultChoice(row.values, key) !== choice)
            .map((row) => row.agent.id);
          if (changed.length > 0) void state.setChoice(changed, key, choice);
        }}
      >
        {row}
      </CoveringMenuView>
    );
  };

  const planStart = (current: AgentDefaultsOverview) => {
    const ms = current.defaults.planStartAfterMs;
    const selected = planStartChoice(ms);
    return (
      <SettingsSection
        footer={
          ms === null
            ? t("mobile.settings.agents.planStart.waitNote")
            : t("mobile.settings.agents.planStart.afterNote", { time: delayText(text, ms) })
        }
      >
        <SettingsRow
          trailing={
            <SettingsPicker<PlanStartChoice>
              value={selected}
              options={planStartChoices(ms).map((choice) => ({
                value: choice,
                label:
                  choice === "wait"
                    ? t("mobile.settings.agents.planStart.wait")
                    : t("mobile.settings.agents.planStart.after", { time: delayText(text, Number(choice)) }),
              }))}
              enabled={enabled}
              dark={dark}
              label={t("mobile.settings.agents.planStart.title")}
              onChange={(next) => {
                if (next !== selected)
                  void state.updateDefaults({ planStartAfterMs: next === "wait" ? null : Number(next) });
              }}
            />
          }
        >
          <Typography.Paragraph>{t("mobile.settings.agents.planStart.title")}</Typography.Paragraph>
        </SettingsRow>
      </SettingsSection>
    );
  };

  const limit = (current: AgentDefaultsOverview) => {
    const value = current.defaults.automationRunsPerHour;
    return (
      <SettingsSection
        title={t("mobile.settings.agents.limit.section")}
        footer={t("mobile.settings.agents.limit.footer")}
      >
        <SettingsRow
          trailing={
            <SettingsPicker<number>
              value={value}
              options={limitChoices(value).map((choice) => ({
                value: choice,
                label: t("mobile.settings.agents.limit.option", { limit: format.number(choice) }),
              }))}
              enabled={enabled}
              dark={dark}
              label={t("mobile.settings.agents.limit.title")}
              onChange={(next) => {
                if (next !== value) void state.updateDefaults({ automationRunsPerHour: next });
              }}
            />
          }
        >
          <Typography.Paragraph>{t("mobile.settings.agents.limit.title")}</Typography.Paragraph>
        </SettingsRow>
      </SettingsSection>
    );
  };

  return (
    <SettingsContent>
      <Stack.Screen options={{ title }} />
      <AgentDefaultsStatus state={state} />
      <AgentDefaultsError error={state.error} />
      {overview ? (
        <>
          <SettingsSection title={t("mobile.settings.agents.default")} footer={t(info.description)}>
            <SettingsRow>
              <SettingsSwitch
                value={agentDefaultOn(overview, key)}
                disabled={!enabled}
                label={title}
                dark={dark}
                onValueChange={(on) => void state.updateDefaults(agentDefaultInput(key, on))}
              />
            </SettingsRow>
          </SettingsSection>
          {key === "quickAcknowledgement" ? planStart(overview) : null}
          {agents.length > 0 ? (
            <SettingsSection
              title={t("mobile.settings.agents.agentsSection")}
              footer={t("mobile.settings.agents.agentsFooter")}
            >
              {setAll(overview)}
              {agents.map(({ agent, values }) => {
                const choice = agentDefaultChoice(values, key);
                return (
                  <SettingsRow
                    key={agent.id}
                    leading={<AgentDefaultsAvatar agent={agent} />}
                    trailing={
                      <SettingsPicker<AgentDefaultChoice>
                        value={choice}
                        options={AGENT_DEFAULT_CHOICE_ORDER.map((option) => ({
                          value: option,
                          label: choiceLabel(overview, option),
                        }))}
                        enabled={enabled}
                        dark={dark}
                        label={t("mobile.settings.agents.agentLabel", { setting: title, agent: agent.name })}
                        onChange={(next) => {
                          if (next !== choice) void state.setChoice([agent.id], key, next);
                        }}
                      />
                    }
                  >
                    <Typography.Paragraph numberOfLines={1}>{agent.name}</Typography.Paragraph>
                  </SettingsRow>
                );
              })}
            </SettingsSection>
          ) : null}
          {key === "allowAutomation" ? limit(overview) : null}
        </>
      ) : null}
    </SettingsContent>
  );
}
