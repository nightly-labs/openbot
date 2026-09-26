import { Host, Picker } from "@expo/ui";
import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import { PERMANENT_INVITE_EXPIRES_AT_MS } from "@openbot/contracts/invite-links";
import { normalizeEmailAddress } from "@openbot/contracts/validation";
import type { RemoteTeamMember } from "@openbot/team-client";
import { useMutation, useQuery } from "@tanstack/react-query";
import * as Clipboard from "expo-clipboard";
import { useLocalSearchParams } from "expo-router";
import { Typography } from "heroui-native";
import { useRef, useState } from "react";
import { Alert, type AlertButton, View } from "react-native";
import { useUniwind } from "uniwind";
import { useMobileSession } from "@/features/auth/context/mobile-session-context";
import { SERVER_ROLE_KEYS, SERVER_ROLE_LABEL_KEYS } from "@/features/servers/model/server-role";
import {
  SettingsContent,
  SettingsNote,
  SettingsRow,
  SettingsSection,
} from "@/features/settings/components/settings-content";
import { useMobileWorkspace } from "@/features/workspace/context/mobile-workspace-context";
import { ProfileAvatar } from "@/shared/components/profile-avatar";
import { SheetFormField } from "@/shared/components/sheet-form-field";
import { useText } from "@/shared/lib/text";

const EMAIL_PLACEHOLDER = "name@example.com";

export function ServerMembersScreen() {
  const { t, format, errorMessage } = useText();
  const { theme } = useUniwind();
  const { serverId } = useLocalSearchParams<{ serverId: string }>();
  const { servers, teamDirectory } = useMobileWorkspace();
  const { session, sessionScope } = useMobileSession();
  const server = servers.find((candidate) => candidate.id === serverId);
  const canInvite = server?.role === "owner" || server?.role === "admin";
  const [inviteMode, setInviteMode] = useState<"email" | "link" | "permanent">("link");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"admin" | "member">("member");
  const [created, setCreated] = useState<{
    inviteId: string;
    inviteUrl: string;
    expiresAt: number;
    email?: string;
  } | null>(null);
  const [copied, setCopied] = useState(false);
  const locked = useRef(false);
  const members = useQuery({
    queryKey: ["server-members", session?.apiUrl, session?.user.id, sessionScope, serverId],
    enabled: Boolean(server),
    retry: false,
    gcTime: 0,
    queryFn: () => teamDirectory.listMembers(serverId),
  });
  const invites = useQuery({
    queryKey: ["server-invites", session?.apiUrl, session?.user.id, sessionScope, serverId],
    enabled: canInvite,
    retry: false,
    gcTime: 0,
    queryFn: () => teamDirectory.listInvites(serverId),
  });
  const inviteUsed = Boolean(
    created &&
      invites.data?.some((invite) => invite.inviteId === created.inviteId && !invite.permanent && invite.usedAt),
  );
  const pendingInvites = invites.data?.filter(
    (invite) => (invite.permanent || !invite.usedAt) && !invite.revokedAt && invite.expiresAt > Date.now(),
  );
  const permanentCount = pendingInvites?.filter((invite) => invite.permanent).length ?? 0;
  const permanentLimitReached = inviteMode === "permanent" && permanentCount >= INPUT_LIMITS.maxPermanentInvites;
  const createdPermanent = Boolean(created && created.expiresAt >= PERMANENT_INVITE_EXPIRES_AT_MS);
  const action = useMutation({
    mutationFn: (operation: () => Promise<void>) => operation(),
    onSuccess: () => {
      // A refresh failure must not retry a committed membership change or invitation.
      void members.refetch();
      if (canInvite) void invites.refetch();
    },
    onSettled: () => {
      locked.current = false;
    },
  });
  function perform(operation: () => Promise<void>) {
    if (locked.current) return;
    locked.current = true;
    action.mutate(operation);
  }
  function manage(member: RemoteTeamMember) {
    if (member.role === "owner") return;
    const memberRole = member.role;
    const actions: AlertButton[] = [
      ...(member.status === "active"
        ? [
            {
              text:
                member.role === "admin" ? t("mobile.server.members.makeMember") : t("mobile.server.members.makeAdmin"),
              onPress: () =>
                perform(() =>
                  teamDirectory.updateMember(
                    serverId,
                    member.membershipId,
                    memberRole === "admin" ? "member" : "admin",
                  ),
                ),
            },
          ]
        : []),
      {
        text: t("mobile.server.members.remove"),
        style: "destructive",
        onPress: () => perform(() => teamDirectory.leaveHost(serverId, member.membershipId)),
      },
    ];
    Alert.alert(member.name || member.email, t("mobile.server.members.manage"), [
      { text: t("common.cancel"), style: "cancel" },
      ...actions,
    ]);
  }
  if (!server)
    return (
      <SettingsContent>
        <SettingsNote>{t("mobile.server.unavailable")}</SettingsNote>
      </SettingsContent>
    );
  return (
    <SettingsContent>
      {canInvite ? (
        <View className="gap-2">
          <SettingsSection title={t("mobile.server.members.invitePeople")}>
            <SettingsRow
              disclosure={false}
              trailing={
                <Host matchContents colorScheme={theme === "dark" ? "dark" : "light"}>
                  <Picker
                    selectedValue={inviteMode}
                    enabled={!action.isPending}
                    onValueChange={(value) => {
                      setInviteMode(value);
                      setCreated(null);
                      setCopied(false);
                      action.reset();
                    }}
                  >
                    <Picker.Item label={t("mobile.server.members.inviteLink")} value="link" />
                    <Picker.Item label={t("mobile.server.members.email")} value="email" />
                    <Picker.Item label={t("mobile.server.members.permanentLink")} value="permanent" />
                  </Picker>
                </Host>
              }
            >
              <Typography.Paragraph type="body-sm">{t("mobile.server.members.inviteWith")}</Typography.Paragraph>
            </SettingsRow>
            {inviteMode === "email" ? (
              <View className="px-4 py-3">
                <SheetFormField
                  label={t("mobile.server.members.email")}
                  isRequired
                  placeholder={EMAIL_PLACEHOLDER}
                  autoCapitalize="none"
                  autoCorrect={false}
                  inputMode="email"
                  editable={!action.isPending}
                  value={email}
                  onChangeText={setEmail}
                />
              </View>
            ) : null}
            <SettingsRow
              disclosure={false}
              trailing={
                <Host matchContents colorScheme={theme === "dark" ? "dark" : "light"}>
                  <Picker selectedValue={role} enabled={!action.isPending} onValueChange={setRole}>
                    <Picker.Item label={t(SERVER_ROLE_LABEL_KEYS.member)} value="member" />
                    <Picker.Item label={t(SERVER_ROLE_LABEL_KEYS.admin)} value="admin" />
                  </Picker>
                </Host>
              }
            >
              <Typography.Paragraph type="body-sm">{t("mobile.server.members.role")}</Typography.Paragraph>
            </SettingsRow>
            <SettingsRow
              disclosure={false}
              disabled={action.isPending || permanentLimitReached}
              onPress={() =>
                perform(async () => {
                  const host = { hostId: server.id, devicePublicKey: server.publicKey, name: server.name };
                  if (inviteMode === "email") {
                    const normalized = normalizeEmailAddress(email);
                    if (!normalized) throw new Error(t("mobile.server.members.invalidEmail"));
                    const invite = await teamDirectory.sendInviteEmail(host, { role, email: normalized });
                    setCreated({ ...invite, email: normalized });
                  } else {
                    setCreated(
                      await teamDirectory.createInvite(host, {
                        role,
                        ...(inviteMode === "permanent" ? { permanent: true } : {}),
                      }),
                    );
                  }
                  setCopied(false);
                })
              }
            >
              <Typography.Paragraph type="body-sm" className="text-accent">
                {inviteMode === "email"
                  ? created
                    ? t("mobile.server.members.sendAnother")
                    : t("mobile.server.members.send")
                  : created
                    ? t("mobile.server.members.createAnother")
                    : t("mobile.server.members.create")}
              </Typography.Paragraph>
            </SettingsRow>
          </SettingsSection>
          {permanentLimitReached ? <SettingsNote>{t("mobile.server.members.permanentLimit")}</SettingsNote> : null}
          {created ? (
            <>
              <SettingsNote>
                {inviteUsed
                  ? t("mobile.server.members.inviteUsed")
                  : created.email
                    ? t("mobile.server.members.inviteSent", { email: created.email })
                    : createdPermanent
                      ? t("mobile.server.members.permanentCreated")
                      : t("mobile.server.members.oneTimeCreated", {
                          date: format.date(created.expiresAt, {
                            year: "numeric",
                            month: "numeric",
                            day: "numeric",
                            hour: "numeric",
                            minute: "numeric",
                            second: "numeric",
                          }),
                        })}
              </SettingsNote>
              {!created.email ? (
                <SettingsSection>
                  <SettingsRow
                    disclosure={false}
                    disabled={inviteUsed}
                    onPress={() => {
                      void Clipboard.setStringAsync(created.inviteUrl)
                        .then(() => setCopied(true))
                        .catch(() =>
                          Alert.alert(t("mobile.server.members.copyFailed"), t("mobile.server.members.copyFailedBody")),
                        );
                    }}
                  >
                    <Typography.Paragraph type="body-sm" className="text-accent">
                      {copied ? t("common.copied") : t("mobile.server.members.copyLink")}
                    </Typography.Paragraph>
                  </SettingsRow>
                </SettingsSection>
              ) : null}
            </>
          ) : (
            <SettingsNote>
              {inviteMode === "email"
                ? t("mobile.server.members.emailHint")
                : inviteMode === "permanent"
                  ? t("mobile.server.members.permanentHint", { limit: INPUT_LIMITS.maxPermanentInvites })
                  : t("mobile.server.members.linkHint")}
            </SettingsNote>
          )}
        </View>
      ) : null}
      {action.error ? (
        <SettingsNote>{errorMessage(action.error, t("mobile.server.members.updateFailed"))}</SettingsNote>
      ) : null}
      <SettingsSection title={t("mobile.server.members.title")}>
        {members.isError ? (
          <SettingsRow disclosure={false}>
            <Typography.Paragraph type="body-xs" className="text-grouped-secondary">
              {t("mobile.server.members.loadFailed")}
            </Typography.Paragraph>
          </SettingsRow>
        ) : null}
        {members.data
          ?.filter((member) => member.status === "active")
          .map((member) => (
            <SettingsRow
              key={member.membershipId}
              disabled={action.isPending}
              disclosure={false}
              leading={<ProfileAvatar neutral name={member.name || member.email} size={36} />}
              supportingText={[
                member.name && member.name !== member.email ? member.email : null,
                t(SERVER_ROLE_LABEL_KEYS[member.role]),
                member.status === "revoked" ? t("mobile.server.members.accessRemoved") : null,
              ]
                .filter(Boolean)
                .join(" · ")}
              onPress={server.role === "owner" && member.role !== "owner" ? () => manage(member) : undefined}
            >
              <Typography.Paragraph type="body-sm" numberOfLines={1}>
                {member.name || member.email}
              </Typography.Paragraph>
            </SettingsRow>
          ))}
        {members.isSuccess && !members.data.some((member) => member.status === "active") ? (
          <SettingsRow disclosure={false}>
            <Typography.Paragraph type="body-sm" className="text-grouped-secondary">
              {t("mobile.server.members.empty")}
            </Typography.Paragraph>
          </SettingsRow>
        ) : null}
        <SettingsRow
          disclosure={false}
          disabled={members.isFetching || action.isPending}
          onPress={() => {
            void members.refetch();
            if (canInvite) void invites.refetch();
          }}
        >
          <Typography.Paragraph type="body-sm" className="text-accent">
            {members.isFetching ? t("mobile.server.members.loading") : t("mobile.server.members.refresh")}
          </Typography.Paragraph>
        </SettingsRow>
      </SettingsSection>
      {canInvite ? (
        <SettingsSection title={t("mobile.server.members.invitations")}>
          {invites.isError ? (
            <SettingsRow disclosure={false}>
              <Typography.Paragraph type="body-xs" className="text-grouped-secondary">
                {t("mobile.server.members.invitationsLoadFailed")}
              </Typography.Paragraph>
            </SettingsRow>
          ) : null}
          {invites.isPending ? (
            <SettingsRow disclosure={false}>
              <Typography.Paragraph type="body-sm" className="text-grouped-secondary">
                {t("mobile.server.members.invitationsLoading")}
              </Typography.Paragraph>
            </SettingsRow>
          ) : null}
          {invites.isSuccess && pendingInvites?.length === 0 ? (
            <SettingsRow disclosure={false}>
              <Typography.Paragraph type="body-sm" className="text-grouped-secondary">
                {t("mobile.server.members.invitationsEmpty")}
              </Typography.Paragraph>
            </SettingsRow>
          ) : null}
          {pendingInvites?.map((invite) => (
            <SettingsRow
              key={invite.inviteId}
              disabled={action.isPending}
              disclosure={false}
              supportingText={
                invite.permanent
                  ? t("mobile.server.members.permanentInviteRow", {
                      role: t(SERVER_ROLE_KEYS[invite.role]),
                      uses: invite.useCount,
                    })
                  : t("mobile.server.members.inviteRow", { role: t(SERVER_ROLE_KEYS[invite.role]) })
              }
              onPress={() =>
                Alert.alert(t("mobile.server.members.revokeTitle"), t("mobile.server.members.revokeBody"), [
                  { text: t("common.cancel"), style: "cancel" },
                  {
                    text: t("mobile.server.members.revoke"),
                    style: "destructive",
                    onPress: () =>
                      perform(async () => {
                        await teamDirectory.revokeInvite(invite.inviteId);
                        if (created?.inviteId === invite.inviteId) setCreated(null);
                      }),
                  },
                ])
              }
            >
              <Typography.Paragraph type="body-sm">
                {invite.email ||
                  (invite.permanent ? t("mobile.server.members.permanentLink") : t("mobile.server.members.inviteLink"))}
              </Typography.Paragraph>
            </SettingsRow>
          ))}
        </SettingsSection>
      ) : null}
    </SettingsContent>
  );
}
