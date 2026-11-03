import type { ConnectorAccessRule, ConnectorAccessSnapshot } from "@openbot/contracts/ipc";
import { createUniqueId, For, Show } from "solid-js";
import {
  Button,
  Checkbox,
  Item,
  ItemActions,
  ItemContent,
  ItemGroup,
  ItemMedia,
  ItemTitle,
  SettingsSection,
  Text,
} from "../../index";
import { useText } from "../../text";
import { AgentAvatar } from "../agents/AgentAvatar";
import type { RoleAgent, ServerRolePage } from "./ServerRoles";

export function ConnectorAccessPanel(props: {
  snapshot: ConnectorAccessSnapshot;
  agents: readonly RoleAgent[];
  page: ServerRolePage;
  disabled: boolean;
  onChange: (rule: ConnectorAccessRule) => void;
  onRecover: () => void;
}) {
  const { t } = useText();
  const inputId = createUniqueId();
  const grantRole = () => (props.page.kind === "role" ? props.page.roleId : null);
  const rows = () => [
    ...props.snapshot.connectors,
    ...props.snapshot.rules
      .filter((rule) => !props.snapshot.connectors.some((item) => item.id === rule.mcpServerId))
      .map((rule) => ({ id: rule.mcpServerId, name: rule.mcpServerId })),
  ];
  return (
    <SettingsSection title={t("server.roles.connectors")} description={t("server.roles.connectorScope")}>
      <Show when={props.snapshot.closed}>
        <ItemGroup class="settings-modal-card">
          <Item class="settings-modal-row">
            <ItemContent>
              <Text variant="body-sm">{t("server.roles.connectorClosed")}</Text>
            </ItemContent>
            <ItemActions>
              <Button disabled={props.disabled} onClick={props.onRecover}>
                {t("server.roles.connectorRecover")}
              </Button>
            </ItemActions>
          </Item>
        </ItemGroup>
      </Show>
      <For each={rows()}>
        {(connector) => {
          const rule = () => props.snapshot.rules.find((item) => item.mcpServerId === connector.id);
          const disabled = () => props.disabled || props.snapshot.closed;
          return (
            <SettingsSection
              title={connector.name}
              description={rule() ? t("server.roles.connectorHistory") : undefined}
              actions={
                <Show when={!rule()}>
                  <Button
                    variant="secondary"
                    disabled={disabled()}
                    onClick={() =>
                      props.onChange({ mcpServerId: connector.id, agentIds: [], roleIds: [], everyoneUse: false })
                    }
                  >
                    {t("server.roles.protectConnector")}
                  </Button>
                </Show>
              }
            >
              <Show when={rule()}>
                {(binding) => {
                  const edit = (change: Partial<ConnectorAccessRule>) => {
                    const { mcpServerId, agentIds, everyoneUse, roleIds } = binding();
                    props.onChange({ mcpServerId, agentIds, everyoneUse, roleIds, ...change });
                  };
                  const selected = () => {
                    const role = grantRole();
                    return role ? binding().roleIds.includes(role) : binding().everyoneUse;
                  };
                  return (
                    <>
                      <Show when={props.page.kind !== "list"}>
                        <ItemGroup class="settings-modal-card">
                          <Item class="settings-modal-row">
                            <ItemContent>
                              <ItemTitle>
                                <label for={`${inputId}-${connector.id}-use`}>{t("server.roles.useConnector")}</label>
                              </ItemTitle>
                            </ItemContent>
                            <ItemActions>
                              <Checkbox
                                id={`${inputId}-${connector.id}-use`}
                                checked={selected()}
                                disabled={disabled()}
                                onChange={(event) => {
                                  const role = grantRole();
                                  edit(
                                    role
                                      ? {
                                          roleIds: event.currentTarget.checked
                                            ? [...binding().roleIds.filter((id) => id !== role), role]
                                            : binding().roleIds.filter((id) => id !== role),
                                        }
                                      : { everyoneUse: event.currentTarget.checked },
                                  );
                                }}
                              />
                            </ItemActions>
                          </Item>
                        </ItemGroup>
                      </Show>
                      <SettingsSection title={t("server.roles.connectorAgents")}>
                        <ItemGroup class="settings-modal-card">
                          <For each={props.agents}>
                            {(agent) => (
                              <Item class="settings-modal-row">
                                <ItemMedia>
                                  <span class="integrations-agent-face" data-size="md">
                                    <AgentAvatar agent={agent} motion="idle" />
                                  </span>
                                </ItemMedia>
                                <ItemContent>
                                  <ItemTitle>
                                    <label for={`${inputId}-${connector.id}-${agent.id}`}>{agent.name}</label>
                                  </ItemTitle>
                                </ItemContent>
                                <ItemActions>
                                  <Checkbox
                                    id={`${inputId}-${connector.id}-${agent.id}`}
                                    checked={binding().agentIds.includes(agent.id)}
                                    disabled={disabled()}
                                    onChange={(event) =>
                                      edit({
                                        agentIds: event.currentTarget.checked
                                          ? [...binding().agentIds.filter((id) => id !== agent.id), agent.id]
                                          : binding().agentIds.filter((id) => id !== agent.id),
                                      })
                                    }
                                  />
                                </ItemActions>
                              </Item>
                            )}
                          </For>
                        </ItemGroup>
                      </SettingsSection>
                    </>
                  );
                }}
              </Show>
            </SettingsSection>
          );
        }}
      </For>
    </SettingsSection>
  );
}
