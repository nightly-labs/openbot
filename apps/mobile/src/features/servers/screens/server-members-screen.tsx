import { normalizeEmailAddress } from "@openbot/contracts/validation";
import type { RemoteTeamMember } from "@openbot/team-client";
import { useMutation, useQuery } from "@tanstack/react-query";
import * as Clipboard from "expo-clipboard";
import { useLocalSearchParams } from "expo-router";
import { Button, Typography } from "heroui-native";
import { useRef, useState } from "react";
import { Alert, type AlertButton, View } from "react-native";
import { useMobileSession } from "@/features/auth/context/mobile-session-context";
import {
  SettingsContent,
  SettingsNote,
  SettingsRow,
  SettingsSection,
} from "@/features/settings/components/settings-content";
import { useMobileWorkspace } from "@/features/workspace/context/mobile-workspace-context";
import { SheetFormField } from "@/shared/components/sheet-form-field";

export function ServerMembersScreen() {
  const { serverId } = useLocalSearchParams<{ serverId: string }>();
  const { servers, teamDirectory } = useMobileWorkspace();
  const { session, sessionScope } = useMobileSession();
  const server = servers.find((candidate) => candidate.id === serverId);
  const canInvite = server?.role === "owner" || server?.role === "admin";
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"admin" | "member">("member");
  const [created, setCreated] = useState<{ inviteId: string; inviteUrl: string; expiresAt: number } | null>(null);
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
    const actions: AlertButton[] =
      member.status === "revoked"
        ? [
            {
              text: "Restore access",
              onPress: () => perform(() => teamDirectory.updateMember(serverId, member.membershipId, memberRole, true)),
            },
          ]
        : [
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
        <View className="gap-4">
          <Typography.Heading type="h4">Invite people to {server.name}</Typography.Heading>
          <SheetFormField
            label="Email (optional)"
            autoCapitalize="none"
            autoCorrect={false}
            inputMode="email"
            value={email}
            onChangeText={setEmail}
          />
          <View className="flex-row gap-2">
            <Button
              variant={role === "member" ? "primary" : "secondary"}
              isDisabled={action.isPending}
              onPress={() => setRole("member")}
            >
              <Button.Label>Member</Button.Label>
            </Button>
            <Button
              variant={role === "admin" ? "primary" : "secondary"}
              isDisabled={action.isPending}
              onPress={() => setRole("admin")}
            >
              <Button.Label>Admin</Button.Label>
            </Button>
          </View>
          <Button
            isDisabled={action.isPending}
            onPress={() =>
              perform(async () => {
                const normalized = email.trim() ? normalizeEmailAddress(email) : undefined;
                if (email.trim() && !normalized) throw new Error("Enter a valid email address.");
                setCreated(
                  await teamDirectory.createInvite(
                    { hostId: server.id, devicePublicKey: server.publicKey },
                    { role, ...(normalized ? { email: normalized } : {}) },
                  ),
                );
                setCopied(false);
              })
            }
          >
            <Button.Label>Create invite link</Button.Label>
          </Button>
          {created ? (
            <>
              <Typography.Paragraph type="body-xs" className="text-grouped-secondary">
                Share this one-time link. Expires {new Date(created.expiresAt).toLocaleString()}.
              </Typography.Paragraph>
              <Button
                variant="secondary"
                onPress={() => {
                  void Clipboard.setStringAsync(created.inviteUrl)
                    .then(() => setCopied(true))
                    .catch(() => Alert.alert("Copy failed", "Try again."));
                }}
              >
                <Button.Label>{copied ? "Copied" : "Copy link"}</Button.Label>
              </Button>
            </>
          ) : null}
        </View>
      ) : null}
      {action.error ? <SettingsNote>{action.error.message}</SettingsNote> : null}
      <SettingsSection title="Server members">
        <SettingsRow
          disclosure={false}
          disabled={members.isFetching || action.isPending}
          onPress={() => {
            void members.refetch();
            if (canInvite) void invites.refetch();
          }}
        >
          <Typography.Paragraph type="body-sm">
            {members.isFetching ? "Loading members…" : "Refresh members"}
          </Typography.Paragraph>
        </SettingsRow>
        {members.isError ? <SettingsNote>Could not load members. Refresh to try again.</SettingsNote> : null}
        {members.data?.map((member) => (
          <SettingsRow
            key={member.membershipId}
            disabled={action.isPending}
            disclosure={false}
            supportingText={`${member.email} · ${member.role}${member.status === "revoked" ? " · Access removed" : ""}`}
            onPress={server.role === "owner" && member.role !== "owner" ? () => manage(member) : undefined}
          >
            <Typography.Paragraph type="body-sm">{member.name || member.email}</Typography.Paragraph>
          </SettingsRow>
        ))}
      </SettingsSection>
      {canInvite ? (
        <SettingsSection title="Pending invitations">
          {invites.isError ? <SettingsNote>Could not load invitations. Refresh to try again.</SettingsNote> : null}
          {invites.data
            ?.filter((invite) => !invite.usedAt && !invite.revokedAt && invite.expiresAt > Date.now())
            .map((invite) => (
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
