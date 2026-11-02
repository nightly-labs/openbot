import { useLocalSearchParams } from "expo-router";
import { Typography } from "heroui-native";
import { useUniwind } from "uniwind";
import { useServerMembers } from "@/features/servers/model/use-server-members";
import { setRoleMember, useServerRoles } from "@/features/servers/model/use-server-roles";
import {
  SettingsContent,
  SettingsNote,
  SettingsRow,
  SettingsSection,
} from "@/features/settings/components/settings-content";
import { SettingsSwitch } from "@/features/settings/components/settings-controls";
import { haptics } from "@/shared/lib/haptics";
import { useText } from "@/shared/lib/text";

/**
 * Server sheet > Members > one member > Roles: a switch for each role of the server. Server settings >
 * Roles creates, edits and deletes the roles.
 */
export function ServerMemberRolesScreen() {
  const { t, errorMessage } = useText();
  const { theme } = useUniwind();
  const { serverId, membershipId } = useLocalSearchParams<{ serverId: string; membershipId: string }>();
  const { members } = useServerMembers(serverId);
  const { available, roles, action, list, save } = useServerRoles(serverId);
  const member = members.data?.find(
    (candidate) => candidate.membershipId === membershipId && candidate.status === "active",
  );
  if (!available || !member || member.role !== "member" || !list)
    return (
      <SettingsContent>
        <SettingsNote>
          {!available
            ? t("mobile.server.roles.unavailable")
            : roles.isError
              ? errorMessage(roles.error, t("mobile.server.roles.loadFailed"))
              : members.isError
                ? errorMessage(members.error, t("mobile.server.members.loadFailed"))
                : !list || members.isPending
                  ? t("mobile.server.roles.loading")
                  : !member
                    ? t("mobile.server.members.gone")
                    : // Roles apply only to a member.
                      t("mobile.server.roles.memberAdmin")}
        </SettingsNote>
        {roles.isError ? (
          <SettingsSection>
            <SettingsRow disclosure={false} disabled={roles.isFetching} onPress={() => void roles.refetch()}>
              <Typography.Paragraph className="text-accent">{t("mobile.server.members.retry")}</Typography.Paragraph>
            </SettingsRow>
          </SettingsSection>
        ) : null}
      </SettingsContent>
    );
  const name = member.name || member.email;
  return (
    <SettingsContent>
      <SettingsSection
        title={t("mobile.server.roles.memberTitle", { name })}
        footer={
          action.error
            ? errorMessage(action.error, t("mobile.server.roles.saveFailed"))
            : t("mobile.server.roles.memberHint")
        }
      >
        {list.length === 0 ? (
          <SettingsRow disclosure={false}>
            <Typography.Paragraph className="text-grouped-secondary">
              {t("mobile.server.roles.memberEmpty")}
            </Typography.Paragraph>
          </SettingsRow>
        ) : null}
        {list.map((role) => (
          <SettingsRow key={role.id}>
            <SettingsSwitch
              value={role.memberIds.includes(member.membershipId)}
              disabled={action.isPending}
              label={role.name}
              dark={theme === "dark"}
              onValueChange={(on) => {
                void haptics.selection();
                void save((change) => setRoleMember(change, role.id, member.membershipId, on));
              }}
            />
          </SettingsRow>
        ))}
      </SettingsSection>
    </SettingsContent>
  );
}
