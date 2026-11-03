import type { ConnectorAccessRule, ConnectorAccessSnapshot } from "@openbot/contracts/ipc";
import { createUniqueId, For, Show } from "solid-js";
import { Button, Checkbox, Text } from "../../index";
import { useText } from "../../text";
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
    <section class="server-roles">
      <Text variant="label">{t("server.roles.connectors")}</Text>
      <Text variant="body-sm">{t("server.roles.connectorScope")}</Text>
      <Show when={props.snapshot.closed}>
        <Text variant="body-sm">{t("server.roles.connectorClosed")}</Text>
        <Button disabled={props.disabled} onClick={props.onRecover}>
          {t("server.roles.connectorRecover")}
        </Button>
      </Show>
      <For each={rows()}>
        {(connector) => {
          const rule = () => props.snapshot.rules.find((item) => item.mcpServerId === connector.id);
          return (
            <fieldset disabled={props.disabled || props.snapshot.closed} class="server-role-agents">
              <legend>{connector.name}</legend>
              <Show
                when={rule()}
                fallback={
                  <Button
                    variant="secondary"
                    onClick={() =>
                      props.onChange({ mcpServerId: connector.id, agentIds: [], roleIds: [], everyoneUse: false })
                    }
                  >
                    {t("server.roles.protectConnector")}
                  </Button>
                }
              >
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
                      <Text variant="body-sm">{t("server.roles.connectorHistory")}</Text>
                      <Show when={props.page.kind !== "list"}>
                        <label for={`${inputId}-${connector.id}-use`}>
                          <Checkbox
                            id={`${inputId}-${connector.id}-use`}
                            checked={selected()}
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
                          {t("server.roles.useConnector")}
                        </label>
                      </Show>
                      <Text variant="body-sm">{t("server.roles.connectorAgents")}</Text>
                      <For each={props.agents}>
                        {(agent) => (
                          <label class="server-role-agent" for={`${inputId}-${connector.id}-${agent.id}`}>
                            <Checkbox
                              id={`${inputId}-${connector.id}-${agent.id}`}
                              checked={binding().agentIds.includes(agent.id)}
                              onChange={(event) =>
                                edit({
                                  agentIds: event.currentTarget.checked
                                    ? [...binding().agentIds.filter((id) => id !== agent.id), agent.id]
                                    : binding().agentIds.filter((id) => id !== agent.id),
                                })
                              }
                            />
                            {agent.name}
                          </label>
                        )}
                      </For>
                    </>
                  );
                }}
              </Show>
            </fieldset>
          );
        }}
      </For>
    </section>
  );
}
