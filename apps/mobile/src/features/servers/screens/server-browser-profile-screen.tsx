import { AVATAR_HUE_CHOICES, avatarHueSwatch } from "@openbot/brand/bloub-avatar";
import {
  type AvatarHue,
  BROWSER_PROFILE_NAME_MAX,
  type BrowserProfileSummary,
  nextBrowserProfileHue,
} from "@openbot/contracts/ipc";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { Button, Typography } from "heroui-native";
import Plus from "lucide-react-native/icons/plus";
import { useMemo, useRef, useState } from "react";
import { Alert, View } from "react-native";
import { useCSSVariable } from "uniwind";
import { HUE_LABELS } from "@/features/agents/components/agent-appearance-picker";
import { BloubAvatar } from "@/features/agents/components/bloub-avatar";
import { TrailingValue } from "@/features/servers/components/trailing-value";
import {
  type BrowserProfileStack,
  openBrowserProfileAgentsPage,
  openBrowserProfileProxyPage,
} from "@/features/servers/model/browser-profile-pages";
import { useAgentBrowserProfile, useServerBrowserProfiles } from "@/features/servers/model/use-server-browser-profiles";
import { useBrowserProxyChoices, useServerBrowserProxies } from "@/features/servers/model/use-server-browser-proxies";
import { useBrowserProfileUsage } from "@/features/servers/screens/server-browser-profiles-screen";
import {
  SettingsContent,
  SettingsNote,
  SettingsRow,
  SettingsSection,
} from "@/features/settings/components/settings-content";
import { useMobileWorkspaceSelector } from "@/features/workspace/context/mobile-workspace-context";
import { SheetFormField } from "@/shared/components/sheet-form-field";
import { SheetSaveAction } from "@/shared/components/sheet-save-action";
import { haptics } from "@/shared/lib/haptics";
import { useText } from "@/shared/lib/text";
import { useDiscardGuard } from "@/shared/lib/use-discard-guard";

export function ServerBrowserProfileScreen() {
  const { t, errorMessage } = useText();
  const { serverId, profileId, assignTo, agentId } = useLocalSearchParams<{
    serverId: string;
    profileId?: string;
    assignTo?: string;
    agentId?: string;
  }>();
  const stack: BrowserProfileStack = agentId ? { kind: "agent", agentId } : { kind: "server" };
  const profiles = useServerBrowserProfiles(serverId);
  const assignment = useAgentBrowserProfile(serverId, assignTo || undefined);
  const usage = useBrowserProfileUsage();
  const proxies = useServerBrowserProxies(serverId);
  const proxyChoices = useBrowserProxyChoices(proxies.list);
  const accent = String(useCSSVariable("--openbot-accent"));
  const allAgents = useMobileWorkspaceSelector((workspace) => workspace.agents);
  const agents = useMemo(() => allAgents.filter((agent) => agent.serverId === serverId), [allAgents, serverId]);
  const [removed, setRemoved] = useState<BrowserProfileSummary | null>(null);
  const profile =
    (profileId ? profiles.profiles?.find((candidate) => candidate.id === profileId) : undefined) ??
    (removed?.id === profileId ? removed : undefined);
  const [draftName, setDraftName] = useState<string | undefined>();
  const [draftHue, setDraftHue] = useState<AvatarHue | undefined>();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const locked = useRef(false);
  const leaving = useRef(false);
  const name = draftName ?? profile?.name ?? "";
  const trimmed = name.trim();
  const dirty = draftName !== undefined && trimmed !== (profile?.name ?? "");

  useDiscardGuard(dirty, { leaving: () => leaving.current, warn: true });

  async function perform(operation: () => Promise<void>): Promise<boolean> {
    if (locked.current) return false;
    locked.current = true;
    setPending(true);
    setError(null);
    try {
      await operation();
      void haptics.notification("success");
      return true;
    } catch (cause) {
      void haptics.notification("error");
      setError(errorMessage(cause, t("mobile.server.browserProfiles.saveFailed")));
      return false;
    } finally {
      locked.current = false;
      setPending(false);
    }
  }

  if (!profiles.available || !profiles.profiles || (profileId && !profile))
    return (
      <SettingsContent>
        <SettingsNote>
          {!profiles.available
            ? t("mobile.server.browserProfiles.unavailable")
            : profiles.query.isError
              ? errorMessage(profiles.query.error, t("mobile.server.browserProfiles.loadFailed"))
              : !profiles.profiles
                ? t("mobile.server.browserProfiles.loading")
                : t("mobile.server.browserProfiles.gone")}
        </SettingsNote>
      </SettingsContent>
    );

  function save(): void {
    if (!trimmed) return;
    if (profile) {
      void perform(() => profiles.rename(profile.id, trimmed)).then((saved) => {
        if (saved) setDraftName(undefined);
      });
      return;
    }
    let created: BrowserProfileSummary | undefined;
    const hue = draftHue;
    void perform(async () => {
      created = await profiles.create(trimmed);
      if (hue !== undefined && hue !== created.hue) await profiles.recolor(created.id, hue);
      if (assignTo) await assignment.choose({ kind: "profile", profileId: created.id });
    }).then((saved) => {
      if (!created) return;
      setDraftName(undefined);
      if (saved) {
        leaving.current = true;
        router.back();
        return;
      }
      router.setParams({ profileId: created.id, assignTo: undefined });
    });
  }

  function recolor(current: BrowserProfileSummary, hue: AvatarHue): void {
    if (hue === current.hue) return;
    void haptics.selection();
    void perform(() => profiles.recolor(current.id, hue));
  }

  function clear(current: BrowserProfileSummary): void {
    Alert.alert(
      t("mobile.server.browserProfiles.clearTitle", { name: current.name }),
      t("mobile.server.browserProfiles.clearBody"),
      [
        { text: t("common.cancel"), style: "cancel" },
        {
          text: t("mobile.server.browserProfiles.clear"),
          style: "destructive",
          onPress: () => void perform(() => profiles.clear(current.id)),
        },
      ],
    );
  }

  function remove(current: BrowserProfileSummary): void {
    const names = agents.filter((agent) => current.agentIds.includes(agent.id)).map((agent) => agent.name);
    const body = t("mobile.server.browserProfiles.deleteBody");
    Alert.alert(
      t("mobile.server.browserProfiles.deleteTitle", { name: current.name }),
      names.length
        ? `${body}\n\n${t("mobile.server.browserProfiles.deleteAgents", { agents: names.join(", ") })}`
        : body,
      [
        { text: t("common.cancel"), style: "cancel" },
        {
          text: t("mobile.server.browserProfiles.delete"),
          style: "destructive",
          onPress: () => {
            leaving.current = true;
            setRemoved(current);
            void perform(() => profiles.remove(current.id)).then((deleted) => {
              if (deleted) {
                router.back();
                return;
              }
              leaving.current = false;
              setRemoved(null);
            });
          },
        },
      ],
    );
  }

  const shownHue = profile?.hue ?? draftHue ?? nextBrowserProfileHue((profiles.profiles ?? []).map((item) => item.hue));
  const users = profile ? agents.filter((agent) => profile.agentIds.includes(agent.id)) : [];
  return (
    <SettingsContent>
      <Stack.Screen options={{ title: profile?.name ?? t("mobile.server.browserProfiles.new") }} />
      <SheetFormField
        label={t("mobile.server.browserProfiles.name")}
        autoCapitalize="words"
        autoFocus={!profile}
        maxLength={BROWSER_PROFILE_NAME_MAX}
        value={name}
        editable={!pending}
        returnKeyType="done"
        onSubmitEditing={() => {
          if (dirty && trimmed) save();
        }}
        onChangeText={(value) => {
          setDraftName(value);
          setError(null);
        }}
      />
      <SheetSaveAction
        dirty={dirty}
        canSave={trimmed.length > 0}
        pending={pending}
        label={profile ? undefined : t("mobile.server.browserProfiles.addConfirm")}
        onSave={save}
      />
      {error ? (
        <Typography.Paragraph accessibilityRole="alert" type="body-xs" className="-mt-4 px-4 text-danger-text">
          {error}
        </Typography.Paragraph>
      ) : null}
      <SettingsSection
        title={t("mobile.server.browserProfiles.color")}
        footer={!profile && assignTo ? t("mobile.server.browserProfiles.newForAgentHint") : undefined}
      >
        <View
          className="flex-row flex-wrap items-center gap-1 px-2 py-2"
          accessibilityRole="radiogroup"
          accessibilityLabel={t("mobile.server.browserProfiles.color")}
        >
          {AVATAR_HUE_CHOICES.map((option) => {
            const checked = shownHue === option.hue;
            return (
              <Button
                key={option.hue}
                isIconOnly
                variant={checked ? "secondary" : "ghost"}
                accessibilityRole="radio"
                accessibilityLabel={t(HUE_LABELS[option.hue])}
                accessibilityState={{ checked, disabled: pending }}
                isDisabled={pending}
                onPress={() => {
                  if (profile) {
                    recolor(profile, option.hue);
                    return;
                  }
                  void haptics.selection();
                  setDraftHue(option.hue);
                }}
              >
                <View className="size-6 rounded-full" style={{ backgroundColor: avatarHueSwatch(option.hue) }} />
              </Button>
            );
          })}
        </View>
      </SettingsSection>
      {!profile && assignTo ? (
        <Typography.Paragraph type="body-xs" className="px-4 text-warning-text">
          {t("mobile.agent.browserProfile.movedNote")}
        </Typography.Paragraph>
      ) : null}
      {profile ? (
        <>
          {proxies.available ? (
            <SettingsSection footer={t("mobile.server.browserProxies.profileHint")}>
              <SettingsRow
                disabled={pending}
                trailing={
                  proxies.list ? (
                    <TrailingValue
                      value={
                        proxyChoices.find((choice) => choice.profileIds.includes(profile.id))?.name ??
                        t("mobile.server.browserProxies.automatic")
                      }
                    />
                  ) : undefined
                }
                onPress={() => openBrowserProfileProxyPage(stack, serverId, profile.id)}
              >
                <Typography.Paragraph>{t("mobile.server.browserProxies.menu")}</Typography.Paragraph>
              </SettingsRow>
            </SettingsSection>
          ) : null}
          <SettingsSection
            title={t("mobile.server.browserProfiles.agentsTitle")}
            footer={usage(profile.agentIds.length, profile.tabCount)}
          >
            {users.map((agent) => (
              <SettingsRow
                key={agent.id}
                disclosure={false}
                leading={
                  <BloubAvatar
                    agentId={agent.id}
                    serverId={agent.serverId}
                    hue={agent.avatarHue}
                    color={agent.avatarColor}
                    seed={agent.avatarSeed}
                    size={32}
                    animateIdle={false}
                  />
                }
              >
                <Typography.Paragraph numberOfLines={1}>{agent.name}</Typography.Paragraph>
              </SettingsRow>
            ))}
            <SettingsRow
              disclosure={false}
              disabled={pending}
              leading={
                <View className="size-8 items-center justify-center">
                  <Plus size={18} color={accent} strokeWidth={2} />
                </View>
              }
              onPress={() => openBrowserProfileAgentsPage(stack, serverId, profile.id)}
            >
              <Typography.Paragraph className="text-accent">
                {t("mobile.server.browserProfiles.addAgents")}
              </Typography.Paragraph>
            </SettingsRow>
          </SettingsSection>
          <SettingsSection footer={t("mobile.server.browserProfiles.clearHint")}>
            <SettingsRow disclosure={false} disabled={pending} onPress={() => clear(profile)}>
              <Typography.Paragraph className="text-accent">
                {t("mobile.server.browserProfiles.clear")}
              </Typography.Paragraph>
            </SettingsRow>
            <SettingsRow disclosure={false} disabled={pending} onPress={() => remove(profile)}>
              <Typography.Paragraph className="text-danger-text">
                {t("mobile.server.browserProfiles.delete")}
              </Typography.Paragraph>
            </SettingsRow>
          </SettingsSection>
        </>
      ) : null}
    </SettingsContent>
  );
}
