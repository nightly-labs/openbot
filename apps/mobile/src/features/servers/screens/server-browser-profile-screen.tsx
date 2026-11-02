import { AVATAR_HUE_CHOICES, avatarHueSwatch } from "@openbot/brand/bloub-avatar";
import {
  type AvatarHue,
  BROWSER_PROFILE_NAME_MAX,
  type BrowserProfileSummary,
  nextBrowserProfileHue,
} from "@openbot/contracts/ipc";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { usePreventRemove } from "expo-router/react-navigation";
import { Button, Typography } from "heroui-native";
import Plus from "lucide-react-native/icons/plus";
import { useMemo, useRef, useState } from "react";
import { Alert, View } from "react-native";
import { useCSSVariable } from "uniwind";
import { HUE_LABELS } from "@/features/agents/components/agent-appearance-picker";
import { BloubAvatar } from "@/features/agents/components/bloub-avatar";
import { type BrowserProfileStack, openBrowserProfileAgentsPage } from "@/features/servers/model/browser-profile-pages";
import { useAgentBrowserProfile, useServerBrowserProfiles } from "@/features/servers/model/use-server-browser-profiles";
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

/**
 * Browser profiles > one profile, or a new one without `profileId`. A new profile takes its name and
 * color on this page, and Add makes it and goes back; from an agent's choice (`assignTo`) it also
 * goes to that agent. For a saved profile the name saves with the header action and the color saves
 * at once. Clear data signs the profile out of every site, and Delete moves its agents to the shared
 * profile.
 */
export function ServerBrowserProfileScreen() {
  const { t, errorMessage } = useText();
  // `agentId` is set when the agent settings show this page.
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
  const accent = String(useCSSVariable("--openbot-accent"));
  // The selector returns the stored list, so the page does not render again for a new copy.
  const allAgents = useMobileWorkspaceSelector((workspace) => workspace.agents);
  const agents = useMemo(() => allAgents.filter((agent) => agent.serverId === serverId), [allAgents, serverId]);
  // Kept after Delete, so the page does not say "gone" while it goes back.
  const [removed, setRemoved] = useState<BrowserProfileSummary | null>(null);
  const profile =
    (profileId ? profiles.profiles?.find((candidate) => candidate.id === profileId) : undefined) ??
    (removed?.id === profileId ? removed : undefined);
  const [draftName, setDraftName] = useState<string | undefined>();
  /** The color of a new profile. Undefined is the color that the host gives: the one that the fewest profiles use. */
  const [draftHue, setDraftHue] = useState<AvatarHue | undefined>();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const locked = useRef(false);
  /** True after Delete or an assigned new profile: the page leaves without the question about the name. */
  const leaving = useRef(false);
  const name = draftName ?? profile?.name ?? "";
  const trimmed = name.trim();
  const dirty = draftName !== undefined && trimmed !== (profile?.name ?? "");

  const [discarding, setDiscarding] = useState(false);
  usePreventRemove(!discarding && dirty, ({ repeat }) => {
    if (leaving.current) {
      setDiscarding(true);
      repeat();
      return;
    }
    void haptics.notification("warning");
    Alert.alert(t("mobile.agent.discard.title"), t("mobile.agent.discard.body"), [
      { text: t("mobile.agent.discard.keepEditing"), style: "cancel" },
      {
        text: t("mobile.agent.discard.discard"),
        style: "destructive",
        onPress: () => {
          setDiscarding(true);
          repeat();
        },
      },
    ]);
  });

  /** Runs one change at a time. Resolves true when it succeeds. */
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
      // The create route takes only the name, so a color that the host did not give saves after it.
      if (hue !== undefined && avatarHueSwatch(hue) !== avatarHueSwatch(created.hue))
        await profiles.recolor(created.id, hue);
      if (assignTo) await assignment.choose({ kind: "profile", profileId: created.id });
    }).then((saved) => {
      if (!created) return;
      setDraftName(undefined);
      if (saved) {
        leaving.current = true;
        router.back();
        return;
      }
      // The profile exists, also when its color or the agent did not save: the page now shows it.
      router.setParams({ profileId: created.id, assignTo: undefined });
    });
  }

  function recolor(current: BrowserProfileSummary, hue: AvatarHue): void {
    if (avatarHueSwatch(hue) === avatarHueSwatch(current.hue)) return;
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
            // A stored hue 100 or 280 shows as its same-color choice.
            const checked = avatarHueSwatch(shownHue) === avatarHueSwatch(option.hue);
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
      {profile ? (
        <>
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
