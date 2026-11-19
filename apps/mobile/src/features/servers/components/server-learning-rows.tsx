import { isSkillLearningMode, RESPONSE_STYLES, type ResponseStyle } from "@openbot/contracts/ipc";
import { type QueryKey, useQuery, useQueryClient } from "@tanstack/react-query";
import { Typography } from "heroui-native";
import BookOpen from "lucide-react-native/icons/book-open";
import Brain from "lucide-react-native/icons/brain";
import BrainCog from "lucide-react-native/icons/brain-cog";
import Smile from "lucide-react-native/icons/face-slightly-smiling";
import MousePointerClick from "lucide-react-native/icons/mouse-pointer-click";
import { useState } from "react";
import { useUniwind } from "uniwind";
import { useQueryScope } from "@/features/auth/context/mobile-session-context";
import { RESPONSE_STYLE_LABEL_KEYS, useServerPersonality } from "@/features/servers/model/use-server-personality";
import { SettingsRow, SettingsSection } from "@/features/settings/components/settings-content";
import { SettingsPicker, SettingsSwitch } from "@/features/settings/components/settings-controls";
import { RowIcon } from "@/features/settings/components/settings-row-icon";
import { useMobileWorkspaceActions } from "@/features/workspace/context/mobile-workspace-context";
import { queryKeys } from "@/features/workspace/model/query-keys";
import { haptics } from "@/shared/lib/haptics";
import { type MobileText, useText } from "@/shared/lib/text";

/**
 * Reads one host setting and saves a change. Each setting is a group of one row; the load or save
 * error shows in place of its description under the group, as the desktop does.
 */
function useHostSetting<T>(key: QueryKey, load: () => Promise<T>, loadFailed: string, saveFailed: string) {
  const { errorMessage } = useText();
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: key, retry: false, staleTime: 0, gcTime: 0, queryFn: load });
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  function save(operation: () => Promise<T>) {
    if (saving) return;
    void haptics.selection();
    setSaving(true);
    setSaveError(null);
    operation()
      .then(async (saved) => {
        await queryClient.cancelQueries({ queryKey: key, exact: true });
        queryClient.setQueryData(key, saved);
        void haptics.notification("success");
      })
      .catch((cause: unknown) => {
        void haptics.notification("error");
        setSaveError(errorMessage(cause, saveFailed));
      })
      .finally(() => setSaving(false));
  }

  const error = saveError ?? (query.isError ? errorMessage(query.error, loadFailed) : null);
  return { value: query.data, saving, error, save };
}

/**
 * How the agents of the server talk while they work (`host-personality-v1`). Natural agents send short
 * updates and the chat shows them; Classic agents answer once. The change applies from the next turn
 * of each agent.
 */
export function ServerPersonalityRow({ serverId }: { serverId: string }) {
  const { t, errorMessage } = useText();
  const { theme } = useUniwind();
  const { query, save } = useServerPersonality(serverId);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const current = query.data?.responseStyle;

  function choose(style: ResponseStyle) {
    if (saving || style === current) return;
    void haptics.selection();
    setSaving(true);
    setSaveError(null);
    save({ responseStyle: style })
      .then(() => void haptics.notification("success"))
      .catch((cause: unknown) => {
        void haptics.notification("error");
        setSaveError(errorMessage(cause, t("mobile.server.settings.personalitySaveFailed")));
      })
      .finally(() => setSaving(false));
  }

  const error =
    saveError ?? (query.isError ? errorMessage(query.error, t("mobile.server.settings.personalityLoadFailed")) : null);
  return (
    <SettingsSection footer={error ?? t("mobile.server.settings.responseStyleDescription")}>
      <SettingsRow
        leading={<RowIcon icon={Smile} />}
        disclosure={false}
        trailing={
          current ? (
            <SettingsPicker
              value={current}
              options={RESPONSE_STYLES.map((style) => ({ value: style, label: t(RESPONSE_STYLE_LABEL_KEYS[style]) }))}
              enabled={!saving}
              dark={theme === "dark"}
              label={t("mobile.server.route.personality")}
              onChange={choose}
            />
          ) : null
        }
      >
        <Typography.Paragraph>{t("mobile.server.route.personality")}</Typography.Paragraph>
      </SettingsRow>
    </SettingsSection>
  );
}

/** A host that no longer permits its saved value still shows it. */
function withSaved<T>(saved: T, choices: readonly T[]): readonly T[] {
  return choices.includes(saved) ? choices : [saved, ...choices];
}

/** How many memories each agent of the server can keep (`agent-memory-limit-v1`). The values come from the host. */
export function ServerMemoryLimitRow({ serverId }: { serverId: string }) {
  const { t } = useText();
  const { theme } = useUniwind();
  const { loadAgentMemoryLimit, setAgentMemoryLimit } = useMobileWorkspaceActions();
  const setting = useHostSetting(
    queryKeys.agentMemoryLimit(useQueryScope(), serverId),
    () => loadAgentMemoryLimit(serverId),
    t("mobile.server.settings.memoryLimitLoadFailed"),
    t("mobile.server.settings.memoryLimitSaveFailed"),
  );
  const current = setting.value;
  return (
    <SettingsSection footer={setting.error ?? t("mobile.server.settings.memoryLimitDescription")}>
      <SettingsRow
        leading={<RowIcon icon={Brain} />}
        disclosure={false}
        trailing={
          current ? (
            <SettingsPicker
              value={current.limit}
              options={withSaved(current.limit, current.choices).map((choice) => ({
                value: choice,
                label: String(choice),
              }))}
              enabled={!setting.saving}
              dark={theme === "dark"}
              label={t("mobile.server.settings.memoryLimit")}
              onChange={(limit) => {
                if (limit !== current.limit) setting.save(() => setAgentMemoryLimit(limit, serverId));
              }}
            />
          ) : null
        }
      >
        <Typography.Paragraph>{t("mobile.server.settings.memoryLimit")}</Typography.Paragraph>
      </SettingsRow>
    </SettingsSection>
  );
}

/**
 * How many completed turns of one conversation pass between two background memory reviews of the
 * server's agents, or Off (`memory-review-v1`). The values come from the host.
 */
export function ServerMemoryReviewRow({ serverId }: { serverId: string }) {
  const { t } = useText();
  const { theme } = useUniwind();
  const { loadMemoryReview, setMemoryReview } = useMobileWorkspaceActions();
  const setting = useHostSetting(
    queryKeys.memoryReview(useQueryScope(), serverId),
    () => loadMemoryReview(serverId),
    t("mobile.server.settings.memoryReviewLoadFailed"),
    t("mobile.server.settings.learningSaveFailed"),
  );
  const current = setting.value;
  const label = (interval: number) =>
    interval === 0
      ? t("mobile.server.settings.memoryReviewOff")
      : t("mobile.server.settings.memoryReviewTurns", { count: interval });
  return (
    <SettingsSection footer={setting.error ?? t("mobile.server.settings.memoryReviewDescription")}>
      <SettingsRow
        leading={<RowIcon icon={BrainCog} />}
        disclosure={false}
        trailing={
          current ? (
            <SettingsPicker
              value={current.interval}
              options={withSaved(current.interval, current.choices).map((choice) => ({
                value: choice,
                label: label(choice),
              }))}
              enabled={!setting.saving}
              dark={theme === "dark"}
              label={t("mobile.server.settings.memoryReview")}
              onChange={(interval) => {
                if (interval !== current.interval) setting.save(() => setMemoryReview(interval, serverId));
              }}
            />
          ) : null
        }
      >
        <Typography.Paragraph>{t("mobile.server.settings.memoryReview")}</Typography.Paragraph>
      </SettingsRow>
    </SettingsSection>
  );
}

/** A newer host can send a mode that this app does not know; the row shows the raw value. */
function skillLearningLabel(mode: string, t: MobileText["t"]): string {
  if (!isSkillLearningMode(mode)) return mode;
  if (mode === "automatic") return t("mobile.server.settings.skillLearningAutomatic");
  if (mode === "ask") return t("mobile.server.settings.skillLearningAsk");
  return t("mobile.server.settings.skillLearningOff");
}

/**
 * What the background memory reviews of the server's agents do when a chat teaches a skill
 * (`skill-learning-v1`). The values come from the host.
 */
export function ServerSkillLearningRow({ serverId }: { serverId: string }) {
  const { t } = useText();
  const { theme } = useUniwind();
  const { loadSkillLearning, setSkillLearning } = useMobileWorkspaceActions();
  const setting = useHostSetting(
    queryKeys.skillLearning(useQueryScope(), serverId),
    () => loadSkillLearning(serverId),
    t("mobile.server.settings.skillLearningLoadFailed"),
    t("mobile.server.settings.learningSaveFailed"),
  );
  const current = setting.value;
  return (
    <SettingsSection footer={setting.error ?? t("mobile.server.settings.skillLearningDescription")}>
      <SettingsRow
        leading={<RowIcon icon={BookOpen} />}
        disclosure={false}
        trailing={
          current ? (
            <SettingsPicker
              value={current.mode}
              options={withSaved(current.mode, current.choices).map((choice) => ({
                value: choice,
                label: skillLearningLabel(choice, t),
              }))}
              enabled={!setting.saving}
              dark={theme === "dark"}
              label={t("mobile.server.settings.skillLearning")}
              onChange={(mode) => {
                if (mode !== current.mode) setting.save(() => setSkillLearning(mode, serverId));
              }}
            />
          ) : null
        }
      >
        <Typography.Paragraph>{t("mobile.server.settings.skillLearning")}</Typography.Paragraph>
      </SettingsRow>
    </SettingsSection>
  );
}

/**
 * "Learn from my browsing" (`browsing-memory-v1`): while a person holds an agent's tab, the host
 * records the pages and the controls they use, and the memory review learns how those sites work.
 * Off deletes what the host recorded.
 */
export function ServerBrowsingMemoryRow({ serverId }: { serverId: string }) {
  const { t } = useText();
  const { theme } = useUniwind();
  const { loadBrowsingMemory, setBrowsingMemory } = useMobileWorkspaceActions();
  const setting = useHostSetting(
    queryKeys.browsingMemory(useQueryScope(), serverId),
    () => loadBrowsingMemory(serverId),
    t("mobile.server.settings.browsingMemoryLoadFailed"),
    t("mobile.server.settings.learningSaveFailed"),
  );
  const current = setting.value;
  return (
    <SettingsSection footer={setting.error ?? t("mobile.server.settings.browsingMemoryDescription")}>
      <SettingsRow leading={<RowIcon icon={MousePointerClick} />}>
        <SettingsSwitch
          value={current?.enabled ?? false}
          disabled={!current || setting.saving}
          label={t("mobile.server.settings.browsingMemory")}
          dark={theme === "dark"}
          onValueChange={(enabled) => {
            if (current && enabled !== current.enabled) setting.save(() => setBrowsingMemory(enabled, serverId));
          }}
        />
      </SettingsRow>
    </SettingsSection>
  );
}
