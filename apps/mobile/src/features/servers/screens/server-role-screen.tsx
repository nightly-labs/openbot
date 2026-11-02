import { AGENT_ACCESS_LEVELS, AGENT_ACCESS_ROLE_NAME_LIMIT, type AgentAccessLevel } from "@openbot/contracts/ipc";
import type { MobileTextKey } from "@openbot/i18n/mobile";
import { router, useLocalSearchParams } from "expo-router";
import { usePreventRemove } from "expo-router/react-navigation";
import { Typography } from "heroui-native";
import { useRef, useState } from "react";
import { Alert } from "react-native";
import { useUniwind } from "uniwind";
import { BloubAvatar } from "@/features/agents/components/bloub-avatar";
import { everyoneLevel, roleLevel, useServerRoles } from "@/features/servers/model/use-server-roles";
import {
  SettingsContent,
  SettingsNote,
  SettingsRow,
  SettingsSection,
} from "@/features/settings/components/settings-content";
import { SettingsPicker } from "@/features/settings/components/settings-controls";
import { SheetFormField } from "@/shared/components/sheet-form-field";
import { SheetSaveAction } from "@/shared/components/sheet-save-action";
import { haptics } from "@/shared/lib/haptics";
import { useText } from "@/shared/lib/text";

const LEVEL_KEYS = {
  none: "mobile.server.roles.level.none",
  view: "mobile.server.roles.level.view",
  chat: "mobile.server.roles.level.chat",
  manage: "mobile.server.roles.level.manage",
} as const satisfies Record<AgentAccessLevel, MobileTextKey>;

/**
 * Server sheet > Server settings > Roles > one role, or Everyone: the access that it gives to each agent.
 * Each level saves at once. A role also has its name, which saves with the header action, and Delete.
 */
export function ServerRoleScreen() {
  const { t, errorMessage } = useText();
  const { theme } = useUniwind();
  const {
    serverId,
    roleId,
    everyone: everyonePage,
  } = useLocalSearchParams<{
    serverId: string;
    roleId?: string;
    everyone?: string;
  }>();
  const { available, roles, action, everyone, list, agents, save } = useServerRoles(serverId);
  const role = roleId ? list?.find((candidate) => candidate.id === roleId) : undefined;
  const [draftName, setDraftName] = useState<string | undefined>();
  const name = draftName ?? role?.name ?? "";
  const trimmed = name.trim();
  const dirty = Boolean(role) && draftName !== undefined && trimmed !== role?.name;
  /** True after Delete: the page leaves without the question about the name. */
  const leaving = useRef(false);

  // Discard turns prevention off before it repeats the action, so the hook does not warn.
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

  if (!available || !everyone || !list || !(role || everyonePage))
    return (
      <SettingsContent>
        <SettingsNote>
          {!available
            ? t("mobile.server.roles.unavailable")
            : roles.isError
              ? errorMessage(roles.error, t("mobile.server.roles.loadFailed"))
              : !everyone || !list
                ? t("mobile.server.roles.loading")
                : t("mobile.server.roles.gone")}
        </SettingsNote>
      </SettingsContent>
    );

  const title = role ? role.name : t("mobile.server.roles.everyone");
  const level = (agentId: string) => (role ? roleLevel(role, agentId) : everyoneLevel(everyone, agentId));
  const setLevel = (agentId: string, next: AgentAccessLevel) => {
    if (next === level(agentId)) return;
    void haptics.selection();
    void save((change) => {
      if (!role) {
        change.everyone[agentId] = next;
        return;
      }
      const target = change.roles.find((candidate) => candidate.id === role.id);
      if (target) target.agents[agentId] = next;
    });
  };

  return (
    <SettingsContent>
      {role ? (
        <>
          <SheetFormField
            label={t("mobile.server.roles.name")}
            autoCapitalize="words"
            maxLength={AGENT_ACCESS_ROLE_NAME_LIMIT}
            value={name}
            editable={!action.isPending}
            onChangeText={setDraftName}
          />
          <SheetSaveAction
            dirty={dirty}
            canSave={trimmed.length > 0}
            pending={action.isPending}
            onSave={() =>
              void save((change) => {
                const target = change.roles.find((candidate) => candidate.id === role.id);
                if (target) target.name = trimmed;
              }).then((saved) => {
                if (saved) setDraftName(undefined);
              })
            }
          />
        </>
      ) : null}
      <SettingsSection
        title={t("mobile.server.roles.agents")}
        footer={
          action.error
            ? errorMessage(action.error, t("mobile.server.roles.saveFailed"))
            : t(role ? "mobile.server.roles.roleHint" : "mobile.server.roles.everyoneHint")
        }
      >
        {agents.length === 0 ? (
          <SettingsRow disclosure={false}>
            <Typography.Paragraph className="text-grouped-secondary">
              {t("mobile.server.roles.noAgents")}
            </Typography.Paragraph>
          </SettingsRow>
        ) : null}
        {agents.map((agent) => (
          <SettingsRow
            key={agent.id}
            disclosure={false}
            leading={
              <BloubAvatar
                agentId={agent.id}
                serverId={agent.serverId}
                hue={agent.avatarHue}
                seed={agent.avatarSeed}
                size={36}
                animateIdle={false}
              />
            }
            trailing={
              <SettingsPicker
                value={level(agent.id)}
                options={AGENT_ACCESS_LEVELS.map((value) => ({ value, label: t(LEVEL_KEYS[value]) }))}
                enabled={!action.isPending}
                dark={theme === "dark"}
                label={t("mobile.server.roles.agentLevel", { role: title, agent: agent.name })}
                onChange={(next) => setLevel(agent.id, next)}
              />
            }
          >
            <Typography.Paragraph numberOfLines={1}>{agent.name}</Typography.Paragraph>
          </SettingsRow>
        ))}
      </SettingsSection>
      {role ? (
        <SettingsSection>
          <SettingsRow
            disclosure={false}
            disabled={action.isPending}
            onPress={() =>
              Alert.alert(
                t("mobile.server.roles.deleteTitle", { name: role.name }),
                t("mobile.server.roles.deleteBody"),
                [
                  { text: t("common.cancel"), style: "cancel" },
                  {
                    text: t("mobile.server.roles.delete"),
                    style: "destructive",
                    onPress: () =>
                      void save((change) => {
                        change.roles = change.roles.filter((candidate) => candidate.id !== role.id);
                      }).then((deleted) => {
                        if (!deleted) return;
                        leaving.current = true;
                        router.back();
                      }),
                  },
                ],
              )
            }
          >
            <Typography.Paragraph className="text-danger-text">{t("mobile.server.roles.delete")}</Typography.Paragraph>
          </SettingsRow>
        </SettingsSection>
      ) : null}
    </SettingsContent>
  );
}
