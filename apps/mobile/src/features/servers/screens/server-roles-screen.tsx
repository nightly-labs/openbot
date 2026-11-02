import * as Crypto from "expo-crypto";
import { router, useLocalSearchParams } from "expo-router";
import { Typography } from "heroui-native";
import { HeaderAddAction } from "@/features/servers/components/header-add-action";
import { everyoneLevel, roleLevel, useServerRoles } from "@/features/servers/model/use-server-roles";
import {
  SettingsContent,
  SettingsNote,
  SettingsRow,
  SettingsSection,
} from "@/features/settings/components/settings-content";
import { useText } from "@/shared/lib/text";

/**
 * Server sheet > Server settings > Roles: Everyone, then the roles that add agents for their members. An
 * owner or admin opens a role to set its agents, and creates a role with the header "+".
 */
export function ServerRolesScreen() {
  const { t, errorMessage } = useText();
  const { serverId } = useLocalSearchParams<{ serverId: string }>();
  const { available, roles, action, everyone, list, agents, save } = useServerRoles(serverId);
  if (!available)
    return (
      <SettingsContent>
        <SettingsNote>{t("mobile.server.roles.unavailable")}</SettingsNote>
      </SettingsContent>
    );
  if (!everyone || !list)
    return (
      <SettingsContent>
        <SettingsNote>
          {roles.isError
            ? errorMessage(roles.error, t("mobile.server.roles.loadFailed"))
            : t("mobile.server.roles.loading")}
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
  const agentCount = (count: number) => t("mobile.server.roles.agentCount", { count });
  const open = (params: { roleId: string } | { everyone: "1" }) =>
    router.push({ pathname: "/server-settings/role", params: { serverId, ...params } });
  return (
    <SettingsContent>
      <HeaderAddAction
        label={t("mobile.server.roles.create")}
        onPress={() => {
          if (action.isPending) return;
          const roleId = Crypto.randomUUID();
          void save((change) => {
            change.roles.push({ id: roleId, name: t("mobile.server.roles.newRole"), agents: {}, memberIds: [] });
          }).then((created) => {
            if (created) open({ roleId });
          });
        }}
      />
      <SettingsNote>{t("mobile.server.roles.description")}</SettingsNote>
      <SettingsSection footer={t("mobile.server.roles.everyoneHint")}>
        <SettingsRow
          supportingText={agentCount(agents.filter((agent) => everyoneLevel(everyone, agent.id) !== "none").length)}
          onPress={() => open({ everyone: "1" })}
        >
          <Typography.Paragraph>{t("mobile.server.roles.everyone")}</Typography.Paragraph>
        </SettingsRow>
      </SettingsSection>
      <SettingsSection
        title={t("mobile.server.roles.title")}
        footer={
          action.error
            ? errorMessage(action.error, t("mobile.server.roles.saveFailed"))
            : t("mobile.server.roles.assignHint")
        }
      >
        {list.length === 0 ? (
          <SettingsRow disclosure={false}>
            <Typography.Paragraph className="text-grouped-secondary">
              {t("mobile.server.roles.empty")}
            </Typography.Paragraph>
          </SettingsRow>
        ) : null}
        {list.map((role) => (
          <SettingsRow
            key={role.id}
            supportingText={agentCount(agents.filter((agent) => roleLevel(role, agent.id) !== "none").length)}
            trailing={
              <Typography.Paragraph className="text-grouped-secondary">
                {t("mobile.server.roles.memberCount", { count: role.memberIds.length })}
              </Typography.Paragraph>
            }
            onPress={() => open({ roleId: role.id })}
          >
            <Typography.Paragraph numberOfLines={1}>{role.name}</Typography.Paragraph>
          </SettingsRow>
        ))}
      </SettingsSection>
    </SettingsContent>
  );
}
