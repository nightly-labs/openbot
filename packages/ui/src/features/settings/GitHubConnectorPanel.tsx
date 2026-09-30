import type { GitHubConnectorRepositories, GitHubConnectorStatus } from "@openbot/contracts/ipc";
import {
  Alert,
  AlertContent,
  AlertDescription,
  AlertIcon,
  AlertTitle,
  Badge,
  Button,
  CopyButton,
  ExternalLink,
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
  OctagonX,
  SettingsSection,
  Text,
} from "@openbot/ui";
import { For, Match, Show, Switch } from "solid-js";
import { useText } from "../../text";

export interface GitHubConnectorPanelProps {
  status: GitHubConnectorStatus;
  /** True while an action runs. Every button waits for it. */
  busy: boolean;
  /** Null while the first list is read. */
  repositories: GitHubConnectorRepositories | null;
  /** Why the last list could not be read. */
  repositoriesError: string | null;
  onConnect: () => void;
  onCancel: () => void;
  onDisconnect: () => void;
  onOpenVerification: () => void;
  onOpenInstall: () => void;
}

/**
 * The GitHub connection of one OpenBot computer, in its four states. The token never reaches this
 * component: the status holds the account name and, during a sign-in, the code that the user types.
 */
export function GitHubConnectorPanel(props: GitHubConnectorPanelProps) {
  const { t, sourceText } = useText();
  return (
    <SettingsSection title={t("connector.github.title")} description={t("connector.github.description")}>
      {/* The expired row already tells the user why. */}
      <Show when={props.status.state !== "expired" && props.status.error}>
        {(message) => (
          <Alert tone="danger" role="alert">
            <AlertIcon>
              <OctagonX />
            </AlertIcon>
            <AlertContent>
              <AlertTitle>{t("connector.github.actionFailed")}</AlertTitle>
              <AlertDescription>{sourceText(message())}</AlertDescription>
            </AlertContent>
          </Alert>
        )}
      </Show>
      <ItemGroup class="settings-modal-card">
        <Switch>
          <Match when={props.status.state === "pending"}>
            <Item class="settings-modal-row">
              <ItemContent>
                <ItemTitle>{t("connector.github.pendingTitle")}</ItemTitle>
                {/* On the container, so a reader hears the code that replaces the waiting text. */}
                <ItemDescription aria-live="polite">
                  <Show when={props.status.userCode} fallback={t("connector.github.waiting")}>
                    {(code) => (
                      <Text as="strong" variant="label">
                        {code()}
                      </Text>
                    )}
                  </Show>
                </ItemDescription>
                <Show when={props.status.userCode}>
                  <ItemDescription>{t("connector.github.pendingDescription")}</ItemDescription>
                </Show>
              </ItemContent>
              <ItemActions>
                <Show when={props.status.userCode}>
                  {(code) => (
                    <CopyButton
                      value={code()}
                      size="sm"
                      label={t("connector.github.copyCode")}
                      copiedLabel={t("connector.github.codeCopied")}
                    />
                  )}
                </Show>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={!props.status.verificationUri}
                  onClick={props.onOpenVerification}
                >
                  <ExternalLink size={14} aria-hidden="true" />
                  {t("connector.github.openGitHub")}
                </Button>
                <Button type="button" size="sm" variant="ghost" onClick={props.onCancel}>
                  {t("connector.github.cancel")}
                </Button>
              </ItemActions>
            </Item>
          </Match>
          <Match when={props.status.state === "connected"}>
            <Item class="settings-modal-row">
              <ItemContent>
                <ItemTitle>{t("connector.github.connectedAs", { login: props.status.login ?? "" })}</ItemTitle>
                <ItemDescription>{t("connector.github.disconnectDescription")}</ItemDescription>
              </ItemContent>
              <ItemActions>
                <Button
                  type="button"
                  size="sm"
                  variant="destructive-ghost"
                  loading={props.busy}
                  onClick={props.onDisconnect}
                >
                  {t("connector.github.disconnect")}
                </Button>
              </ItemActions>
            </Item>
            <Item class="settings-modal-row">
              <ItemContent>
                <ItemTitle>{t("connector.github.repositoriesTitle")}</ItemTitle>
                <ItemDescription>{t("connector.github.repositoriesDescription")}</ItemDescription>
              </ItemContent>
              <ItemActions>
                <Button type="button" size="sm" variant="outline" disabled={props.busy} onClick={props.onOpenInstall}>
                  <ExternalLink size={14} aria-hidden="true" />
                  {t("connector.github.chooseRepositories")}
                </Button>
              </ItemActions>
            </Item>
            <div class="github-connector-repositories">
              <Show when={props.repositoriesError}>
                {(message) => (
                  <Text tone="danger" variant="caption" role="alert">
                    {message()}
                  </Text>
                )}
              </Show>
              <Show
                when={props.repositories}
                fallback={
                  <Show when={!props.repositoriesError}>
                    <Text tone="muted" variant="caption">
                      {t("connector.github.repositoriesLoading")}
                    </Text>
                  </Show>
                }
              >
                {(list) => (
                  <Show
                    when={list().repositories.length > 0}
                    fallback={
                      <Text tone="muted" variant="caption">
                        {t("connector.github.noRepositories")}
                      </Text>
                    }
                  >
                    <ul class="github-connector-repository-list" aria-label={t("connector.github.repositoriesTitle")}>
                      <For each={list().repositories} keyed={(repository) => repository.fullName}>
                        {(repository) => (
                          <li class="github-connector-repository">
                            <Text as="span" truncate>
                              {repository().fullName}
                            </Text>
                            <Show when={repository().private}>
                              <Badge variant="secondary">{t("connector.github.private")}</Badge>
                            </Show>
                          </li>
                        )}
                      </For>
                    </ul>
                    <Show when={list().total > list().repositories.length}>
                      <Text tone="muted" variant="caption">
                        {t("connector.github.moreRepositories", { count: list().total - list().repositories.length })}
                      </Text>
                    </Show>
                  </Show>
                )}
              </Show>
            </div>
          </Match>
          <Match when={props.status.state === "expired"}>
            <Item class="settings-modal-row">
              <ItemContent>
                <ItemTitle>{t("connector.github.expiredTitle")}</ItemTitle>
                <ItemDescription>
                  {t("connector.github.expiredDescription", { login: props.status.login ?? "" })}
                </ItemDescription>
              </ItemContent>
              <ItemActions>
                <Button type="button" size="sm" loading={props.busy} onClick={props.onConnect}>
                  {t("connector.github.reconnect")}
                </Button>
                <Button type="button" size="sm" variant="ghost" disabled={props.busy} onClick={props.onDisconnect}>
                  {t("connector.github.disconnect")}
                </Button>
              </ItemActions>
            </Item>
          </Match>
          <Match when={props.status.state === "disconnected"}>
            <Item class="settings-modal-row">
              <ItemContent>
                <ItemTitle>{t("connector.github.title")}</ItemTitle>
                <ItemDescription>{t("connector.github.repositoriesDescription")}</ItemDescription>
              </ItemContent>
              <ItemActions>
                <Button type="button" size="sm" loading={props.busy} onClick={props.onConnect}>
                  {t("connector.github.connect")}
                </Button>
              </ItemActions>
            </Item>
          </Match>
        </Switch>
      </ItemGroup>
    </SettingsSection>
  );
}
