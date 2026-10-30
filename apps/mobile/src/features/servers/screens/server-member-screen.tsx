import { runTeamEffect } from "@openbot/team-client";
import { router, useLocalSearchParams } from "expo-router";
import { Typography } from "heroui-native";
import { Alert, View } from "react-native";
import { useUniwind } from "uniwind";
import { SERVER_ROLE_LABEL_KEYS } from "@/features/servers/model/server-role";
import { useServerMembers } from "@/features/servers/model/use-server-members";
import { memberRoleNames, useServerRoles } from "@/features/servers/model/use-server-roles";
import {
  SettingsContent,
  SettingsNote,
  SettingsRow,
  SettingsSection,
} from "@/features/settings/components/settings-content";
import { SettingsPicker } from "@/features/settings/components/settings-controls";
import { ProfileAvatar } from "@/shared/components/profile-avatar";
import { haptics } from "@/shared/lib/haptics";
import { useText } from "@/shared/lib/text";

const DATE_FORMAT = { year: "numeric", month: "short", day: "numeric" } as const;
const EXPIRY_FORMAT = { month: "short", day: "numeric", hour: "numeric", minute: "numeric" } as const;

/**
 * Server sheet > Members > one person: their role and access. An owner or admin changes the role
 * of another member, opens the Roles page of a member, or removes them; the owner and your own membership stay read-only here, and
 * Server settings has Leave. An email invitation opens here too, and its owner or admin revokes it.
 */
export function ServerMemberScreen() {
  const { t, format, errorMessage } = useText();
  const { theme } = useUniwind();
  const { serverId, membershipId, inviteId } = useLocalSearchParams<{
    serverId: string;
    membershipId?: string;
    inviteId?: string;
  }>();
  const { server, teamDirectory, canManage, members, invites, action, perform } = useServerMembers(serverId);
  const roles = useServerRoles(serverId);
  const member = membershipId
    ? members.data?.find((candidate) => candidate.membershipId === membershipId && candidate.status === "active")
    : undefined;
  const invite = inviteId ? invites.data?.find((candidate) => candidate.inviteId === inviteId) : undefined;
  const loading = membershipId ? members.isPending : invites.isPending;
  if (!server || !(member || invite))
    return (
      <SettingsContent>
        <SettingsNote>
          {!server
            ? t("mobile.server.unavailable")
            : loading && !(members.isError || invites.isError)
              ? t("mobile.server.members.loading")
              : t(membershipId ? "mobile.server.members.gone" : "mobile.server.members.inviteGone")}
        </SettingsNote>
      </SettingsContent>
    );
  const error = action.error ? (
    <Typography.Paragraph accessibilityRole="alert" type="body-xs" className="-mt-4 px-4 text-danger-text">
      {errorMessage(action.error, t("mobile.server.members.updateFailed"))}
    </Typography.Paragraph>
  ) : null;

  if (member) {
    const name = member.name || member.email;
    const self = member.membershipId === server.membershipId;
    const manageable = canManage && member.role !== "owner" && !self;
    const memberRole = member.role;
    const memberRoles = memberRoleNames(roles.list, member.membershipId);
    return (
      <SettingsContent>
        <Identity
          name={name}
          label={self ? t("mobile.server.members.you", { name }) : name}
          detail={member.name && member.name !== member.email ? member.email : null}
        />
        <SettingsSection
          footer={
            manageable
              ? t("mobile.server.members.roleHint")
              : member.role === "owner"
                ? t("mobile.server.members.ownerHint")
                : undefined
          }
        >
          <SettingsRow
            disclosure={false}
            trailing={
              manageable && memberRole !== "owner" ? (
                <SettingsPicker
                  value={memberRole}
                  options={[
                    { value: "member", label: t(SERVER_ROLE_LABEL_KEYS.member) },
                    { value: "admin", label: t(SERVER_ROLE_LABEL_KEYS.admin) },
                  ]}
                  enabled={!action.isPending}
                  dark={theme === "dark"}
                  label={t("mobile.server.members.role")}
                  onChange={(value) => {
                    if (value === memberRole) return;
                    void haptics.selection();
                    void perform(() => runTeamEffect(teamDirectory.updateMember(serverId, member.membershipId, value)));
                  }}
                />
              ) : (
                <Typography.Paragraph className="text-grouped-secondary">
                  {t(SERVER_ROLE_LABEL_KEYS[member.role])}
                </Typography.Paragraph>
              )
            }
          >
            <Typography.Paragraph>{t("mobile.server.members.role")}</Typography.Paragraph>
          </SettingsRow>
          {member.createdAt ? (
            <SettingsRow
              disclosure={false}
              trailing={
                <Typography.Paragraph className="text-grouped-secondary">
                  {format.date(member.createdAt, DATE_FORMAT)}
                </Typography.Paragraph>
              }
            >
              <Typography.Paragraph>{t("mobile.server.members.joined")}</Typography.Paragraph>
            </SettingsRow>
          ) : null}
        </SettingsSection>
        {error}
        {/* Roles apply only to a member: an owner or admin can use all agents. */}
        {manageable && memberRole === "member" && roles.available ? (
          <SettingsSection footer={t("mobile.server.roles.memberHint")}>
            <SettingsRow
              supportingText={
                roles.roles.isError
                  ? errorMessage(roles.roles.error, t("mobile.server.roles.loadFailed"))
                  : !roles.list
                    ? t("mobile.server.roles.loading")
                    : memberRoles.length
                      ? format.list(memberRoles)
                      : t("mobile.server.roles.memberNone")
              }
              onPress={() =>
                router.push({
                  pathname: "/server-settings/member-roles",
                  params: { serverId, membershipId: member.membershipId },
                })
              }
            >
              <Typography.Paragraph>{t("mobile.server.roles.title")}</Typography.Paragraph>
            </SettingsRow>
          </SettingsSection>
        ) : null}
        {manageable ? (
          <SettingsSection>
            <SettingsRow
              disclosure={false}
              disabled={action.isPending}
              onPress={() =>
                Alert.alert(
                  t("mobile.server.members.removeTitle", { name }),
                  t("mobile.server.members.removeBody", { server: server.name }),
                  [
                    { text: t("common.cancel"), style: "cancel" },
                    {
                      text: t("mobile.server.members.remove"),
                      style: "destructive",
                      onPress: () =>
                        void perform(() => runTeamEffect(teamDirectory.leaveHost(serverId, member.membershipId))).then(
                          (removed) => {
                            if (removed) router.back();
                          },
                        ),
                    },
                  ],
                )
              }
            >
              <Typography.Paragraph className="text-danger-text">
                {t("mobile.server.members.remove")}
              </Typography.Paragraph>
            </SettingsRow>
          </SettingsSection>
        ) : null}
      </SettingsContent>
    );
  }

  if (!invite) return null;
  const email = invite.email ?? "";
  return (
    <SettingsContent>
      <Identity name={email} label={email} detail={t("mobile.server.members.invited")} />
      <SettingsSection>
        <SettingsRow
          disclosure={false}
          trailing={
            <Typography.Paragraph className="text-grouped-secondary">
              {t(SERVER_ROLE_LABEL_KEYS[invite.role])}
            </Typography.Paragraph>
          }
        >
          <Typography.Paragraph>{t("mobile.server.members.role")}</Typography.Paragraph>
        </SettingsRow>
        <SettingsRow
          disclosure={false}
          trailing={
            <Typography.Paragraph className="text-grouped-secondary">
              {format.date(invite.expiresAt, EXPIRY_FORMAT)}
            </Typography.Paragraph>
          }
        >
          <Typography.Paragraph>{t("mobile.server.members.expires")}</Typography.Paragraph>
        </SettingsRow>
      </SettingsSection>
      {error}
      {canManage ? (
        <SettingsSection>
          <SettingsRow
            disclosure={false}
            disabled={action.isPending}
            onPress={() =>
              Alert.alert(t("mobile.server.members.revokeTitle"), t("mobile.server.members.revokeBody"), [
                { text: t("common.cancel"), style: "cancel" },
                {
                  text: t("mobile.server.members.revoke"),
                  style: "destructive",
                  onPress: () =>
                    void perform(() => runTeamEffect(teamDirectory.revokeInvite(invite.inviteId))).then((revoked) => {
                      if (revoked) router.back();
                    }),
                },
              ])
            }
          >
            <Typography.Paragraph className="text-danger-text">
              {t("mobile.server.members.revokeInvitation")}
            </Typography.Paragraph>
          </SettingsRow>
        </SettingsSection>
      ) : null}
    </SettingsContent>
  );
}

/**
 * The centered portrait, name and email at the top of the page, as Profile has. The initials come
 * from `name`; `label` is the shown text, such as "Norbi (you)".
 */
function Identity({ name, label, detail }: { name: string; label: string; detail: string | null }) {
  return (
    <View className="items-center gap-3">
      <ProfileAvatar neutral name={name} size={88} />
      <View className="items-center gap-1 self-stretch px-4">
        <Typography.Heading type="h4" align="center" numberOfLines={2}>
          {label}
        </Typography.Heading>
        {detail ? (
          <Typography.Paragraph selectable align="center" type="body-sm" className="text-grouped-secondary">
            {detail}
          </Typography.Paragraph>
        ) : null}
      </View>
    </View>
  );
}
