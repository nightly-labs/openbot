import { router, useLocalSearchParams } from "expo-router";
import { Typography } from "heroui-native";
import { HeaderAddAction } from "@/features/servers/components/header-add-action";
import { SERVER_ROLE_LABEL_KEYS } from "@/features/servers/model/server-role";
import { useServerMembers } from "@/features/servers/model/use-server-members";
import { memberRoleNames, useServerRoles } from "@/features/servers/model/use-server-roles";
import {
  SettingsContent,
  SettingsNote,
  SettingsRow,
  SettingsSection,
} from "@/features/settings/components/settings-content";
import { ProfileAvatar } from "@/shared/components/profile-avatar";
import { useText } from "@/shared/lib/text";

/**
 * Server sheet > Members: the people of the server and the email invitations that wait for an
 * answer. An owner or admin opens a person to manage them, and invites people with the header "+".
 */
export function ServerMembersScreen() {
  const { t } = useText();
  const { serverId } = useLocalSearchParams<{ serverId: string }>();
  const { server, canManage, members, invites, activeMembers, pendingInvites, memberLimit, refresh } =
    useServerMembers(serverId);
  const roles = useServerRoles(serverId);
  if (!server)
    return (
      <SettingsContent>
        <SettingsNote>{t("mobile.server.unavailable")}</SettingsNote>
      </SettingsContent>
    );
  const invited = pendingInvites?.filter((invite) => invite.email) ?? [];
  const label = (role: string) => (
    <Typography.Paragraph className="text-grouped-secondary">{role}</Typography.Paragraph>
  );
  return (
    <SettingsContent>
      {canManage ? (
        <HeaderAddAction
          label={t("mobile.server.members.invitePeople")}
          onPress={() => router.push({ pathname: "/server-settings/invite", params: { serverId } })}
        />
      ) : null}
      <SettingsSection
        title={
          activeMembers
            ? t("mobile.server.members.limitCount", { count: activeMembers.length, limit: memberLimit })
            : undefined
        }
        footer={
          members.isError
            ? t("mobile.server.members.loadFailed")
            : invites.isError
              ? t("mobile.server.members.invitationsLoadFailed")
              : undefined
        }
      >
        {members.isPending && !members.isError ? (
          <SettingsRow disclosure={false}>
            <Typography.Paragraph className="text-grouped-secondary">
              {t("mobile.server.members.loading")}
            </Typography.Paragraph>
          </SettingsRow>
        ) : null}
        {activeMembers?.map((member) => {
          const name = member.name || member.email;
          const self = member.membershipId === server.membershipId;
          // Roles apply only to a member: an owner or admin can use all agents.
          const customRoles = member.role === "member" ? memberRoleNames(roles.list, member.membershipId) : [];
          const role = customRoles.length > 0 ? customRoles.join(" · ") : t(SERVER_ROLE_LABEL_KEYS[member.role]);
          return (
            <SettingsRow
              key={member.membershipId}
              disclosure={false}
              leading={<ProfileAvatar neutral name={name} size={36} />}
              trailing={label(role)}
              accessibilityLabel={t("mobile.server.members.rowLabel", { name, role })}
              onPress={() =>
                router.push({
                  pathname: "/server-settings/member",
                  params: { serverId, membershipId: member.membershipId },
                })
              }
            >
              <Typography.Paragraph numberOfLines={1}>
                {self ? t("mobile.server.members.you", { name }) : name}
              </Typography.Paragraph>
            </SettingsRow>
          );
        })}
        {invited.map((invite) => (
          <SettingsRow
            key={invite.inviteId}
            disclosure={false}
            leading={<ProfileAvatar neutral name={invite.email ?? ""} size={36} />}
            trailing={label(t("mobile.server.members.invited"))}
            accessibilityLabel={t("mobile.server.members.rowLabel", {
              name: invite.email ?? "",
              role: t("mobile.server.members.invited"),
            })}
            onPress={() =>
              router.push({ pathname: "/server-settings/member", params: { serverId, inviteId: invite.inviteId } })
            }
          >
            <Typography.Paragraph numberOfLines={1}>{invite.email}</Typography.Paragraph>
          </SettingsRow>
        ))}
        {members.isSuccess && activeMembers?.length === 0 && invited.length === 0 ? (
          <SettingsRow disclosure={false}>
            <Typography.Paragraph className="text-grouped-secondary">
              {t("mobile.server.members.empty")}
            </Typography.Paragraph>
          </SettingsRow>
        ) : null}
        {members.isError || invites.isError ? (
          <SettingsRow disclosure={false} disabled={members.isFetching || invites.isFetching} onPress={refresh}>
            <Typography.Paragraph className="text-accent">{t("mobile.server.members.retry")}</Typography.Paragraph>
          </SettingsRow>
        ) : null}
      </SettingsSection>
    </SettingsContent>
  );
}
