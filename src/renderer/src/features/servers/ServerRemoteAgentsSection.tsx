import { type DynamicRecord, isDynamicRecord, isString } from "@openbot/contracts/runtime-values";
import {
  Alert,
  AlertContent,
  AlertDescription,
  Button,
  CopyButton,
  Field,
  Input,
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
  SettingsSection,
  Text,
} from "@openbot/ui";
import { useText } from "@openbot/ui/text";
import { createSignal, For, Show } from "solid-js";

export interface RemoteAgentBridgeCalls {
  list(serverId: string): Promise<{
    invites: { inviteId: string; code: string; expiresAt: string; serverName: string }[];
    links: { linkId: string; peerName: string; createdAt: string }[];
  }>;
  createInvite(serverId: string): Promise<{ inviteId: string; code: string; expiresAt: string }>;
  revokeInvite(inviteId: string, serverId: string): Promise<void>;
  redeem(code: string, serverId: string): Promise<{ linkId: string; peerName: string }>;
  revokeLink(linkId: string, serverId: string): Promise<void>;
}

function bridgeRecord(value: unknown): DynamicRecord {
  if (!isDynamicRecord(value)) throw new Error("Invalid server link.");
  return value;
}

export function decodeBridgeInvite(value: unknown): {
  inviteId: string;
  code: string;
  expiresAt: string;
  serverName: string;
} {
  const record = bridgeRecord(value);
  if (!isString(record.inviteId) || !isString(record.expiresAt) || !isString(record.serverName))
    throw new Error("Invalid server link.");
  return {
    inviteId: record.inviteId,
    code: isString(record.code) ? record.code : "",
    expiresAt: record.expiresAt,
    serverName: record.serverName,
  };
}

export function decodeBridgeInvites(value: unknown): ReturnType<typeof decodeBridgeInvite>[] {
  const record = bridgeRecord(value);
  if (!Array.isArray(record.invites)) throw new Error("Invalid server link.");
  return record.invites.map(decodeBridgeInvite);
}

export function decodeBridgeLink(value: unknown): {
  linkId: string;
  peerName: string;
  peerReach: string;
  createdAt: string;
} {
  const record = bridgeRecord(value);
  if (!isString(record.linkId) || !isString(record.peerName) || !isString(record.createdAt))
    throw new Error("Invalid server link.");
  return {
    linkId: record.linkId,
    peerName: record.peerName,
    peerReach: isString(record.peerReach) ? record.peerReach : "",
    createdAt: record.createdAt,
  };
}

export function decodeBridgeLinks(value: unknown): ReturnType<typeof decodeBridgeLink>[] {
  const record = bridgeRecord(value);
  if (!Array.isArray(record.links)) throw new Error("Invalid server link.");
  return record.links.map(decodeBridgeLink);
}

/** Owner or admin links this server to another. Hidden when the host has no remote-agent-bridge-v1. */
export function ServerRemoteAgentsSection(props: { serverId: string; calls: RemoteAgentBridgeCalls }) {
  const { t } = useText();
  const [invites, setInvites] = createSignal<
    { inviteId: string; code: string; expiresAt: string; serverName: string }[]
  >([]);
  const [links, setLinks] = createSignal<{ linkId: string; peerName: string; createdAt: string }[]>([]);
  const [code, setCode] = createSignal("");
  const [created, setCreated] = createSignal<string | null>(null);
  const [error, setError] = createSignal<string | null>(null);

  async function reload(): Promise<void> {
    const snapshot = await props.calls.list(props.serverId);
    setInvites(snapshot.invites);
    setLinks(snapshot.links);
  }

  async function run(action: () => Promise<void>): Promise<void> {
    setError(null);
    try {
      await action();
      await reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  void reload().catch((cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)));

  return (
    <SettingsSection
      title={t("server.settings.remoteAgentsTitle")}
      description={t("server.settings.remoteAgentsDescription")}
    >
      <Show when={error()}>
        {(message) => (
          <Alert tone="danger" role="alert">
            <AlertContent>
              <AlertDescription>{message()}</AlertDescription>
            </AlertContent>
          </Alert>
        )}
      </Show>
      <ItemGroup class="settings-modal-card">
        <Item>
          <ItemContent>
            <ItemTitle>{t("server.settings.remoteAgentsCreate")}</ItemTitle>
          </ItemContent>
          <ItemActions>
            <Button
              type="button"
              variant="secondary"
              onClick={() =>
                void run(async () => {
                  const invite = await props.calls.createInvite(props.serverId);
                  setCreated(invite.code);
                })
              }
            >
              {t("server.settings.remoteAgentsCreate")}
            </Button>
          </ItemActions>
        </Item>
        <Show when={created()}>
          {(value) => (
            <Item>
              <ItemContent>
                <ItemTitle>{t("server.settings.remoteAgentsCode")}</ItemTitle>
                <ItemDescription>
                  <Text class="font-mono">{value()}</Text>
                </ItemDescription>
              </ItemContent>
              <ItemActions>
                <CopyButton
                  value={value()}
                  label={t("server.settings.remoteAgentsCode")}
                  copiedLabel={t("common.copied")}
                  size="sm"
                  variant="default"
                />
              </ItemActions>
            </Item>
          )}
        </Show>
        <Item>
          <ItemContent>
            <Field label={t("server.settings.remoteAgentsPaste")}>
              <Input value={code()} onInput={(event) => setCode(event.currentTarget.value)} />
            </Field>
          </ItemContent>
          <ItemActions>
            <Button
              type="button"
              disabled={!code().trim()}
              onClick={() => {
                const next = code().trim();
                if (!next) return;
                void run(async () => {
                  await props.calls.redeem(next, props.serverId);
                  setCode("");
                });
              }}
            >
              {t("server.settings.remoteAgentsPaste")}
            </Button>
          </ItemActions>
        </Item>
      </ItemGroup>
      <Show when={invites().length === 0 && links().length === 0}>
        <ItemDescription>{t("server.settings.remoteAgentsEmpty")}</ItemDescription>
      </Show>
      <Show when={invites().length > 0 || links().length > 0}>
        <ItemGroup class="settings-modal-card">
          <For each={invites()}>
            {(invite) => (
              <Item>
                <ItemContent>
                  <ItemTitle>{t("server.settings.remoteAgentsExpires", { date: invite.expiresAt })}</ItemTitle>
                </ItemContent>
                <ItemActions>
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => void run(() => props.calls.revokeInvite(invite.inviteId, props.serverId))}
                  >
                    {t("server.settings.remoteAgentsRevoke")}
                  </Button>
                </ItemActions>
              </Item>
            )}
          </For>
          <For each={links()}>
            {(link) => (
              <Item>
                <ItemContent>
                  <ItemTitle>{link.peerName}</ItemTitle>
                </ItemContent>
                <ItemActions>
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => void run(() => props.calls.revokeLink(link.linkId, props.serverId))}
                  >
                    {t("server.settings.remoteAgentsRevoke")}
                  </Button>
                </ItemActions>
              </Item>
            )}
          </For>
        </ItemGroup>
      </Show>
    </SettingsSection>
  );
}
