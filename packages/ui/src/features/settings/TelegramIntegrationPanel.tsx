import type { MessagingConnection } from "@openbot/contracts/ipc";
import type { AppTextKey } from "@openbot/i18n";
import {
  Alert,
  AlertContent,
  AlertDescription,
  AlertIcon,
  AlertTitle,
  Button,
  Check,
  Input,
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
  Link2Off,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  SettingsSection,
  TriangleAlert,
} from "@openbot/ui";
import { createSignal, For, Match, Show, Switch } from "solid-js";
import { useText } from "../../text";
import { AgentAvatar } from "../agents/AgentAvatar";
import { DetailHeader, type IntegrationStatus, LogoTile, TelegramMark, WizardDialog } from "./IntegrationLayout";
import type { IntegrationAgent } from "./IntegrationsHub";

export type TelegramIntegrationAgent = IntegrationAgent & { title: string };

export interface TelegramIntegrationPanelProps {
  /** Every agent on this computer. */
  agents: TelegramIntegrationAgent[];
  /** The connected Telegram bot(s). */
  connections: MessagingConnection[];
  /** True while an action runs. Every button waits for it. */
  busy: boolean;
  onConnect: (botToken: string) => void;
  onDisconnect: (workspaceId: string) => void;
  onReconnect: (workspaceId: string) => void;
  onSetEnabled: (workspaceId: string, enabled: boolean) => void;
  onSetAgent: (workspaceId: string, agentId: string | null) => void;
}

type RowKind = "live" | "setup" | "paused" | "attention";

function rowKind(connection: MessagingConnection): RowKind {
  switch (connection.state) {
    case "connected":
      return "live";
    case "paused":
      return "paused";
    case "connecting":
    case "reconnecting":
    case "rate_limited":
      return "setup";
    default:
      return "attention";
  }
}

const STATE_HELP: Partial<Record<MessagingConnection["state"], AppTextKey>> = {
  invalid_token: "messaging.help.invalid_token",
  secret_storage_unavailable: "messaging.help.secret_storage_unavailable",
  relay_unavailable: "messaging.help.relay_unavailable",
};

export function telegramAgent<Agent extends { id: string }>(
  connection: MessagingConnection,
  agents: readonly Agent[],
): Agent | null {
  return agents.find((agent) => agent.id === connection.orchestratorAgentId) ?? null;
}

export function telegramIntegrationState(
  connections: readonly MessagingConnection[],
  agents: readonly { id: string }[],
): { status: IntegrationStatus; label: AppTextKey; attention: number } {
  const attention = connections.filter(
    (connection) => rowKind(connection) === "attention" || !telegramAgent(connection, agents),
  ).length;
  if (attention > 0) return { status: "attention", label: "connector.telegram.statusAttention", attention };
  if (connections.length === 0) return { status: "idle", label: "connector.telegram.statusNotSetUp", attention };
  return { status: "connected", label: "connector.telegram.statusConnected", attention };
}

export function TelegramIntegrationPanel(props: TelegramIntegrationPanelProps) {
  const { t } = useText();
  const [token, setToken] = createSignal("");
  const [disconnecting, setDisconnecting] = createSignal<MessagingConnection | null>(null);
  const state = () => telegramIntegrationState(props.connections, props.agents);

  return (
    <div class="slack-integration">
      <DetailHeader
        logo={<TelegramMark />}
        name={t("connector.telegram.title")}
        status={state().status}
        statusLabel={t(state().label)}
        subtitle={t("connector.telegram.description")}
      />

      <Show when={state().attention > 0}>
        <Alert tone="warning" role="alert">
          <AlertIcon>
            <TriangleAlert />
          </AlertIcon>
          <AlertContent>
            <AlertTitle>{t("connector.telegram.attentionTitle", { count: state().attention })}</AlertTitle>
            <AlertDescription>{t("connector.telegram.attentionDescription")}</AlertDescription>
          </AlertContent>
        </Alert>
      </Show>

      <Show when={props.connections.length === 0}>
        <SettingsSection title={t("connector.telegram.connect")}>
          <ItemGroup class="settings-modal-card">
            <Item class="settings-modal-row">
              <ItemContent>
                <ItemTitle>{t("connector.telegram.tokenLabel")}</ItemTitle>
                <ItemDescription>{t("connector.telegram.tokenHelp")}</ItemDescription>
                <div style={{ "margin-top": "12px", display: "flex", gap: "8px" }}>
                  <Input
                    type="password"
                    placeholder={t("connector.telegram.tokenPlaceholder")}
                    value={token()}
                    onInput={(e) => setToken(e.currentTarget.value)}
                    disabled={props.busy}
                  />
                  <Button
                    type="button"
                    size="sm"
                    disabled={props.busy || !token().trim()}
                    loading={props.busy}
                    onClick={() => {
                      if (token().trim()) {
                        props.onConnect(token().trim());
                        setToken("");
                      }
                    }}
                  >
                    {t("connector.telegram.saveToken")}
                  </Button>
                </div>
              </ItemContent>
            </Item>
          </ItemGroup>
        </SettingsSection>
      </Show>

      <Show when={props.connections.length > 0}>
        <SettingsSection title={t("connector.telegram.botTitle")}>
          <ItemGroup class="settings-modal-card">
            <For each={props.connections}>
              {(connection) => (
                <BotRow
                  connection={connection}
                  busy={props.busy}
                  onReconnect={() => props.onReconnect(connection.workspaceId)}
                  onSetEnabled={(enabled) => props.onSetEnabled(connection.workspaceId, enabled)}
                  onDisconnect={() => setDisconnecting(connection)}
                />
              )}
            </For>
          </ItemGroup>
        </SettingsSection>
      </Show>

      <For each={props.connections}>
        {(connection) => {
          const currentAgent = () => telegramAgent(connection, props.agents);
          return (
            <SettingsSection
              title={t("connector.telegram.agentTitle")}
              description={t("connector.telegram.agentDescription")}
            >
              <ItemGroup class="settings-modal-card">
                <Item class="settings-modal-row">
                  <ItemMedia>
                    <Show when={currentAgent()} fallback={<span class="integrations-agent-face" data-size="md" />}>
                      {(agent) => (
                        <span class="integrations-agent-face" data-size="md">
                          <AgentAvatar agent={agent()} motion="idle" />
                        </span>
                      )}
                    </Show>
                  </ItemMedia>
                  <ItemContent>
                    <ItemTitle>
                      {currentAgent()?.name ??
                        t("connector.telegram.summaryNoAgent", { botUsername: connection.workspaceName })}
                    </ItemTitle>
                    <ItemDescription>
                      {currentAgent()?.title ?? t("connector.telegram.agentDescription")}
                    </ItemDescription>
                  </ItemContent>
                  <ItemActions>
                    <Select<TelegramIntegrationAgent>
                      options={props.agents}
                      optionValue="id"
                      optionTextValue="name"
                      value={currentAgent() ?? undefined}
                      onChange={(next) => {
                        if (next && next.id !== currentAgent()?.id) {
                          props.onSetAgent(connection.workspaceId, next.id);
                        }
                      }}
                      itemComponent={(itemProps) => (
                        <SelectItem item={itemProps.item}>{itemProps.item.rawValue.name}</SelectItem>
                      )}
                    >
                      <SelectTrigger size="sm" aria-label={t("connector.telegram.agentSelect")}>
                        <SelectValue<TelegramIntegrationAgent>>
                          {(state) => state.selectedOption()?.name ?? t("connector.telegram.agentSelect")}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent />
                    </Select>
                  </ItemActions>
                </Item>
              </ItemGroup>
            </SettingsSection>
          );
        }}
      </For>

      <DisconnectDialog
        connection={disconnecting()}
        onConfirm={(workspaceId) => {
          setDisconnecting(null);
          props.onDisconnect(workspaceId);
        }}
        onClose={() => setDisconnecting(null)}
      />
    </div>
  );
}

function BotRow(props: {
  connection: MessagingConnection;
  busy: boolean;
  onReconnect: () => void;
  onSetEnabled: (enabled: boolean) => void;
  onDisconnect: () => void;
}) {
  const { t, format } = useText();
  const kind = () => rowKind(props.connection);
  const note = () => {
    const current = props.connection;
    if (current.retryAt)
      return t("connector.slack.retryAt", {
        time: format.date(new Date(current.retryAt), { hour: "numeric", minute: "2-digit" }),
      });
    const help = STATE_HELP[current.state];
    return help ? t(help) : t("connector.telegram.botDescription");
  };
  const label = (action: string) => t("connector.telegram.rowAction", { action, name: props.connection.workspaceName });
  const action = (text: string, onClick: () => void) => (
    <Button type="button" size="sm" variant="outline" disabled={props.busy} aria-label={label(text)} onClick={onClick}>
      {text}
    </Button>
  );
  return (
    <Item class="settings-modal-row" data-status={kind()}>
      <ItemMedia>
        <LogoTile>
          <TelegramMark />
        </LogoTile>
      </ItemMedia>
      <ItemContent>
        <ItemTitle>{props.connection.workspaceName}</ItemTitle>
        <ItemDescription>{note()}</ItemDescription>
      </ItemContent>
      <ItemActions>
        <Switch>
          <Match when={kind() === "attention"}>{action(t("connector.telegram.reconnect"), props.onReconnect)}</Match>
          <Match when={kind() === "paused"}>
            {action(t("connector.telegram.resume"), () => props.onSetEnabled(true))}
          </Match>
          <Match when={kind() === "live"}>
            {action(t("connector.telegram.pause"), () => props.onSetEnabled(false))}
          </Match>
        </Switch>
        <Button
          type="button"
          size="sm"
          variant="destructive-ghost"
          disabled={props.busy}
          aria-label={label(t("connector.telegram.disconnect"))}
          onClick={props.onDisconnect}
        >
          {t("connector.telegram.disconnect")}
        </Button>
      </ItemActions>
    </Item>
  );
}

function DisconnectDialog(props: {
  connection: MessagingConnection | null;
  onConfirm: (workspaceId: string) => void;
  onClose: () => void;
}) {
  const { t } = useText();
  const bot = () => props.connection?.workspaceName ?? "";
  return (
    <WizardDialog
      open={props.connection !== null}
      closeLabel={t("connector.telegram.close")}
      onClose={props.onClose}
      logo={<TelegramMark />}
      link="broken"
      title={t("connector.telegram.disconnectTitle", { bot: bot() })}
      description={t("connector.telegram.disconnectDescription", { bot: bot() })}
      footer={
        <>
          <Button type="button" variant="ghost" onClick={props.onClose}>
            {t("connector.telegram.keep")}
          </Button>
          <Show when={props.connection}>
            {(connection) => (
              <Button
                type="button"
                variant="destructive"
                data-cuelume-tap="close"
                data-cuelume-emphasis="strong"
                onClick={() => props.onConfirm(connection().workspaceId)}
              >
                <Link2Off aria-hidden="true" />
                {t("connector.telegram.disconnect")}
              </Button>
            )}
          </Show>
        </>
      }
    >
      <ul class="slack-effects">
        <li data-tone="danger">
          <span class="slack-effect-icon" aria-hidden="true">
            <Link2Off />
          </span>
          {t("connector.telegram.disconnectEffect")}
        </li>
        <li data-tone="success">
          <span class="slack-effect-icon" aria-hidden="true">
            <Check />
          </span>
          {t("connector.telegram.removeEffectKept")}
        </li>
      </ul>
    </WizardDialog>
  );
}
