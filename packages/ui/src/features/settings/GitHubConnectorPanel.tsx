import type { GitHubConnectorRepositories, GitHubConnectorStatus } from "@openbot/contracts/ipc";
import type { AppTextKey } from "@openbot/i18n";
import {
  Alert,
  AlertActions,
  AlertContent,
  AlertDescription,
  AlertIcon,
  AlertTitle,
  Badge,
  Button,
  Check,
  CopyButton,
  ExternalLink,
  Input,
  Item,
  ItemContent,
  ItemGroup,
  ItemMedia,
  ItemTitle,
  Link2Off,
  Lock,
  Search,
  SettingsSection,
  Spinner,
  Text,
  TriangleAlert,
  UserAvatar,
} from "@openbot/ui";
import { createEffect, createMemo, createSignal, For, Match, Show, Switch } from "solid-js";
import { useText } from "../../text";
import { GitHubMark } from "./brand-marks";
import {
  DangerZone,
  IntegrationPage,
  type IntegrationPageSlots,
  type IntegrationStatus,
  Stepper,
  WizardDialog,
  type WizardLink,
} from "./IntegrationLayout";

export interface GitHubConnectorPanelProps extends IntegrationPageSlots {
  /** The joined server whose connection this is. Absent: this computer's. */
  hostName?: string | undefined;
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

/** What the connect dialog reads and does. */
export type GitHubConnection = Pick<
  GitHubConnectorPanelProps,
  | "hostName"
  | "status"
  | "busy"
  | "repositories"
  | "repositoriesError"
  | "onConnect"
  | "onCancel"
  | "onOpenVerification"
  | "onOpenInstall"
>;

/**
 * The connect dialog shows one of these. `waiting` is before GitHub sends a code, `failed` is a
 * connect that stopped with no sign-in, and `connected` stays until the user closes the dialog.
 */
type ConnectStep = "waiting" | "code" | "failed" | "connected";

function connectStep(status: GitHubConnectorStatus, busy: boolean): ConnectStep {
  if (status.state === "pending") return status.userCode ? "code" : "waiting";
  if (status.state === "connected") return "connected";
  return busy ? "waiting" : "failed";
}

/** The status of the connection, as its page header and every list of connectors show it. */
export const GITHUB_STATUS = {
  disconnected: { status: "idle", label: "marketplace.app.notConnected" },
  pending: { status: "connecting", label: "connector.github.statusConnecting" },
  connected: { status: "connected", label: "connector.github.statusConnected" },
  expired: { status: "attention", label: "connector.github.statusExpired" },
} as const satisfies Record<GitHubConnectorStatus["state"], { status: IntegrationStatus; label: AppTextKey }>;

/**
 * The GitHub page of one OpenBot computer. The token never reaches this component: the status holds
 * the account name and, during a sign-in, the code that the user types.
 *
 * Connect opens a dialog that follows the status: the wait for a code, the code, and the result.
 * A sign-in that is pending when the page opens shows the same dialog. Disconnect asks first.
 */
export function GitHubConnectorPanel(props: GitHubConnectorPanelProps) {
  const { t } = useText();
  const [connectOpen, setConnectOpen] = createSignal(false);
  const [confirmOpen, setConfirmOpen] = createSignal(false);
  createEffect(
    () => props.status.state,
    (state) => {
      if (state === "pending") setConnectOpen(true);
    },
  );
  const header = () => GITHUB_STATUS[props.status.state];
  const login = () => props.status.login ?? "";
  const failure = () => {
    const message = props.status.error;
    if (connectOpen() || props.status.state === "expired" || !message) return null;
    return { title: t("connector.github.actionFailed"), message };
  };

  const connect = () => {
    setConnectOpen(true);
    props.onConnect();
  };
  const closeConnect = () => {
    cancelRunning(props);
    setConnectOpen(false);
  };
  const confirmDisconnect = () => {
    setConfirmOpen(false);
    props.onDisconnect();
  };

  return (
    <IntegrationPage
      class="github-connector"
      logo={<GitHubMark />}
      name={t("connector.github.title")}
      status={header().status}
      statusLabel={t(header().label)}
      subtitle={
        props.hostName
          ? t("connector.github.descriptionHost", { host: props.hostName })
          : t("connector.github.description")
      }
      actions={
        <Show when={props.status.state === "disconnected"}>
          <Button type="button" size="sm" loading={props.busy} onClick={connect}>
            {t("connector.github.connect")}
          </Button>
        </Show>
      }
      // The dialog shows a failure while it is open, and the expired alert already tells the user why.
      failure={failure()}
      alert={
        <Show when={props.status.state === "expired"}>
          <Alert tone="warning" role="alert">
            <AlertIcon>
              <TriangleAlert />
            </AlertIcon>
            <AlertContent>
              <AlertTitle>{t("connector.github.expiredTitle")}</AlertTitle>
              <AlertDescription>{t("connector.github.expiredDescription", { login: login() })}</AlertDescription>
            </AlertContent>
            <AlertActions>
              <Button type="button" size="sm" loading={props.busy} onClick={connect}>
                {t("connector.github.reconnect")}
              </Button>
            </AlertActions>
          </Alert>
        </Show>
      }
      tagline={props.tagline}
      intro={props.intro}
      details={props.details}
      danger={
        <Show when={props.status.state === "connected" || props.status.state === "expired"}>
          <DangerZone
            title={t("connector.github.disconnectTitle")}
            description={t("connector.github.disconnectSummary")}
            action={t("connector.github.disconnect")}
            busy={props.busy}
            onAction={() => setConfirmOpen(true)}
          />
        </Show>
      }
    >
      <Show when={props.status.state === "connected" || props.status.state === "expired"}>
        <SettingsSection title={t("connector.github.accountTitle")}>
          <ItemGroup class="settings-modal-card">
            <Item class="settings-modal-row">
              <ItemMedia>
                <GitHubAvatar login={login()} avatarUrl={props.status.avatarUrl} />
              </ItemMedia>
              <ItemContent>
                <ItemTitle>@{login()}</ItemTitle>
              </ItemContent>
            </Item>
          </ItemGroup>
        </SettingsSection>
      </Show>

      <Show when={props.status.state === "connected"}>
        <RepositoriesSection
          busy={props.busy}
          repositories={props.repositories}
          repositoriesError={props.repositoriesError}
          onOpenInstall={props.onOpenInstall}
        />
      </Show>

      <ConnectDialog {...props} open={connectOpen()} onClose={closeConnect} />
      <DisconnectDialog
        open={confirmOpen()}
        login={login()}
        hostName={props.hostName}
        onConfirm={confirmDisconnect}
        onClose={() => setConfirmOpen(false)}
      />
    </IntegrationPage>
  );
}

/** GitHub's picture of the account, or its initials when there is none or it does not load. */
function GitHubAvatar(props: { login: string; avatarUrl: string | null }) {
  return (
    <UserAvatar
      user={{ name: props.login, email: `${props.login}@users.noreply.github.com`, avatarUrl: props.avatarUrl }}
      class="github-connector-avatar"
      decorative
    />
  );
}

function RepositoriesSection(props: {
  busy: boolean;
  repositories: GitHubConnectorRepositories | null;
  repositoriesError: string | null;
  onOpenInstall: () => void;
}) {
  const { t } = useText();
  const [query, setQuery] = createSignal("");
  const matches = createMemo(() => {
    const needle = query().trim().toLowerCase();
    const all = props.repositories?.repositories ?? [];
    return needle ? all.filter((repository) => repository.fullName.toLowerCase().includes(needle)) : all;
  });
  return (
    <SettingsSection
      title={t("connector.github.repositoriesTitle")}
      description={t("connector.github.repositoriesDescription")}
      actions={
        <Button type="button" size="sm" variant="outline" disabled={props.busy} onClick={props.onOpenInstall}>
          <ExternalLink size={14} aria-hidden="true" />
          {t("connector.github.chooseRepositories")}
        </Button>
      }
    >
      <ItemGroup class="settings-modal-card">
        <Show when={props.repositoriesError}>
          {(message) => (
            <Text class="integration-card-note" tone="danger" variant="caption" role="alert">
              {message()}
            </Text>
          )}
        </Show>
        <Show
          when={props.repositories}
          fallback={
            <Show when={!props.repositoriesError}>
              <Text class="integration-card-note" tone="muted" variant="caption">
                {t("connector.github.repositoriesLoading")}
              </Text>
            </Show>
          }
        >
          {(list) => (
            <Show
              when={list().repositories.length > 0}
              fallback={
                <Text class="integration-card-note" tone="muted" variant="caption">
                  {t("connector.github.noRepositories")}
                </Text>
              }
            >
              <div class="integration-card-body">
                <div class="github-connector-search">
                  <Search aria-hidden="true" />
                  <Input
                    type="search"
                    size="sm"
                    placeholder={t("connector.github.filterPlaceholder", { count: list().repositories.length })}
                    aria-label={t("connector.github.filterLabel")}
                    value={query()}
                    onInput={(event) => setQuery(event.currentTarget.value)}
                  />
                </div>
                <Show
                  when={matches().length > 0}
                  fallback={
                    <Text variant="caption" tone="muted">
                      {t("connector.github.noMatch", { query: query().trim() })}
                    </Text>
                  }
                >
                  <ul class="github-connector-repository-list" aria-label={t("connector.github.repositoriesTitle")}>
                    <For each={matches()} keyed={(repository) => repository.fullName}>
                      {(repository) => {
                        const slash = () => repository().fullName.indexOf("/");
                        return (
                          <li class="github-connector-repository">
                            <Text as="span" class="github-connector-repository-name" variant="body-sm" truncate>
                              <span class="github-connector-repository-owner">
                                {repository().fullName.slice(0, slash() + 1)}
                              </span>
                              {repository().fullName.slice(slash() + 1)}
                            </Text>
                            <Show when={repository().private}>
                              <Badge variant="secondary" class="github-connector-private">
                                <Lock size={12} aria-hidden="true" />
                                {t("connector.github.private")}
                              </Badge>
                            </Show>
                          </li>
                        );
                      }}
                    </For>
                  </ul>
                </Show>
              </div>
              <Show when={list().total > list().repositories.length}>
                <Text class="integration-card-note" tone="muted" variant="caption">
                  {t("connector.github.moreRepositories", { count: list().total - list().repositories.length })}
                </Text>
              </Show>
            </Show>
          )}
        </Show>
      </ItemGroup>
    </SettingsSection>
  );
}

/** Closing the dialog during the wait or the code stops the sign-in, as Cancel does. */
function cancelRunning(connection: GitHubConnection) {
  const step = connectStep(connection.status, connection.busy);
  if (step === "waiting" || step === "code") connection.onCancel();
}

/**
 * The connect dialog of the GitHub page, for another view that connects GitHub, such as a workflow
 * card. Closing it during the sign-in stops the sign-in.
 */
export function GitHubConnectDialog(props: GitHubConnection & { open: boolean; onClose: () => void }) {
  const close = () => {
    cancelRunning(props);
    props.onClose();
  };
  return <ConnectDialog {...props} onClose={close} />;
}

function ConnectDialog(props: GitHubConnection & { open: boolean; onClose: () => void }) {
  const { t, sourceText } = useText();
  const step = () => connectStep(props.status, props.busy);
  const link = (): WizardLink => (step() === "connected" ? "connected" : step() === "failed" ? "broken" : "connecting");
  const noRepositories = () => props.repositories?.total === 0;
  /** While the sign-in runs, closing the dialog cancels it. */
  const running = () => step() === "waiting" || step() === "code";
  const title = () => {
    switch (step()) {
      case "waiting":
        return t("connector.github.waiting");
      case "code":
        return t("connector.github.pendingTitle");
      case "failed":
        return t("connector.github.failedTitle");
      case "connected":
        return t("connector.github.connectedAs", { login: props.status.login ?? "" });
    }
  };
  const description = () => {
    switch (step()) {
      case "waiting":
        return t("connector.github.requestingCode");
      case "code":
        return t("connector.github.pendingDescription");
      case "failed":
        return props.status.error ? sourceText(props.status.error) : t("connector.github.actionFailed");
      case "connected":
        return noRepositories() ? t("connector.github.noRepositories") : t("connector.github.repositoriesDescription");
    }
  };
  const steps = () => [t("connector.github.stepSignIn"), t("connector.github.stepConnected")];
  return (
    <WizardDialog
      open={props.open}
      closeLabel={running() ? t("connector.github.cancelConnecting") : t("connector.github.close")}
      dismissible={!running()}
      onClose={props.onClose}
      logo={<GitHubMark />}
      link={link()}
      title={title()}
      description={description()}
      stepper={
        <Stepper
          steps={steps()}
          current={step() === "connected" ? steps().length : 0}
          label={t("connector.github.connect")}
        />
      }
      footer={
        <Switch>
          <Match when={step() === "waiting"}>
            <Button type="button" size="sm" variant="ghost" onClick={props.onClose}>
              {t("connector.github.cancel")}
            </Button>
          </Match>
          <Match when={step() === "code" && props.status.userCode}>
            {(code) => (
              <>
                <CopyButton
                  value={code()}
                  size="sm"
                  variant="outline"
                  label={t("connector.github.copyCode")}
                  copiedLabel={t("connector.github.codeCopied")}
                />
                <Button
                  type="button"
                  size="sm"
                  disabled={!props.status.verificationUri}
                  onClick={props.onOpenVerification}
                >
                  <ExternalLink size={14} aria-hidden="true" />
                  {t("connector.github.openGitHub")}
                </Button>
              </>
            )}
          </Match>
          <Match when={step() === "failed"}>
            <Button type="button" size="sm" variant="ghost" onClick={props.onClose}>
              {t("connector.github.cancel")}
            </Button>
            <Button type="button" size="sm" onClick={props.onConnect}>
              {t("connector.github.connect")}
            </Button>
          </Match>
          <Match when={step() === "connected" && noRepositories()}>
            <Button type="button" size="sm" variant="ghost" onClick={props.onClose}>
              {t("connector.github.later")}
            </Button>
            <Button type="button" size="sm" disabled={props.busy} onClick={props.onOpenInstall}>
              <ExternalLink size={14} aria-hidden="true" />
              {t("connector.github.chooseRepositories")}
            </Button>
          </Match>
          <Match when={step() === "connected"}>
            <Button type="button" size="sm" variant="outline" disabled={props.busy} onClick={props.onOpenInstall}>
              <ExternalLink size={14} aria-hidden="true" />
              {t("connector.github.chooseRepositories")}
            </Button>
            <Button type="button" size="sm" onClick={props.onClose}>
              {t("connector.github.done")}
            </Button>
          </Match>
        </Switch>
      }
    >
      <Switch>
        <Match when={step() === "waiting"}>
          <div class="github-connector-center">
            <Spinner label={t("connector.github.waiting")} />
          </div>
        </Match>
        <Match when={step() === "code" && props.status.userCode}>
          {(code) => (
            <>
              <DeviceCode code={code()} />
              <div class="github-connector-waiting" aria-live="polite">
                <Spinner size="sm" />
                <Text variant="caption" tone="muted">
                  {t("connector.github.waiting")}
                </Text>
              </div>
            </>
          )}
        </Match>
        <Match when={step() === "connected"}>
          <div class="github-connector-done">
            <GitHubAvatar login={props.status.login ?? ""} avatarUrl={props.status.avatarUrl} />
            <div>
              <Text variant="label">@{props.status.login ?? ""}</Text>
              <Show
                when={props.repositories}
                fallback={
                  <Show
                    when={props.repositoriesError}
                    fallback={
                      <Text variant="caption" tone="muted">
                        {t("connector.github.repositoriesLoading")}
                      </Text>
                    }
                  >
                    {(message) => (
                      <Text variant="caption" tone="danger" role="alert">
                        {message()}
                      </Text>
                    )}
                  </Show>
                }
              >
                {(list) => (
                  <Text variant="caption" tone="muted">
                    {props.hostName
                      ? t("connector.github.connectedSummaryHost", { count: list().total, host: props.hostName })
                      : t("connector.github.connectedSummary", { count: list().total })}
                  </Text>
                )}
              </Show>
            </div>
          </div>
        </Match>
      </Switch>
    </WizardDialog>
  );
}

/** The code in large separate characters, because the user types it on another screen. */
function DeviceCode(props: { code: string }) {
  const { t } = useText();
  return (
    <div class="github-connector-code">
      <span class="sr-only">{t("connector.github.codeLabel", { code: props.code })}</span>
      <For each={props.code.split("")}>
        {(char) => (
          <span
            class="github-connector-code-char"
            data-separator={char === "-" ? "true" : undefined}
            aria-hidden="true"
          >
            {char}
          </span>
        )}
      </For>
    </div>
  );
}

function DisconnectDialog(props: {
  open: boolean;
  login: string;
  hostName: string | undefined;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const { t } = useText();
  return (
    <WizardDialog
      open={props.open}
      closeLabel={t("connector.github.close")}
      onClose={props.onClose}
      logo={<GitHubMark />}
      link="broken"
      title={t("connector.github.disconnectConfirmTitle")}
      description={
        props.hostName
          ? t("connector.github.disconnectConfirmDescriptionHost", { login: props.login, host: props.hostName })
          : t("connector.github.disconnectConfirmDescription", { login: props.login })
      }
      footer={
        <>
          <Button type="button" variant="ghost" onClick={props.onClose}>
            {t("connector.github.keepConnected")}
          </Button>
          <Button
            type="button"
            variant="destructive"
            class="integration-confirm"
            data-cuelume-tap="close"
            data-cuelume-emphasis="strong"
            onClick={props.onConfirm}
          >
            <Link2Off aria-hidden="true" />
            {t("connector.github.disconnect")}
          </Button>
        </>
      }
    >
      <ul class="integration-effects">
        <li data-tone="danger">
          <span class="integration-effect-icon" aria-hidden="true">
            <Link2Off />
          </span>
          {t("connector.github.disconnectEffectTools")}
        </li>
        <li>
          <span class="integration-effect-icon" aria-hidden="true">
            <ExternalLink />
          </span>
          {t("connector.github.disconnectEffectRevoke")}
        </li>
        <li data-tone="success">
          <span class="integration-effect-icon" aria-hidden="true">
            <Check />
          </span>
          {props.hostName
            ? t("connector.github.disconnectEffectKeptHost", { host: props.hostName })
            : t("connector.github.disconnectEffectKept")}
        </li>
      </ul>
    </WizardDialog>
  );
}
