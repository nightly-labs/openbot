import {
  isMediaApprovalCredits,
  isSkillLearningMode,
  RESPONSE_STYLES,
  type ResponseStyle,
} from "@openbot/contracts/ipc";
import { type QueryKey, useQuery, useQueryClient } from "@tanstack/react-query";
import { Input, Typography } from "heroui-native";
import BellRing from "lucide-react-native/icons/bell-ring";
import BookOpen from "lucide-react-native/icons/book-open";
import Bot from "lucide-react-native/icons/bot";
import Brain from "lucide-react-native/icons/brain";
import BrainCog from "lucide-react-native/icons/brain-cog";
import Coins from "lucide-react-native/icons/coins";
import Smile from "lucide-react-native/icons/face-slightly-smiling";
import Globe from "lucide-react-native/icons/globe";
import MousePointerClick from "lucide-react-native/icons/mouse-pointer-click";
import { useState } from "react";
import { View } from "react-native";
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

function useHostSetting<T>(key: QueryKey, load: () => Promise<T>, loadFailed: string, saveFailed: string) {
  const { errorMessage } = useText();
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: key, retry: false, staleTime: 0, gcTime: 0, queryFn: load });
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  function save(operation: () => Promise<T>, failed = saveFailed) {
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
        setSaveError(errorMessage(cause, failed));
      })
      .finally(() => setSaving(false));
  }

  const error = saveError ?? (query.isError ? errorMessage(query.error, loadFailed) : null);
  return { value: query.data, saving, error, save };
}

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

function withSaved<T>(saved: T, choices: readonly T[]): readonly T[] {
  return choices.includes(saved) ? choices : [saved, ...choices];
}

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

function skillLearningLabel(mode: string, t: MobileText["t"]): string {
  if (!isSkillLearningMode(mode)) return mode;
  if (mode === "automatic") return t("mobile.server.settings.skillLearningAutomatic");
  if (mode === "ask") return t("mobile.server.settings.skillLearningAsk");
  return t("mobile.server.settings.skillLearningOff");
}

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

export function ServerRemoteChatContentRow({ serverId }: { serverId: string }) {
  const { t } = useText();
  const { theme } = useUniwind();
  const { loadRemoteChatContent, setRemoteChatContent } = useMobileWorkspaceActions();
  const setting = useHostSetting(
    queryKeys.remoteChatContent(useQueryScope(), serverId),
    () => loadRemoteChatContent(serverId),
    t("mobile.server.settings.remoteChatContentLoadFailed"),
    t("mobile.server.settings.learningSaveFailed"),
  );
  const current = setting.value;
  return (
    <SettingsSection footer={setting.error ?? t("mobile.server.settings.remoteChatContentDescription")}>
      <SettingsRow leading={<RowIcon icon={Globe} />}>
        <SettingsSwitch
          value={current?.enabled ?? false}
          disabled={!current || setting.saving}
          label={t("mobile.server.settings.remoteChatContent")}
          dark={theme === "dark"}
          onValueChange={(enabled) => {
            if (current && enabled !== current.enabled) setting.save(() => setRemoteChatContent(enabled, serverId));
          }}
        />
      </SettingsRow>
    </SettingsSection>
  );
}

function creditsOf(text: string): number | null {
  const trimmed = text.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const credits = Number(trimmed);
  return isMediaApprovalCredits(credits) ? credits : null;
}

export function ServerMediaApprovalCreditsRow({ serverId }: { serverId: string }) {
  const { t } = useText();
  const { theme } = useUniwind();
  const { loadMediaApprovalCredits, setMediaApprovalCredits } = useMobileWorkspaceActions();
  const setting = useHostSetting(
    queryKeys.mediaApprovalCredits(useQueryScope(), serverId),
    () => loadMediaApprovalCredits(serverId),
    t("mobile.server.settings.mediaApprovalCreditsLoadFailed"),
    t("mobile.server.settings.mediaApprovalCreditsSaveFailed"),
  );
  const [draft, setDraft] = useState<string | null>(null);
  const current = setting.value;
  const text = draft ?? (current ? String(current.credits) : "");
  const invalid = draft !== null && creditsOf(draft) === null;

  function commit() {
    if (!current || draft === null) return;
    const credits = creditsOf(draft);
    if (credits === null) return;
    setDraft(null);
    if (credits !== current.credits) setting.save(() => setMediaApprovalCredits({ credits }, serverId));
  }

  const error = invalid ? t("error.team.mediaApprovalCreditsInvalid") : setting.error;
  return (
    <SettingsSection footer={error}>
      <SettingsRow leading={<RowIcon icon={Bot} />}>
        <SettingsSwitch
          value={current?.agents ?? false}
          disabled={!current || setting.saving}
          label={t("mobile.server.settings.mediaApprovalAgents")}
          dark={theme === "dark"}
          onValueChange={(agents) => {
            if (current && agents !== current.agents)
              setting.save(
                () => setMediaApprovalCredits({ agents }, serverId),
                t("mobile.server.settings.mediaApprovalAgentsSaveFailed"),
              );
          }}
        />
      </SettingsRow>
      {current?.agents === false ? null : (
        <SettingsRow
          leading={<RowIcon icon={Coins} />}
          disclosure={false}
          trailing={
            current ? (
              <View className="flex-row items-center gap-2">
                <Input
                  accessibilityLabel={t("mobile.server.settings.mediaApprovalCredits")}
                  value={text}
                  editable={!setting.saving}
                  keyboardType="number-pad"
                  returnKeyType="done"
                  maxLength={6}
                  textAlign="right"
                  isInvalid={invalid}
                  className="w-24"
                  onChangeText={setDraft}
                  onSubmitEditing={commit}
                  onBlur={commit}
                />
                <Typography.Paragraph>{t("mobile.server.settings.mediaApprovalCreditsUnit")}</Typography.Paragraph>
              </View>
            ) : null
          }
        >
          <Typography.Paragraph>{t("mobile.server.settings.mediaApprovalCredits")}</Typography.Paragraph>
        </SettingsRow>
      )}
      <SettingsRow leading={<RowIcon icon={BellRing} />}>
        <SettingsSwitch
          value={current?.askWhenBlocked ?? true}
          disabled={!current || setting.saving}
          label={t("mobile.server.settings.mediaApprovalAsk")}
          dark={theme === "dark"}
          onValueChange={(askWhenBlocked) => {
            if (current && askWhenBlocked !== current.askWhenBlocked)
              setting.save(
                () => setMediaApprovalCredits({ askWhenBlocked }, serverId),
                t("mobile.server.settings.mediaApprovalAskSaveFailed"),
              );
          }}
        />
      </SettingsRow>
    </SettingsSection>
  );
}
