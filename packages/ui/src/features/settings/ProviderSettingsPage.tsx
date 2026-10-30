/**
 * Settings > Providers: a short list, and one page for each provider. A list row shows one line, and
 * a badge only when the provider needs the user. The provider page has its accounts or its sign-in,
 * its key, its runtime and its use, each as a settings card with at most one button on a row.
 */

import { ProviderLogo } from "@openbot/brand";
import {
  type AgentProviderId,
  agentProviderName,
  type CustomProviderSummary,
  DEFAULT_CUSTOM_PROVIDER_HARNESS,
  DEFAULT_PROVIDER_ACCOUNT_ID,
  MAX_PROVIDER_ACCOUNTS,
  PROMPT_CACHE_TTLS,
  type PromptCacheTtl,
  type ProviderAccountState,
  type ProviderRuntimeDownload,
  type ProviderUsageResetOutcome,
  type ProviderUsageResets,
} from "@openbot/contracts/ipc";
import type { AppTextKey } from "@openbot/i18n";
import {
  Badge,
  Button,
  badgeVariants,
  buttonVariants,
  ChevronRight,
  ConfirmDialog,
  Copy,
  DropdownMenu,
  Ellipsis,
  Gauge,
  Input,
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
  KeyRound,
  Link,
  LogIn,
  LogOut,
  Pencil,
  Plus,
  Popover,
  Progress,
  RotateCcw,
  Search,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  SettingsSection,
  SlidersHorizontal,
  Smartphone,
  Spinner,
  Switch,
  Trash2,
  UserRoundPlus,
  X,
} from "@openbot/ui";
import type { JSX } from "@solidjs/web";
import { createEffect, createMemo, createSignal, createStore, For, onCleanup, Show } from "solid-js";
import { ProviderAccountRenameField } from "../../components/ProviderAccountList";
import type { ProviderPickerOption } from "../../components/ProviderPicker";
import { isApiKeyAccount, type ProviderPickerAccount, providerAccountName } from "../../components/provider-accounts";
import {
  createProviderRow,
  PROVIDER_ACTION_LABEL,
  PROVIDER_ACTION_TEXT,
  type ProviderRow,
  type ProviderRowHost,
  providerAction,
  providerStatusLabel,
  servesCustomProvider,
  showProviderInUse,
} from "../../components/provider-row";
import { useText } from "../../text";
import { AccountUsageWindowList } from "../account/AccountUsageDetails";
import type { AccountUsageProviderRow, AccountUsageWindowRow } from "../account/account-usage-view";
import { providerUpdateAvailable } from "../provider-updates/provider-update";
import { DetailHeader, type IntegrationStatus } from "./IntegrationLayout";

/** The provider page on screen. The settings window puts "Providers ›" before its title. */
export interface ProviderSettingsDetail {
  title: string;
  back: () => void;
}

/** The custom endpoints are one choice of the default select. */
export type ProviderDefaultChoice = AgentProviderId | "custom";

/** How long Claude keeps the prompt cache of the host's agents. `value` is null until the host answers. */
export interface ProviderPromptCache {
  value: PromptCacheTtl | null;
  pending: boolean;
  /** A load or a save that failed. */
  error: string | null;
  onChange: (ttl: PromptCacheTtl) => void;
}

export interface ProviderSettingsPageProps extends ProviderRowHost {
  options: ProviderPickerOption[];
  /** The default for new agents. A joined server has none: its default is not this computer's. */
  defaultProvider?:
    | {
        value: ProviderDefaultChoice | null;
        pending: boolean;
        onChange: (choice: ProviderDefaultChoice) => void;
      }
    | undefined;
  disabled?: boolean | undefined;
  onCancelProviderRestart?: ((provider: AgentProviderId) => void | Promise<void>) | undefined;
  /** Turns a provider on or off. A provider that an agent uses stays on and names its agents. */
  onSetProviderOn?: ((provider: AgentProviderId, on: boolean) => void | Promise<void>) | undefined;
  /** The downloaded CLI of a provider that is off, which `onRemoveProviderDownload` frees. */
  onMeasureProviderDownload?: ((provider: AgentProviderId) => Promise<ProviderRuntimeDownload>) | undefined;
  /** Removes the downloaded CLI of a provider that is off. This computer only. */
  onRemoveProviderDownload?: ((provider: AgentProviderId) => Promise<void>) | undefined;
  /** The usage readings of each account. An account that is low shows a badge with its limits. */
  usage?: readonly AccountUsageProviderRow[] | undefined;
  /** The dialog element that the menus and the select portal into. */
  menuMount?: HTMLElement | undefined;
  customProviders?: readonly CustomProviderSummary[] | undefined;
  /** Without it the page has no custom endpoints: a joined server's OpenCode is not this computer's. */
  onAddCustomProvider?: (() => void) | undefined;
  /**
   * Opens the form for a saved endpoint. This computer only: the Team API has no edit route, so a
   * joined server's rows have no Edit.
   */
  onEditCustomProvider?: ((provider: CustomProviderSummary) => void) | undefined;
  /**
   * This computer runs an endpoint on OpenCode or Pi, and each row names its provider. A joined
   * server's host runs every endpoint on OpenCode.
   */
  customProviderHarnesses?: boolean | undefined;
  /** Runs after the user accepts the removal question. */
  onRemoveCustomProvider?: ((provider: CustomProviderSummary) => void) | undefined;
  removingCustomProvider?: string | null | undefined;
  onDetailChange?: ((detail: ProviderSettingsDetail | null) => void) | undefined;
  /** On the Claude page. Only for a host with `prompt-cache-ttl-v1` that this account administers. */
  promptCache?: ProviderPromptCache | undefined;
  /** Below the list: what the host found, and the other agents the user can add. */
  footer?: JSX.Element;
}

type PageId = AgentProviderId | "custom";

export function ProviderSettingsPage(props: ProviderSettingsPageProps) {
  const { t } = useText();
  const [open, setOpen] = createSignal<PageId | null>(null);
  const openOption = () => {
    const id = open();
    return id && id !== "custom" ? props.options.find((option) => option.id === id) : undefined;
  };
  const customOffered = () => Boolean(props.onAddCustomProvider);
  /** The page on screen. The list shows again when its provider leaves the options. */
  const page = (): PageId | null => {
    if (open() === "custom") return customOffered() ? "custom" : null;
    return openOption()?.id ?? null;
  };
  // The dialog outlives this page, so the cleanup clears a title that names a page that is gone.
  createEffect(
    () => {
      const id = page();
      if (id === null) return null;
      return id === "custom" ? t("provider.custom.name") : (openOption()?.name ?? null);
    },
    (title) => {
      if (title === null) return;
      props.onDetailChange?.({ title, back: () => setOpen(null) });
      return () => props.onDetailChange?.(null);
    },
  );
  return (
    <div class="provider-settings-stack">
      <Show when={page()} fallback={<ProviderList {...props} onOpen={setOpen} />}>
        {(id) => (
          <Show when={id() === "custom" ? null : openOption()} fallback={<CustomEndpointsPage {...props} />}>
            {(option) => <ProviderPage {...props} option={option()} />}
          </Show>
        )}
      </Show>
    </div>
  );
}

/* ------------------------------------------------------------------ List */

/** A provider that is signing in stays with the connected ones, so it does not jump between the lists. */
function isConnected(option: ProviderPickerOption): boolean {
  return !option.off && (option.state === "available" || option.connectionState === "connecting");
}

function waitingAccounts(option: ProviderPickerOption): number {
  return (option.accounts ?? []).filter((account) => account.state === "signed-out" || account.state === "error")
    .length;
}

function ProviderList(props: ProviderSettingsPageProps & { onOpen: (id: PageId) => void }) {
  const { t, format } = useText();
  const [query, setQuery] = createSignal("");
  const needle = () => query().trim().toLowerCase();
  /** The line under a provider's name. Problems come first, so the list shows what needs the user. */
  const summary = (option: ProviderPickerOption) => {
    if (option.off) return t("provider.status.off");
    if (option.runtimeStatus?.phase === "not-downloaded") return t("provider.status.notDownloaded");
    if (option.connectionState === "connecting") return t("provider.status.connecting");
    if (option.state !== "available") return providerStatusLabel(t, format, option.state);
    const accounts = option.accounts ?? [];
    if (accounts.length > 1) {
      const count = t("provider.account.count", { count: accounts.length });
      const waiting = waitingAccounts(option);
      return waiting > 0 ? t("provider.settings.accountsWaiting", { count: waiting, accounts: count }) : count;
    }
    return option.email ?? option.description ?? t("provider.status.connected");
  };
  /** A query matches the name, the line under it, and the names and emails of the accounts. */
  const matches = (...texts: (string | null | undefined)[]) =>
    needle() === "" || texts.some((text) => text?.toLowerCase().includes(needle()));
  const shown = createMemo(() =>
    props.options.filter((option) =>
      matches(
        option.name,
        summary(option),
        option.email,
        ...(option.accounts ?? []).flatMap((account) => [account.label, account.email]),
      ),
    ),
  );
  const connectedRows = () => shown().filter(isConnected);
  const otherRows = () => shown().filter((option) => !isConnected(option));
  const endpoints = () => props.customProviders ?? [];
  const endpointsShown = () =>
    Boolean(props.onAddCustomProvider) &&
    matches(t("provider.custom.name"), ...endpoints().map((endpoint) => endpoint.name));
  const endpointsConnected = () => endpointsShown() && endpoints().length > 0;
  const endpointsOther = () => endpointsShown() && endpoints().length === 0;
  const emptyText = () => {
    if (needle() === "") return t("provider.settings.noneConnected");
    return otherRows().length === 0 && !endpointsOther()
      ? t("provider.settings.noMatch", { query: query().trim() })
      : t("provider.settings.noConnectedMatch", { query: query().trim() });
  };
  return (
    <>
      <Show when={props.defaultProvider}>
        <ItemGroup class="settings-modal-card">
          <DefaultProviderRow {...props} />
        </ItemGroup>
      </Show>
      <SettingsSection
        title={t("provider.settings.connected")}
        actions={
          <label class="server-settings-search">
            <Search aria-hidden="true" />
            <span class="sr-only">{t("provider.settings.search")}</span>
            <Input
              size="sm"
              type="search"
              placeholder={t("provider.settings.search")}
              value={query()}
              onValueChange={setQuery}
            />
          </label>
        }
      >
        <ItemGroup class="settings-modal-card">
          <Show when={connectedRows().length === 0 && !endpointsConnected()}>
            <Item class="server-settings-empty-row">
              <ItemContent>
                <ItemDescription>{emptyText()}</ItemDescription>
              </ItemContent>
            </Item>
          </Show>
          <For each={connectedRows()} keyed={false}>
            {(option) => <ProviderNavRow option={option()} summary={summary(option())} onOpen={props.onOpen} />}
          </For>
          <Show when={endpointsConnected()}>
            <EndpointsNavRow {...props} onOpen={() => props.onOpen("custom")} />
          </Show>
        </ItemGroup>
      </SettingsSection>
      <Show when={otherRows().length > 0 || endpointsOther()}>
        <SettingsSection title={t("provider.settings.other")}>
          <ItemGroup class="settings-modal-card">
            <For each={otherRows()} keyed={false}>
              {(option) => <ProviderNavRow option={option()} summary={summary(option())} onOpen={props.onOpen} />}
            </For>
            <Show when={endpointsOther()}>
              <EndpointsNavRow {...props} onOpen={() => props.onOpen("custom")} />
            </Show>
          </ItemGroup>
        </SettingsSection>
      </Show>
      {props.footer}
    </>
  );
}

/** A row that opens a page. The whole row is the button. */
function NavRow(props: { logo: JSX.Element; name: string; summary: string; end?: JSX.Element; onOpen: () => void }) {
  const { t } = useText();
  return (
    <Item class="settings-modal-row integrations-hub-row">
      <Button
        type="button"
        variant="ghost"
        class="integrations-hub-hitarea"
        aria-label={t("provider.settings.open", { name: props.name })}
        data-cuelume-tap="navigate"
        onClick={() => props.onOpen()}
      />
      <ItemMedia>{props.logo}</ItemMedia>
      <ItemContent>
        <ItemTitle>{props.name}</ItemTitle>
        <ItemDescription>{props.summary}</ItemDescription>
      </ItemContent>
      <ItemActions class="integrations-hub-actions">
        {props.end}
        <ChevronRight class="integrations-hub-chevron" aria-hidden="true" />
      </ItemActions>
    </Item>
  );
}

function ProviderNavRow(props: { option: ProviderPickerOption; summary: string; onOpen: (id: PageId) => void }) {
  return (
    <NavRow
      logo={
        <ProviderLogo
          provider={props.option.id}
          class={["provider-picker-logo", { "provider-settings-logo-off": Boolean(props.option.off) }]}
        />
      }
      name={props.option.name}
      summary={props.summary}
      end={<RowStatus option={props.option} />}
      onOpen={() => props.onOpen(props.option.id)}
    />
  );
}

function EndpointsNavRow(props: ProviderSettingsPageProps & { onOpen: () => void }) {
  const { t, format } = useText();
  const names = () => (props.customProviders ?? []).map((endpoint) => endpoint.name);
  return (
    <NavRow
      logo={<SlidersHorizontal class="provider-picker-custom-mark" aria-hidden="true" />}
      name={t("provider.custom.name")}
      summary={names().length > 0 ? format.list(names()) : t("provider.custom.description")}
      onOpen={props.onOpen}
    />
  );
}

/** A spinner while the provider works, or one badge when it needs the user. */
function RowStatus(props: { option: ProviderPickerOption }) {
  const { t } = useText();
  const busy = () =>
    !props.option.off &&
    (props.option.connectionState === "connecting" ||
      props.option.runtimeStatus?.phase === "downloading" ||
      props.option.runtimeStatus?.phase === "finishing");
  const badge = (): { variant: "warning-light" | "destructive-light"; text: string } | null => {
    const option = props.option;
    if (option.off) return null;
    if (waitingAccounts(option) > 0) return { variant: "warning-light", text: t("provider.settings.badge.signIn") };
    const runtime = option.runtimeStatus;
    if (runtime?.phase === "download-error") {
      return {
        variant: "destructive-light",
        text: t(runtime.version ? "provider.status.updateFailed" : "provider.status.setupFailed"),
      };
    }
    if (option.lastError) return { variant: "warning-light", text: t("provider.settings.badge.error") };
    if (option.state === "outdated") return { variant: "warning-light", text: t("provider.status.updateRequired") };
    if (runtime && providerUpdateAvailable(runtime, option.availableVersion ?? null)) {
      return { variant: "warning-light", text: t("provider.status.updateAvailable") };
    }
    return null;
  };
  return (
    <Show
      when={busy()}
      fallback={<Show when={badge()}>{(value) => <Badge variant={value().variant}>{value().text}</Badge>}</Show>}
    >
      <Spinner size="sm" />
    </Show>
  );
}

interface DefaultChoice {
  id: ProviderDefaultChoice;
  name: string;
}

/** The default provider as one select, so the rows need no radio. */
function DefaultProviderRow(props: ProviderSettingsPageProps) {
  const { t } = useText();
  const choices = (): DefaultChoice[] => {
    const value = props.defaultProvider?.value ?? null;
    const providers = props.options
      .filter((option) => (option.state === "available" && !option.off) || option.id === value)
      .map((option) => ({ id: option.id, name: option.name }));
    const custom =
      (props.customProviders?.length ?? 0) > 0 && servesCustomEndpoints(props) && props.onAddCustomProvider;
    return custom || value === "custom" ? [...providers, { id: "custom", name: t("provider.custom.name") }] : providers;
  };
  const selected = () => choices().find((choice) => choice.id === props.defaultProvider?.value) ?? null;
  return (
    <Item class="settings-modal-row">
      <ItemContent>
        <ItemTitle>{t("onboarding.setup.defaultProvider")}</ItemTitle>
        <ItemDescription>{t("provider.settings.defaultHint")}</ItemDescription>
      </ItemContent>
      <ItemActions>
        <Select<DefaultChoice>
          class="provider-settings-select"
          options={choices()}
          optionValue="id"
          optionTextValue="name"
          value={selected()}
          disabled={Boolean(props.disabled || props.defaultProvider?.pending)}
          // The select also reports the value that it shows, which is not a choice of the user.
          onChange={(choice) => {
            if (choice && choice.id !== props.defaultProvider?.value) props.defaultProvider?.onChange(choice.id);
          }}
          placement="bottom-end"
          itemComponent={(itemProps) => (
            <SelectItem item={itemProps.item}>
              <ChoiceLabel choice={itemProps.item.rawValue} />
            </SelectItem>
          )}
        >
          <SelectTrigger size="sm" aria-label={t("onboarding.setup.defaultProvider")}>
            <SelectValue<DefaultChoice>>{(value) => <ChoiceLabel choice={value.selectedOption()} />}</SelectValue>
          </SelectTrigger>
          <SelectContent mount={props.menuMount} />
        </Select>
      </ItemActions>
    </Item>
  );
}

function ChoiceLabel(props: { choice: DefaultChoice }) {
  return (
    <span class="provider-settings-select-option">
      <Show
        when={props.choice.id === "custom" ? null : props.choice.id}
        fallback={<SlidersHorizontal class="provider-picker-custom-mark" aria-hidden="true" />}
      >
        {(provider) => <ProviderLogo provider={provider()} class="provider-picker-logo" />}
      </Show>
      {props.choice.name}
    </span>
  );
}

/* ------------------------------------------------------------------ Provider page */

type PageProps = ProviderSettingsPageProps & { option: ProviderPickerOption };

function ProviderPage(props: PageProps) {
  const { t, format } = useText();
  const row = createProviderRow(() => props.option, props);
  const usedBy = () => props.option.usedBy ?? [];
  /** The pill in the page header. Only one state shows: the problem first, then the connection. */
  const header = (): { status: IntegrationStatus; label: string } => {
    const option = props.option;
    const runtime = option.runtimeStatus;
    if (row.off()) return { status: "unavailable", label: t("provider.status.off") };
    // A reconnect of a connected provider stays Connected, as its label does.
    if ((row.connecting() && !row.available()) || runtime?.phase === "downloading" || runtime?.phase === "finishing") {
      return {
        status: "connecting",
        label: providerStatusLabel(t, format, option.state, row.connecting(), runtime),
      };
    }
    if (runtime?.phase === "download-error" || option.state === "error" || option.state === "outdated") {
      return { status: "attention", label: providerStatusLabel(t, format, option.state, false, runtime) };
    }
    if (!row.available())
      return { status: "idle", label: providerStatusLabel(t, format, option.state, false, runtime) };
    if (waitingAccounts(option) > 0) return { status: "attention", label: t("provider.settings.status.needsSignIn") };
    if (option.lastError) return { status: "attention", label: t("provider.settings.status.error") };
    return { status: "connected", label: t("provider.status.connected") };
  };
  const subtitle = () => {
    const use =
      usedBy().length === 0
        ? t("provider.settings.unused")
        : t("provider.settings.usedByCount", { count: usedBy().length });
    return props.defaultProvider?.value === props.option.id ? t("provider.settings.defaultSubtitle", { use }) : use;
  };
  const accountsShown = () =>
    Boolean(props.accountActions) && (props.option.accounts?.length ?? 0) > 0 && row.available() && !row.off();
  const keyShown = () =>
    Boolean(props.onSignInProvider) &&
    (props.option.id === "opencode" || props.option.id === "muse" || row.apiKeyOffered());
  return (
    <>
      <DetailHeader
        logo={<ProviderLogo provider={props.option.id} class="provider-picker-logo" />}
        name={props.option.name}
        status={header().status}
        statusLabel={header().label}
        subtitle={subtitle()}
      />
      <Show when={!row.off()}>
        <Show when={accountsShown()} fallback={<SignInSection {...props} row={row} keyShown={keyShown()} />}>
          <AccountsSection {...props} row={row} />
        </Show>
        <Show when={keyShown()}>
          <ApiKeySection {...props} row={row} />
        </Show>
        <RuntimeSection {...props} row={row} />
        <Show when={props.option.id === "claude" && props.promptCache}>
          {(cache) => <PromptCacheSection cache={cache()} disabled={props.disabled} menuMount={props.menuMount} />}
        </Show>
      </Show>
      <UseSection {...props} row={row} />
      <DownloadSection {...props} row={row} />
    </>
  );
}

type SectionProps = PageProps & { row: ProviderRow };

/** The ⋯ button of a row. Its menu portals into the dialog, where a modal leaves it in reach. */
function MenuTrigger(props: { label: string; disabled?: boolean | undefined }) {
  return (
    <DropdownMenu.Trigger
      class={`${buttonVariants({ variant: "ghost", size: "icon-sm" })} ui-icon-button`}
      aria-label={props.label}
      disabled={props.disabled}
    >
      <Ellipsis aria-hidden="true" />
    </DropdownMenu.Trigger>
  );
}

/** The second way in, from a ⋯ menu: a code, or the address that the browser shows at its end. */
function AlternativeItem(props: { row: ProviderRow }) {
  const { t } = useText();
  return (
    <Show when={props.row.alternative()}>
      {(kind) => (
        <DropdownMenu.Item onSelect={props.row.signInAlternative}>
          <Show when={kind() === "address"} fallback={<Smartphone aria-hidden="true" />}>
            <Link aria-hidden="true" />
          </Show>
          {t(kind() === "address" ? "provider.action.pasteAddress" : "provider.action.signInWithCode")}
        </DropdownMenu.Item>
      )}
    </Show>
  );
}

/* ---------------------------------------------- Accounts */

/** The providers whose CLI signs its own sign-in out (`signOut` in `src/backend/provider-drivers.ts`). */
const SIGN_OUT_PROVIDERS: ReadonlySet<AgentProviderId> = new Set(["claude", "codex"]);

function AccountsSection(props: SectionProps) {
  const { t, format, errorMessage, sourceText } = useText();
  const accounts = () => props.option.accounts ?? [];
  const [removing, setRemoving] = createSignal<ProviderPickerAccount | null>(null);
  const [resetting, setResetting] = createSignal<ProviderPickerAccount | null>(null);
  const [disconnecting, setDisconnecting] = createSignal<ProviderPickerAccount | null>(null);
  const [error, setError] = createSignal<string | null>(null);
  /** How the last usage reset ended, when it did not fail. */
  const [notice, setNotice] = createSignal<string | null>(null);
  const [usageResets, setUsageResets] = createSignal<readonly ProviderUsageResets[]>([]);
  const run = (name: string, action: () => Promise<void> | undefined) => {
    setError(null);
    setNotice(null);
    void Promise.resolve(action()).catch((failure: unknown) =>
      setError(errorMessage(failure, t("provider.account.actionFailed", { name }))),
    );
  };
  /** The credits are read again when an account connects or goes, and after each reset. Only the last read counts. */
  let resetsRead = 0;
  const readUsageResets = (): void => {
    const serial = ++resetsRead;
    const read = props.accountActions?.usageResets;
    const apply = (readings: readonly ProviderUsageResets[]) => {
      if (serial === resetsRead) setUsageResets(readings);
    };
    if (read) void read(props.option.id).then(apply, () => apply([]));
    else apply([]);
  };
  // The actions can arrive after the page: a joined server's capabilities come after its status.
  createEffect(
    () => [
      props.option.id,
      accounts()
        .map((account) => `${account.id}:${account.state}`)
        .join(),
      props.accountActions?.usageResets,
    ],
    readUsageResets,
  );
  const resetsLeft = (accountId: string) =>
    usageResets().find((reading) => reading.accountId === accountId)?.available ?? 0;
  const resetUsage = async (target: ProviderPickerAccount) => {
    const name = providerAccountName(t, accounts(), target.id);
    setError(null);
    setNotice(null);
    try {
      const outcome = await props.accountActions?.resetUsage?.(props.option.id, target.id);
      if (outcome) {
        const text: Record<ProviderUsageResetOutcome, string> = {
          reset: t("provider.account.resetUsageDone", { name }),
          nothingToReset: t("provider.account.resetUsageNothing", { name }),
          noCredit: t("provider.account.resetUsageNoCredit", { name }),
          alreadyRedeemed: t("provider.account.resetUsageAlreadyRedeemed", { name }),
        };
        setNotice(text[outcome]);
      }
    } catch (failure) {
      setError(errorMessage(failure, t("provider.account.resetUsageFailed", { name })));
    }
    setResetting(null);
    readUsageResets();
  };
  const adding = () => accounts().some((account) => account.state === "connecting" && account.email == null);
  const removeDescription = (account: ProviderPickerAccount | null) => {
    if (!account) return "";
    const first = accounts()[0];
    const firstName = first ? providerAccountName(t, accounts(), first.id) : "";
    const agents = account.usedBy ?? [];
    const move =
      agents.length > 0
        ? t("provider.settings.removeMoves", { agents: format.list(agents), name: firstName })
        : t("provider.settings.removeUnused");
    return `${move} ${t("provider.settings.removeCredentials")}`;
  };
  const disconnectDescription = (account: ProviderPickerAccount | null) => {
    if (!account) return "";
    const provider = props.option.name;
    const agents = account.usedBy ?? [];
    return [
      props.accountActions?.local
        ? t("provider.settings.disconnectLocal", { provider })
        : t("provider.settings.disconnectHost", { provider }),
      agents.length > 0
        ? t("provider.settings.accountBlocked", { agents: format.list(agents) })
        : t("provider.settings.removeUnused"),
      accounts().length > 1 ? t("provider.settings.disconnectOthers", { provider }) : null,
    ]
      .filter(Boolean)
      .join(" ");
  };
  return (
    <SettingsSection
      title={t("provider.settings.accounts")}
      description={t("provider.settings.accountsDescription", {
        count: accounts().length,
        max: MAX_PROVIDER_ACCOUNTS,
      })}
      actions={
        <Button
          type="button"
          variant="outline"
          size="sm"
          aria-label={t("provider.account.addLabel", { name: props.option.name })}
          disabled={
            props.disabled || !props.row.accountsOffered() || accounts().length >= MAX_PROVIDER_ACCOUNTS || adding()
          }
          onClick={props.row.addAccount}
        >
          <UserRoundPlus aria-hidden="true" />
          {t("provider.account.add")}
        </Button>
      }
    >
      <ItemGroup class="settings-modal-card" aria-label={t("provider.account.listLabel", { name: props.option.name })}>
        <For each={accounts()} keyed={(account) => account.id}>
          {(account) => (
            <AccountRow
              {...props}
              account={account()}
              accounts={accounts()}
              run={run}
              onRemove={() => setRemoving({ ...account() })}
              onDisconnect={
                props.accountActions?.signOut && SIGN_OUT_PROVIDERS.has(props.option.id)
                  ? () => setDisconnecting({ ...account() })
                  : undefined
              }
              resetsLeft={props.accountActions?.resetUsage ? resetsLeft(account().id) : 0}
              onResetUsage={() => setResetting({ ...account() })}
            />
          )}
        </For>
      </ItemGroup>
      <Show when={props.option.checkError}>
        {(message) => <ItemDescription>{sourceText(message())}</ItemDescription>}
      </Show>
      <Show when={notice()}>{(message) => <ItemDescription role="status">{message()}</ItemDescription>}</Show>
      {/* A Reconnect of the provider's own sign-in reports here, as the sign-in card does. */}
      <Show
        when={
          props.row.connectError() ??
          props.row.accountError() ??
          error() ??
          (props.row.statusMessage() ? sourceText(props.row.statusMessage() ?? "") : null)
        }
      >
        {(message) => (
          <ItemDescription class="provider-settings-error" role="alert">
            {message()}
          </ItemDescription>
        )}
      </Show>
      <ConfirmDialog
        open={removing() !== null}
        tone="destructive"
        title={t("provider.settings.removeTitle", {
          name: removing() ? providerAccountName(t, accounts(), removing()?.id ?? "") : "",
        })}
        description={removeDescription(removing())}
        confirmLabel={t("provider.account.remove")}
        onCancel={() => setRemoving(null)}
        onConfirm={() => {
          const target = removing();
          setRemoving(null);
          if (target) {
            run(providerAccountName(t, accounts(), target.id), () =>
              props.accountActions?.remove(props.option.id, target.id),
            );
          }
        }}
      />
      <ConfirmDialog
        open={disconnecting() !== null}
        tone="destructive"
        title={t("provider.settings.disconnectTitle", {
          name: disconnecting() ? providerAccountName(t, accounts(), disconnecting()?.id ?? "") : "",
        })}
        description={disconnectDescription(disconnecting())}
        confirmLabel={t("provider.account.disconnect")}
        onCancel={() => setDisconnecting(null)}
        onConfirm={() => {
          const target = disconnecting();
          setDisconnecting(null);
          if (target) {
            run(providerAccountName(t, accounts(), target.id), () => props.accountActions?.signOut?.(props.option.id));
          }
        }}
      />
      <ConfirmDialog
        open={resetting() !== null}
        tone="default"
        icon={<Gauge aria-hidden="true" />}
        title={t("provider.account.resetUsageTitle", {
          name: resetting() ? providerAccountName(t, accounts(), resetting()?.id ?? "") : "",
        })}
        description={t("provider.account.resetUsageDescription", {
          count: resetsLeft(resetting()?.id ?? ""),
        })}
        confirmLabel={t("provider.account.resetUsage")}
        pendingLabel={t("provider.account.resetUsagePending")}
        initialFocus="cancel"
        onCancel={() => setResetting(null)}
        onConfirm={() => {
          const target = resetting();
          return target ? resetUsage(target) : undefined;
        }}
      />
    </SettingsSection>
  );
}
const ACCOUNT_STATE_TEXT = {
  connected: "provider.status.connected",
  connecting: "provider.account.finishSignIn",
  checking: "provider.status.checking",
  "signed-out": "provider.status.signInRequired",
  error: "provider.account.failed",
} as const satisfies Record<ProviderAccountState, AppTextKey>;

/** One account. Its text says what is wrong; the right edge has at most one button, then the ⋯ menu. */
function AccountRow(
  props: SectionProps & {
    account: ProviderPickerAccount;
    accounts: readonly ProviderPickerAccount[];
    run: (name: string, action: () => Promise<void> | undefined) => void;
    onRemove: () => void;
    /** Absent where the provider's own sign-in cannot be signed out here. */
    onDisconnect: (() => void) | undefined;
    /** The usage reset credits the provider gave this account; the menu offers a reset only when there is one. */
    resetsLeft: number;
    onResetUsage: () => void;
  },
) {
  const { t, format } = useText();
  const [renaming, setRenaming] = createSignal(false);
  const name = () => providerAccountName(t, props.accounts, props.account.id);
  const own = () => props.account.id === DEFAULT_PROVIDER_ACCOUNT_ID;
  /** The saved key's account: the key dialog changes or removes it, and it has no sign-in or plan usage. */
  const apiKey = () => isApiKeyAccount(props.account.id);
  // A state that a newer host added shows as a failure.
  const state = (): ProviderAccountState =>
    Object.hasOwn(ACCOUNT_STATE_TEXT, props.account.state) ? props.account.state : "error";
  const needsSignIn = () => state() === "signed-out" || state() === "error";
  /** The own account signs in again with the provider's Reconnect, so only the others have their own. */
  const signInAgain = () => !own() && !apiKey() && needsSignIn();
  const connecting = () => !own() && !apiKey() && state() === "connecting";
  /** A Reconnect of the provider waits for the browser. */
  const ownSigningIn = () => own() && props.row.signingIn();
  const agents = () => props.account.usedBy ?? [];
  const detail = () =>
    [
      props.account.email && props.account.email !== name() ? props.account.email : null,
      agents().length > 0 ? t("provider.account.usedBy", { agents: format.list(agents()) }) : null,
    ]
      .filter(Boolean)
      .join(" · ");
  const usage = () =>
    state() === "connected"
      ? props.usage?.find(
          (reading) =>
            reading.provider === props.option.id &&
            (reading.accountId ?? DEFAULT_PROVIDER_ACCOUNT_ID) === props.account.id,
        )
      : undefined;
  /** A provider with no runtime on this computer reconnects in the browser, as its sign-in card does. */
  const reconnect = (): "reconnect" | null =>
    own() && (props.row.runtimeAction() === "reconnect" || (!props.row.runtimeStatus() && props.row.browserConnect()))
      ? "reconnect"
      : null;
  return (
    <Item class="settings-modal-row provider-settings-account">
      <ItemContent>
        <Show when={renaming()} fallback={<ItemTitle>{name()}</ItemTitle>}>
          <ProviderAccountRenameField
            value={props.account.label ?? ""}
            placeholder={name()}
            label={t("provider.account.renameLabel", { name: name() })}
            onDone={(value) => {
              setRenaming(false);
              if (value === null || value === (props.account.label ?? "")) return;
              props.run(name(), () => props.accountActions?.rename(props.option.id, props.account.id, value || null));
            }}
          />
        </Show>
        <Show when={detail()}>{(text) => <ItemDescription>{text()}</ItemDescription>}</Show>
        <Show when={ownSigningIn()}>
          <ItemDescription>{t("provider.connecting.browserHint")}</ItemDescription>
        </Show>
        <Show when={state() !== "connected"}>
          <ItemDescription class={{ "provider-settings-warning": needsSignIn() }}>
            {props.account.message ?? t(ACCOUNT_STATE_TEXT[state()])}
            <Show when={needsSignIn() && agents().length > 0}>
              {` ${t("provider.settings.accountBlocked", { agents: format.list(agents()) })}`}
            </Show>
          </ItemDescription>
        </Show>
      </ItemContent>
      <ItemActions>
        <Show when={usage()}>{(reading) => <UsageBadge reading={reading()} name={name()} />}</Show>
        <Show when={signInAgain()}>
          <Button
            type="button"
            size="sm"
            disabled={props.disabled}
            onClick={() => props.run(name(), () => props.accountActions?.connect(props.option.id, props.account.id))}
          >
            <LogIn aria-hidden="true" />
            {t("provider.account.signInAgain")}
          </Button>
        </Show>
        <Show when={connecting()}>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={props.disabled}
            onClick={() => props.run(name(), () => props.accountActions?.cancel(props.option.id, props.account.id))}
          >
            {t("common.cancel")}
          </Button>
        </Show>
        <Show when={ownSigningIn() && props.onCancelProviderSignIn}>
          <Button
            type="button"
            variant="outline"
            size="sm"
            aria-label={t("provider.aria.cancelSignIn", { name: props.option.name })}
            disabled={props.disabled}
            onClick={props.row.cancelSignIn}
          >
            {t("common.cancel")}
          </Button>
        </Show>
        <DropdownMenu.Root placement="bottom-end" gutter={4} modal={false}>
          <MenuTrigger label={t("provider.account.moreActions", { name: name() })} disabled={props.disabled} />
          <DropdownMenu.Portal mount={props.menuMount ?? document.body}>
            <DropdownMenu.Content>
              <DropdownMenu.Item onSelect={() => setRenaming(true)}>
                <Pencil aria-hidden="true" />
                {t("common.rename")}
              </DropdownMenu.Item>
              <Show when={state() === "connected" && !apiKey() && props.resetsLeft > 0}>
                <DropdownMenu.Item onSelect={() => props.onResetUsage()}>
                  <Gauge aria-hidden="true" />
                  {t("provider.account.resetUsage")}
                </DropdownMenu.Item>
              </Show>
              <Show when={reconnect()}>
                {(action) => (
                  <DropdownMenu.Item onSelect={() => props.row.runAction(action())}>
                    <RotateCcw aria-hidden="true" />
                    {t(PROVIDER_ACTION_TEXT[action()])}
                  </DropdownMenu.Item>
                )}
              </Show>
              <Show when={own()}>
                <AlternativeItem row={props.row} />
              </Show>
              <Show when={apiKey()}>
                <DropdownMenu.Item onSelect={() => void props.onSignInProvider?.(props.option.id)}>
                  <KeyRound aria-hidden="true" />
                  {t("provider.settings.changeKey")}
                </DropdownMenu.Item>
              </Show>
              <Show when={!own() && !apiKey()}>
                <DropdownMenu.Separator />
                <DropdownMenu.Item onSelect={() => props.onRemove()}>
                  <Trash2 aria-hidden="true" />
                  {t("provider.account.remove")}
                </DropdownMenu.Item>
              </Show>
              <Show when={own() && state() === "connected" && props.onDisconnect}>
                {(disconnect) => (
                  <>
                    <DropdownMenu.Separator />
                    <DropdownMenu.Item onSelect={() => disconnect()()}>
                      <LogOut aria-hidden="true" />
                      {t("provider.account.disconnect")}
                    </DropdownMenu.Item>
                  </>
                )}
              </Show>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      </ItemActions>
    </Item>
  );
}

/** The reset countdown shows minutes, so a half-minute tick keeps it current. */
const RESET_CLOCK_MS = 30_000;

/** A badge for a low limit. It opens every limit of the account, as the usage popover shows them. */
function UsageBadge(props: { reading: AccountUsageProviderRow; name: string }) {
  /** The limit that stops work first, when it is low. */
  const low = () =>
    props.reading.windows
      .filter((window) => window.tone !== "neutral")
      .sort((left, right) => left.remainingPercent - right.remainingPercent)[0];
  return (
    <Show when={low()}>{(limit) => <LowUsageBadge reading={props.reading} name={props.name} limit={limit()} />}</Show>
  );
}

/** The reset clock runs only while the badge shows. */
function LowUsageBadge(props: { reading: AccountUsageProviderRow; name: string; limit: AccountUsageWindowRow }) {
  const { t, format } = useText();
  const [now, setNow] = createSignal(Date.now());
  const clock = window.setInterval(() => setNow(Date.now()), RESET_CLOCK_MS);
  onCleanup(() => window.clearInterval(clock));
  const limit = () => props.limit;
  return (
    <Popover.Root placement="bottom-end" gutter={6} modal>
      <Popover.Trigger
        class={badgeVariants({
          variant: limit().tone === "critical" ? "destructive-light" : "warning-light",
          class: "provider-settings-usage-badge",
        })}
      >
        {t("provider.settings.usageLow", {
          percent: format.percent(limit().remainingPercent / 100),
          window: limit().label,
        })}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content class="ui-popover-menu-surface account-usage-popover">
          <Popover.Title class="sr-only">{t("provider.settings.usageOf", { name: props.name })}</Popover.Title>
          <ul class="account-usage-providers">
            <li class="account-usage-provider">
              <ProviderLogo provider={props.reading.provider} class="account-usage-provider-logo" />
              <strong class="account-usage-provider-name">{props.name}</strong>
              <AccountUsageWindowList windows={props.reading.windows} now={now()} />
            </li>
          </ul>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

/* ---------------------------------------------- Sign-in (one account) */

/** The provider's one sign-in: the same buttons that its onboarding row has, on a card. */
function SignInSection(props: SectionProps & { keyShown: boolean }) {
  const { t, format, sourceText } = useText();
  const row = () => props.row;
  /** Download, its cancel and its retry are on the Version row. */
  const connectAction = () => {
    const action = row().runtimeAction();
    return action === "connect" || action === "reconnect" || action === "restart" ? action : undefined;
  };
  const browserAction = () => providerAction(row().state(), row().connecting());
  /** The key providers open the key dialog from their API key card. */
  const signInButton = () => row().signInOffered() && !props.keyShown;
  const title = () =>
    props.option.email ?? providerStatusLabel(t, format, row().state(), row().connecting(), undefined);
  const messages = () =>
    [
      props.option.checkError ? sourceText(props.option.checkError) : null,
      row().hostSignInHint() ? t("provider.gemini.hostSignIn") : null,
      row().signingIn() ? t("provider.connecting.browserHint") : null,
    ].filter((text): text is string => Boolean(text));
  const error = () => row().connectError() ?? (row().statusMessage() ? sourceText(row().statusMessage() ?? "") : null);
  return (
    <SettingsSection title={t("provider.settings.signIn")}>
      <ItemGroup class="settings-modal-card">
        <Item class="settings-modal-row">
          <ItemContent>
            <ItemTitle>{title()}</ItemTitle>
            <For each={messages()}>{(text) => <ItemDescription>{text}</ItemDescription>}</For>
            <Show when={error()}>
              {(message) => (
                <ItemDescription
                  class={{
                    "provider-settings-error":
                      Boolean(row().connectError()) ||
                      row().state() === "error" ||
                      row().runtimeStatus()?.phase === "download-error",
                  }}
                >
                  {message()}
                </ItemDescription>
              )}
            </Show>
          </ItemContent>
          <ItemActions>
            <Show when={row().codeFallbackOffered()}>
              <Button
                type="button"
                variant="outline"
                size="sm"
                aria-label={t("provider.aria.codeFallback", { name: props.option.name })}
                disabled={props.disabled}
                onClick={row().signInAlternative}
              >
                {t("provider.action.signInWithCode")}
              </Button>
            </Show>
            <Show when={row().signingIn() && props.onCancelProviderSignIn}>
              <Button
                type="button"
                variant="outline"
                size="sm"
                aria-label={t("provider.aria.cancelSignIn", { name: props.option.name })}
                disabled={props.disabled}
                onClick={row().cancelSignIn}
              >
                {t("common.cancel")}
              </Button>
            </Show>
            <Show when={connectAction()}>
              {(action) => (
                <Button
                  type="button"
                  variant={action() === "connect" && !row().connectOptional() ? "default" : "outline"}
                  size="sm"
                  aria-label={t(PROVIDER_ACTION_LABEL[action()], { name: props.option.name })}
                  disabled={props.disabled}
                  onClick={() => row().runAction(action())}
                >
                  {t(PROVIDER_ACTION_TEXT[action()])}
                </Button>
              )}
            </Show>
            <Show when={row().installOffered()}>
              <Button
                type="button"
                variant="outline"
                size="sm"
                aria-label={t("provider.aria.install", { name: props.option.name })}
                disabled={props.disabled}
                onClick={() => void props.onInstallProvider?.(props.option.id)}
              >
                {t("provider.action.install")}
              </Button>
            </Show>
            <Show when={!row().runtimeStatus() && (row().browserConnect() || row().keyConnect())}>
              <Button
                type="button"
                variant={browserAction() === "connect" ? "default" : "outline"}
                size="sm"
                aria-label={t(PROVIDER_ACTION_LABEL[browserAction()], { name: props.option.name })}
                loading={row().connecting()}
                loadingLabel={t("provider.status.connecting")}
                disabled={props.disabled}
                onClick={row().connect}
              >
                {t(PROVIDER_ACTION_TEXT[browserAction()])}
              </Button>
            </Show>
            <Show when={signInButton()}>
              <Button
                type="button"
                variant="outline"
                size="sm"
                aria-label={t("provider.aria.signIn", { name: props.option.name })}
                disabled={props.disabled}
                onClick={() => void props.onSignInProvider?.(props.option.id)}
              >
                {t("provider.action.signIn")}
              </Button>
            </Show>
            <Show when={row().alternative()}>
              <DropdownMenu.Root placement="bottom-end" gutter={4} modal={false}>
                <MenuTrigger
                  label={t("provider.aria.moreActions", { name: props.option.name })}
                  disabled={props.disabled}
                />
                <DropdownMenu.Portal mount={props.menuMount ?? document.body}>
                  <DropdownMenu.Content>
                    <AlternativeItem row={row()} />
                  </DropdownMenu.Content>
                </DropdownMenu.Portal>
              </DropdownMenu.Root>
            </Show>
          </ItemActions>
        </Item>
      </ItemGroup>
    </SettingsSection>
  );
}

/* ---------------------------------------------- API key */

function ApiKeySection(props: SectionProps) {
  const { t } = useText();
  const saved = () => props.option.keyStatus === "saved";
  const title = () => {
    if (saved()) return t("provider.settings.keySaved");
    return props.option.keyStatus ? t("provider.settings.noKey") : t("provider.action.apiKey");
  };
  return (
    <SettingsSection title={t("provider.settings.apiKey")}>
      <ItemGroup class="settings-modal-card">
        <Item class="settings-modal-row">
          <ItemContent>
            <ItemTitle>{title()}</ItemTitle>
            <ItemDescription>
              {props.option.id === "opencode"
                ? t("provider.settings.keyOptional")
                : props.option.id === "antigravity" && saved()
                  ? t("provider.settings.geminiKeyInUse")
                  : props.option.id === "claude" && saved()
                    ? t("provider.settings.claudeKeyInUse")
                    : props.option.id === "codex"
                      ? saved()
                        ? t("provider.settings.codexKeyInUse")
                        : t("provider.settings.codexKeyAlternative")
                      : t("provider.settings.keyAlternative", { name: props.option.name })}
            </ItemDescription>
          </ItemContent>
          <ItemActions>
            <Show when={props.row.freeKey()}>
              <Badge variant="secondary">{t("provider.key.free")}</Badge>
            </Show>
            <Button
              type="button"
              variant="outline"
              size="sm"
              aria-label={t("provider.aria.apiKey", { name: props.option.name })}
              disabled={props.disabled}
              onClick={() => void props.onSignInProvider?.(props.option.id)}
            >
              {saved() ? t("provider.settings.changeKey") : t("provider.settings.addKey")}
            </Button>
          </ItemActions>
        </Item>
      </ItemGroup>
    </SettingsSection>
  );
}

/* ---------------------------------------------- Runtime */

function RuntimeSection(props: SectionProps) {
  const { t, format, sourceText } = useText();
  const row = () => props.row;
  const runtime = () => row().runtimeStatus();
  /** The download, its cancel or its retry. */
  const storeAction = () => {
    const action = row().runtimeAction();
    return action === "download" || action === "cancel" || action === "retry" ? action : undefined;
  };
  const progress = () =>
    runtime()?.phase === "downloading" ? Math.round(Math.max(0, Math.min(100, runtime()?.progress ?? 0))) : null;
  const versionLine = () => {
    const current = runtime();
    if (!current) return null;
    if (current.phase === "not-downloaded") return t("provider.status.notDownloaded");
    if (current.phase === "download-error")
      return current.message ?? providerStatusLabel(t, format, row().state(), false, current);
    if (current.phase === "downloading" || current.phase === "finishing") {
      return current.message ?? providerStatusLabel(t, format, row().state(), false, current);
    }
    const installed = row().version();
    if (row().updatable() && installed) {
      return t("provider.settings.versionAvailable", { installed, available: props.option.availableVersion ?? "" });
    }
    return installed;
  };
  /** The sign-in card already shows a check error, so the same text does not show twice. */
  const lastError = () =>
    props.option.lastError && props.option.lastError !== props.option.checkError ? props.option.lastError : null;
  const shown = () =>
    Boolean(runtime()) || row().restartOffered() || Boolean(lastError()) || row().diagnosticsOffered();
  return (
    <Show when={shown()}>
      <SettingsSection title={t("provider.settings.runtime")}>
        <ItemGroup class="settings-modal-card">
          <Show when={runtime()}>
            <Item class="settings-modal-row">
              <ItemContent>
                <ItemTitle>{t("provider.settings.version")}</ItemTitle>
                <Show when={versionLine()}>
                  {(line) => (
                    <ItemDescription class={{ "provider-settings-error": runtime()?.phase === "download-error" }}>
                      {sourceText(line())}
                    </ItemDescription>
                  )}
                </Show>
                <Show when={progress() !== null}>
                  <Progress
                    class="provider-settings-progress"
                    value={progress() ?? 0}
                    aria-label={t("provider.settings.downloadLabel", { name: props.option.name })}
                  />
                </Show>
              </ItemContent>
              <ItemActions>
                <Show
                  when={storeAction()}
                  fallback={
                    <Show when={row().updateOffered()}>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={props.disabled || row().connecting()}
                        onClick={() => void props.onUpdateProvider?.(props.option.id)}
                      >
                        {row().updatable() ? t("provider.settings.update") : t("provider.action.checkForUpdates")}
                      </Button>
                    </Show>
                  }
                >
                  {(action) => (
                    <Button
                      type="button"
                      variant={action() === "download" ? "default" : "outline"}
                      size="sm"
                      aria-label={t(PROVIDER_ACTION_LABEL[action()], { name: props.option.name })}
                      disabled={props.disabled}
                      onClick={() => row().runAction(action())}
                    >
                      {t(PROVIDER_ACTION_TEXT[action()])}
                    </Button>
                  )}
                </Show>
              </ItemActions>
            </Item>
          </Show>
          <Show when={row().restartOffered()}>
            <Item class="settings-modal-row">
              <ItemContent>
                <ItemTitle>{t("provider.action.restart")}</ItemTitle>
                <Show when={props.option.restartPending}>
                  <ItemDescription role="status">{t("provider.restartPending")}</ItemDescription>
                </Show>
              </ItemContent>
              <ItemActions>
                <Show
                  when={props.option.restartPending}
                  fallback={
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      aria-label={t("provider.aria.restart", { name: props.option.name })}
                      disabled={props.disabled}
                      onClick={() => void props.onRestartProvider?.(props.option.id)}
                    >
                      {t("provider.action.restart")}
                    </Button>
                  }
                >
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={props.disabled}
                    onClick={() => void props.onCancelProviderRestart?.(props.option.id)}
                  >
                    <X aria-hidden="true" />
                    {t("provider.action.cancelRestart")}
                  </Button>
                </Show>
              </ItemActions>
            </Item>
          </Show>
          <Show when={lastError() || row().diagnosticsOffered()}>
            <Item class="settings-modal-row">
              <ItemContent>
                <ItemTitle>{t("provider.settings.diagnostics")}</ItemTitle>
                <Show when={lastError()}>
                  {(detail) => (
                    <ItemDescription class="provider-settings-error">
                      {t("provider.lastError", { detail: sourceText(detail()) })}
                    </ItemDescription>
                  )}
                </Show>
              </ItemContent>
              <Show when={row().diagnosticsOffered()}>
                <ItemActions>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => void navigator.clipboard.writeText(props.option.diagnostics ?? "")}
                  >
                    <Copy aria-hidden="true" />
                    {t("provider.action.copyDiagnostics")}
                  </Button>
                </ItemActions>
              </Show>
            </Item>
          </Show>
        </ItemGroup>
      </SettingsSection>
    </Show>
  );
}

/* ---------------------------------------------- Prompt cache */

/** Claude only: the other providers take no cache time. A change applies to the next Claude process. */
function PromptCacheSection(props: {
  cache: ProviderPromptCache;
  disabled: boolean | undefined;
  menuMount: HTMLElement | undefined;
}) {
  const { t } = useText();
  const label = (ttl: PromptCacheTtl) =>
    ttl === "1h" ? t("provider.settings.promptCacheHour") : t("provider.settings.promptCacheDefault");
  return (
    <SettingsSection title={t("provider.settings.cache")}>
      <ItemGroup class="settings-modal-card">
        <Item class="settings-modal-row">
          <ItemContent>
            <ItemTitle id="provider-settings-prompt-cache-label">{t("provider.settings.promptCache")}</ItemTitle>
            <Show
              when={props.cache.error}
              fallback={<ItemDescription>{t("provider.settings.promptCacheDescription")}</ItemDescription>}
            >
              {(message) => (
                <ItemDescription class="provider-settings-error" role="alert">
                  {message()}
                </ItemDescription>
              )}
            </Show>
          </ItemContent>
          <Show when={props.cache.value}>
            {(value) => (
              <ItemActions>
                <Select<PromptCacheTtl>
                  options={[...PROMPT_CACHE_TTLS]}
                  value={value()}
                  disabled={Boolean(props.disabled || props.cache.pending)}
                  placement="bottom-end"
                  // The select also reports the value that it shows, which is not a choice of the user.
                  onChange={(ttl) => {
                    if (ttl && ttl !== props.cache.value) props.cache.onChange(ttl);
                  }}
                  itemComponent={(item) => <SelectItem item={item.item}>{label(item.item.rawValue)}</SelectItem>}
                >
                  <SelectTrigger size="sm" aria-labelledby="provider-settings-prompt-cache-label">
                    <SelectValue<PromptCacheTtl>>
                      {(state) => {
                        const selected = state.selectedOption();
                        return selected ? label(selected) : "";
                      }}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent mount={props.menuMount} />
                </Select>
              </ItemActions>
            )}
          </Show>
        </Item>
      </ItemGroup>
    </SettingsSection>
  );
}

/* ---------------------------------------------- Use */

/** The default and the switch, at the end of the page, as the other settings pages keep their switches. */
function UseSection(props: SectionProps) {
  const { t, errorMessage } = useText();
  const [change, setChange] = createStore<{ pending: boolean; error: string | null }>({
    pending: false,
    error: null,
  });
  const usedBy = () => props.option.usedBy ?? [];
  const isDefault = () => props.defaultProvider?.value === props.option.id;
  const defaultName = () => {
    const value = props.defaultProvider?.value;
    if (value === "custom") return t("provider.custom.name");
    return props.options.find((option) => option.id === value)?.name ?? null;
  };
  const defaultLine = () => {
    if (isDefault()) return t("provider.settings.startsWith", { name: props.option.name });
    if (props.row.off()) return t("provider.settings.turnOnFirst", { name: props.option.name });
    if (!props.row.available()) return t("provider.settings.connectFirst", { name: props.option.name });
    const name = defaultName();
    return name ? t("provider.settings.startsWith", { name }) : null;
  };
  async function setOn(on: boolean) {
    if (!on && usedBy().length > 0) {
      showProviderInUse(t, usedBy(), props.option.name);
      return;
    }
    setChange((state) => {
      state.pending = true;
      state.error = null;
    });
    try {
      await props.onSetProviderOn?.(props.option.id, on);
    } catch (error) {
      setChange((state) => {
        state.error = errorMessage(error, t("error.provider.useChangeFailed"));
      });
    } finally {
      setChange((state) => {
        state.pending = false;
      });
    }
  }
  return (
    <Show when={props.defaultProvider || props.onSetProviderOn}>
      <SettingsSection title={t("provider.settings.use")}>
        <ItemGroup class="settings-modal-card">
          <Show when={props.defaultProvider}>
            {(choice) => (
              <Item class="settings-modal-row">
                <ItemContent>
                  <ItemTitle>{t("provider.settings.defaultForNew")}</ItemTitle>
                  <Show when={defaultLine()}>{(line) => <ItemDescription>{line()}</ItemDescription>}</Show>
                </ItemContent>
                <Show when={!isDefault()}>
                  <ItemActions>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      loading={choice().pending}
                      disabled={props.disabled || !props.row.available() || props.row.off()}
                      onClick={() => choice().onChange(props.option.id)}
                    >
                      {t("provider.settings.makeDefault")}
                    </Button>
                  </ItemActions>
                </Show>
              </Item>
            )}
          </Show>
          <Show when={props.onSetProviderOn}>
            <Item class="settings-modal-row">
              <ItemContent>
                <ItemTitle>{t("provider.settings.useTitle", { name: props.option.name })}</ItemTitle>
                <Show when={change.error}>
                  {(message) => (
                    <ItemDescription class="provider-settings-error" role="alert">
                      {message()}
                    </ItemDescription>
                  )}
                </Show>
              </ItemContent>
              <ItemActions>
                <Switch
                  checked={!props.row.off()}
                  disabled={Boolean(props.disabled || change.pending)}
                  aria-busy={change.pending ? "true" : "false"}
                  aria-label={t("provider.aria.use", { name: props.option.name })}
                  onChange={(on: boolean) => void setOn(on)}
                />
              </ItemActions>
            </Item>
          </Show>
        </ItemGroup>
      </SettingsSection>
    </Show>
  );
}

/**
 * The downloaded CLI of a provider that is off, with the action that removes it. The confirmation
 * stays in the card: a removal names its size there, and the provider downloads the CLI again later.
 */
function DownloadSection(props: SectionProps) {
  const { t, format, errorMessage } = useText();
  const [download, setDownload] = createStore<{
    bytes: number;
    versions: number;
    confirming: boolean;
    removing: boolean;
    /** Set by a removal on this page. An off provider can run a CLI the user installed instead. */
    removed: boolean;
    error: string | null;
  }>({ bytes: 0, versions: 0, confirming: false, removing: false, removed: false, error: null });
  let reads = 0;
  const measure = (provider: AgentProviderId, read: ProviderSettingsPageProps["onMeasureProviderDownload"]) => {
    const serial = ++reads;
    const apply = (measured: ProviderRuntimeDownload) => {
      if (serial === reads)
        setDownload((state) => {
          state.bytes = measured.bytes;
          state.versions = measured.versions;
        });
    };
    if (read) void read(provider).then(apply, () => apply({ bytes: 0, versions: 0 }));
    else apply({ bytes: 0, versions: 0 });
  };
  const offered = () => props.row.off() && Boolean(props.onRemoveProviderDownload);
  // Measured again when the provider is turned off. A provider that is off downloads nothing, and
  // a removal measures again itself.
  createEffect(
    () => ({ provider: props.option.id, read: offered() ? props.onMeasureProviderDownload : undefined }),
    ({ provider, read }) => {
      setDownload((state) => {
        state.removed = false;
      });
      measure(provider, read);
    },
  );
  const detail = () => {
    const values = { count: download.versions, size: format.fileSize(download.bytes) };
    const version = props.option.runtimeStatus?.version;
    return version
      ? t("provider.settings.downloadDetail", { ...values, version })
      : t("provider.settings.downloadVersions", values);
  };
  async function remove() {
    setDownload((state) => {
      state.removing = true;
      state.error = null;
    });
    try {
      await props.onRemoveProviderDownload?.(props.option.id);
      setDownload((state) => {
        state.confirming = false;
        state.removed = true;
      });
    } catch (error) {
      setDownload((state) => {
        state.error = errorMessage(error, t("provider.settings.removeDownloadFailed"));
      });
    } finally {
      setDownload((state) => {
        state.removing = false;
      });
    }
    measure(props.option.id, props.onMeasureProviderDownload);
  }
  return (
    <Show when={offered() && (download.bytes > 0 || download.removed)}>
      <SettingsSection title={t("provider.settings.download")}>
        <ItemGroup class="settings-modal-card">
          <Show
            when={download.bytes > 0}
            fallback={
              <Item class="settings-modal-row">
                <ItemContent>
                  <ItemTitle>{t("provider.status.notDownloaded")}</ItemTitle>
                  <ItemDescription>{t("provider.settings.downloadAgain", { name: props.option.name })}</ItemDescription>
                </ItemContent>
              </Item>
            }
          >
            <Item class="settings-modal-row">
              <ItemContent>
                <ItemTitle>{t("provider.settings.downloadedCli", { name: props.option.name })}</ItemTitle>
                <ItemDescription>{detail()}</ItemDescription>
              </ItemContent>
              <Show when={!download.confirming}>
                <ItemActions>
                  <Button
                    type="button"
                    variant="destructive-ghost"
                    size="sm"
                    disabled={props.disabled}
                    onClick={() =>
                      setDownload((state) => {
                        state.error = null;
                        state.confirming = true;
                      })
                    }
                  >
                    <Trash2 aria-hidden="true" />
                    {t("provider.settings.removeDownload")}
                  </Button>
                </ItemActions>
              </Show>
            </Item>
            <Show when={download.confirming}>
              <Item class="settings-modal-row">
                <ItemContent>
                  <ItemTitle>
                    {t("provider.settings.removeDownloadConfirm", { size: format.fileSize(download.bytes) })}
                  </ItemTitle>
                  <Show
                    when={download.error}
                    fallback={<ItemDescription>{t("provider.settings.removeDownloadKeeps")}</ItemDescription>}
                  >
                    {(message) => (
                      <ItemDescription class="provider-settings-error" role="alert">
                        {message()}
                      </ItemDescription>
                    )}
                  </Show>
                </ItemContent>
                <ItemActions>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={download.removing}
                    onClick={() =>
                      setDownload((state) => {
                        state.confirming = false;
                        state.error = null;
                      })
                    }
                  >
                    {t("common.cancel")}
                  </Button>
                  <Button
                    type="button"
                    variant="destructive"
                    size="sm"
                    loading={download.removing}
                    loadingLabel={t("provider.settings.removingDownload")}
                    disabled={props.disabled}
                    onClick={() => void remove()}
                  >
                    {t("common.remove")}
                  </Button>
                </ItemActions>
              </Item>
            </Show>
          </Show>
        </ItemGroup>
      </SettingsSection>
    </Show>
  );
}

/* ------------------------------------------------------------------ Custom endpoints */

/** OpenCode can run a custom endpoint, or Pi can where this computer offers it. */
function servesCustomEndpoints(props: ProviderSettingsPageProps): boolean {
  const option = (id: AgentProviderId) => props.options.find((candidate) => candidate.id === id);
  return (
    servesCustomProvider(option("opencode")) ||
    Boolean(props.customProviderHarnesses && servesCustomProvider(option("pi")))
  );
}

function CustomEndpointsPage(props: ProviderSettingsPageProps) {
  const { t, format } = useText();
  const endpoints = () => props.customProviders ?? [];
  const engine = () => props.options.find((option) => option.id === "opencode");
  const ready = () => servesCustomEndpoints(props);
  const runsOn = (endpoint: CustomProviderSummary) =>
    t("customProvider.list.runsOn", {
      name: agentProviderName(endpoint.harness ?? DEFAULT_CUSTOM_PROVIDER_HARNESS),
    });
  const [confirming, setConfirming] = createSignal<CustomProviderSummary | null>(null);
  return (
    <>
      <DetailHeader
        logo={<SlidersHorizontal class="provider-picker-custom-mark" aria-hidden="true" />}
        name={t("provider.custom.name")}
        status={endpoints().length > 0 ? "connected" : "idle"}
        statusLabel={
          endpoints().length > 0
            ? t("provider.endpointCount", { count: endpoints().length })
            : t("provider.status.notConnected")
        }
        subtitle={
          ready() || !engine()
            ? t("provider.custom.description")
            : providerStatusLabel(t, format, engine()?.state ?? "checking")
        }
      />
      <SettingsSection
        title={t("provider.settings.endpoints")}
        actions={
          <Button
            type="button"
            variant="outline"
            size="sm"
            aria-label={t("provider.custom.addLabel")}
            disabled={props.disabled || !ready()}
            onClick={() => props.onAddCustomProvider?.()}
          >
            <Plus aria-hidden="true" />
            {t("common.add")}
          </Button>
        }
      >
        <ItemGroup class="settings-modal-card" aria-label={t("customProvider.list.label")}>
          <Show
            when={endpoints().length > 0}
            fallback={
              <Item class="server-settings-empty-row">
                <ItemContent>
                  <ItemDescription>{t("provider.settings.noEndpoints")}</ItemDescription>
                </ItemContent>
              </Item>
            }
          >
            <For each={endpoints()} keyed={(endpoint) => endpoint.id}>
              {(endpoint) => (
                <Item class="settings-modal-row">
                  <ItemContent>
                    <ItemTitle>{endpoint().name}</ItemTitle>
                    <ItemDescription>
                      {t("provider.settings.endpointModels", {
                        url: endpoint().baseUrl,
                        count: endpoint().models.length,
                      })}
                      {endpoint().hasApiKey ? ` · ${t("customProvider.list.apiKeySaved")}` : ""}
                      {props.customProviderHarnesses ? ` · ${runsOn(endpoint())}` : ""}
                    </ItemDescription>
                  </ItemContent>
                  <Show when={props.onEditCustomProvider || props.onRemoveCustomProvider}>
                    <ItemActions>
                      <Show when={props.onEditCustomProvider}>
                        {(edit) => (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            aria-label={t("customProvider.list.editLabel", { name: endpoint().name })}
                            disabled={props.disabled || Boolean(props.removingCustomProvider)}
                            onClick={() => edit()(endpoint())}
                          >
                            <Pencil aria-hidden="true" />
                            {t("common.edit")}
                          </Button>
                        )}
                      </Show>
                      <Show when={props.onRemoveCustomProvider}>
                        <Button
                          type="button"
                          variant="destructive-ghost"
                          size="sm"
                          aria-label={t("customProvider.list.deleteLabel", { name: endpoint().name })}
                          loading={props.removingCustomProvider === endpoint().id}
                          disabled={props.disabled || Boolean(props.removingCustomProvider)}
                          onClick={() => setConfirming(endpoint())}
                        >
                          <Trash2 aria-hidden="true" />
                          {t("common.remove")}
                        </Button>
                      </Show>
                    </ItemActions>
                  </Show>
                </Item>
              )}
            </For>
          </Show>
        </ItemGroup>
      </SettingsSection>
      <ConfirmDialog
        open={confirming() !== null}
        tone="destructive"
        title={t("customProvider.list.confirmTitle", { name: confirming()?.name ?? "" })}
        description={t("customProvider.list.confirmDescription")}
        confirmLabel={t("common.remove")}
        onCancel={() => setConfirming(null)}
        onConfirm={() => {
          const target = confirming();
          setConfirming(null);
          if (target) props.onRemoveCustomProvider?.(target);
        }}
      />
    </>
  );
}
