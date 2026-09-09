import { Host, Picker } from "@expo/ui";
import { normalizeEmailAddress } from "@openbot/contracts/validation";
import type { RemoteTeamMember } from "@openbot/team-client";
import { userErrorMessage as errorMessage } from "@openbot/user-errors";
import { useMutation, useQuery } from "@tanstack/react-query";
import * as Clipboard from "expo-clipboard";
import { useLocalSearchParams } from "expo-router";
import { Typography } from "heroui-native";
import { useRef, useState } from "react";
import { Alert, type AlertButton, View } from "react-native";
import { useUniwind } from "uniwind";
import { useMobileSession } from "@/features/auth/context/mobile-session-context";
import {
  SettingsContent,
  SettingsNote,
  SettingsRow,
  SettingsSection,
} from "@/features/settings/components/settings-content";
import { useMobileWorkspace } from "@/features/workspace/context/mobile-workspace-context";
import { ProfileAvatar } from "@/shared/components/profile-avatar";
import { SheetFormField } from "@/shared/components/sheet-form-field";

export function ServerMembersScreen() {
  const { theme } = useUniwind();
  const { serverId } = useLocalSearchParams<{ serverId: string }>();
  const { servers, teamDirectory } = useMobileWorkspace();
  const { session, sessionScope } = useMobileSession();
  const server = servers.find((candidate) => candidate.id === serverId);
  const canInvite = server?.role === "owner" || server?.role === "admin";
  const [inviteMode, setInviteMode] = useState<"email" | "link">("link");
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
    created && invites.data?.some((invite) => invite.inviteId === created.inviteId && invite.usedAt),
  );
  const pendingInvites = invites.data?.filter(
    (invite) => !invite.usedAt && !invite.revokedAt && invite.expiresAt > Date.now(),
  );
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
              text: member.role === "admin" ? "Make member" : "Make admin",
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
        text: "Remove member",
        style: "destructive",
        onPress: () => perform(() => teamDirectory.leaveHost(serverId, member.membershipId)),
      },
    ];
    Alert.alert(member.name || member.email, "Manage access to this server.", [
      { text: "Cancel", style: "cancel" },
      ...actions,
    ]);
  }
  if (!server)
    return (
      <SettingsContent>
        <SettingsNote>This server is no longer available.</SettingsNote>
      </SettingsContent>
    );
  return (
    <SettingsContent>
      {canInvite ? (
        <View className="gap-2">
          <SettingsSection title="Invite people">
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
                    <Picker.Item label="Invite link" value="link" />
                    <Picker.Item label="Email" value="email" />
                  </Picker>
                </Host>
              }
            >
              <Typography.Paragraph type="body-sm">Invite with</Typography.Paragraph>
            </SettingsRow>
            {inviteMode === "email" ? (
              <View className="px-4 py-3">
                <SheetFormField
                  label="Email"
                  isRequired
                  placeholder="name@example.com"
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
                    <Picker.Item label="Member" value="member" />
                    <Picker.Item label="Admin" value="admin" />
                  </Picker>
                </Host>
              }
            >
              <Typography.Paragraph type="body-sm">Role</Typography.Paragraph>
            </SettingsRow>
            <SettingsRow
              disclosure={false}
              disabled={action.isPending}
              onPress={() =>
                perform(async () => {
                  const host = { hostId: server.id, devicePublicKey: server.publicKey, name: server.name };
                  if (inviteMode === "email") {
                    const normalized = normalizeEmailAddress(email);
                    if (!normalized) throw new Error("Enter a valid email address.");
                    const invite = await teamDirectory.sendInviteEmail(host, { role, email: normalized });
                    setCreated({ ...invite, email: normalized });
                  } else {
                    setCreated(await teamDirectory.createInvite(host, { role }));
                  }
                  setCopied(false);
                })
              }
            >
              <Typography.Paragraph type="body-sm" className="text-accent">
                {inviteMode === "email"
                  ? created
                    ? "Send another invitation"
                    : "Send invitation"
                  : created
                    ? "Create new link"
                    : "Create invite link"}
              </Typography.Paragraph>
            </SettingsRow>
          </SettingsSection>
          {created ? (
            <>
              <SettingsNote>
                {inviteUsed
                  ? "Invitation accepted. The member joined this server."
                  : created.email
                    ? `Invitation sent to ${created.email}.`
                    : `Share this one-time link. Expires ${new Date(created.expiresAt).toLocaleString()}.`}
              </SettingsNote>
              {!created.email ? (
                <SettingsSection>
                  <SettingsRow
                    disclosure={false}
                    disabled={inviteUsed}
                    onPress={() => {
                      void Clipboard.setStringAsync(created.inviteUrl)
                        .then(() => setCopied(true))
                        .catch(() => Alert.alert("Copy failed", "Try again."));
                    }}
                  >
                    <Typography.Paragraph type="body-sm" className="text-accent">
                      {copied ? "Copied" : "Copy link"}
                    </Typography.Paragraph>
                  </SettingsRow>
                </SettingsSection>
              ) : null}
            </>
          ) : (
            <SettingsNote>
              {inviteMode === "email"
                ? "Send a one-time invitation to an email address."
                : "Share a one-time link to invite someone to this server."}
            </SettingsNote>
          )}
        </View>
      ) : null}
      {action.error ? (
        <SettingsNote>{errorMessage(action.error, "Could not update this member. Try again.")}</SettingsNote>
      ) : null}
      <SettingsSection title="Server members">
        {members.isError ? (
          <SettingsRow disclosure={false}>
            <Typography.Paragraph type="body-xs" className="text-grouped-secondary">
              Could not load members. Refresh to try again.
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
                member.role === "owner" ? "Owner" : member.role === "admin" ? "Admin" : "Member",
                member.status === "revoked" ? "Access removed" : null,
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
              No members.
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
            {members.isFetching ? "Loading members…" : "Refresh members"}
          </Typography.Paragraph>
        </SettingsRow>
      </SettingsSection>
      {canInvite ? (
        <SettingsSection title="Pending invitations">
          {invites.isError ? (
            <SettingsRow disclosure={false}>
              <Typography.Paragraph type="body-xs" className="text-grouped-secondary">
                Could not load invitations. Refresh to try again.
              </Typography.Paragraph>
            </SettingsRow>
          ) : null}
          {invites.isPending ? (
            <SettingsRow disclosure={false}>
              <Typography.Paragraph type="body-sm" className="text-grouped-secondary">
                Loading invitations…
              </Typography.Paragraph>
            </SettingsRow>
          ) : null}
          {invites.isSuccess && pendingInvites?.length === 0 ? (
            <SettingsRow disclosure={false}>
              <Typography.Paragraph type="body-sm" className="text-grouped-secondary">
                No pending invitations.
              </Typography.Paragraph>
            </SettingsRow>
          ) : null}
          {pendingInvites?.map((invite) => (
            <SettingsRow
              key={invite.inviteId}
              disabled={action.isPending}
              disclosure={false}
              supportingText={`${invite.role} · Tap to revoke`}
              onPress={() =>
                Alert.alert("Revoke invitation?", "This invitation will stop working.", [
                  { text: "Cancel", style: "cancel" },
                  {
                    text: "Revoke",
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
              <Typography.Paragraph type="body-sm">{invite.email || "Invite link"}</Typography.Paragraph>
            </SettingsRow>
          ))}
        </SettingsSection>
      ) : null}
    </SettingsContent>
  );
}
