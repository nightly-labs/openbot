import { ProviderLogo } from "@openbot/brand";
import {
  isInstallerProvider,
  isManagedRuntimeProvider,
  type ManagedProviderId,
} from "@openbot/contracts/agent-providers";
import {
  type AgentModelId,
  type AgentProviderId,
  type AgentProviderStatus,
  agentProviderName,
  type ClaudeCompactWindowSetting,
  type CustomProviderSummary,
  claudeCompactWindowSizes,
  DEFAULT_CUSTOM_PROVIDER_HARNESS,
  DEFAULT_PROVIDER_ACCOUNT_ID,
  isProviderEnvironmentProvider,
  MAX_PROVIDER_ACCOUNTS,
  PROMPT_CACHE_TTLS,
  PROVIDER_ACCOUNT_POOL_STRATEGIES,
  type PromptCacheTtl,
  type ProviderAccountPool,
  type ProviderAccountPoolStrategy,
  type ProviderAccountState,
  type ProviderEnvironment,
  type ProviderEnvironmentVariableInput,
  type ProviderModelVisibility,
  type ProviderRuntimeDownload,
  type ProviderUsageResetOutcome,
  type ProviderUsageResets,
  providerEnvironmentProblem,
} from "@openbot/contracts/ipc";
import type { AppFormat, AppMessages, AppTextKey, AppTranslate } from "@openbot/i18n";
import {
  Badge,
  Button,
  badgeVariants,
  buttonVariants,
  ChevronRight,
  CirclePause,
  CirclePlus,
  ConfirmDialog,
  Copy,
  DropdownMenu,
  Ellipsis,
  Gauge,
  Globe2,
  IconButton,
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
  Text,
  Trash2,
  UserRoundPlus,
  X,
} from "@openbot/ui";
import type { JSX } from "@solidjs/web";
import { createEffect, createMemo, createSignal, createStore, For, onCleanup, Show, untrack } from "solid-js";
import { ProviderAccountRenameField } from "../../components/ProviderAccountList";
import type { ProviderPickerOption } from "../../components/ProviderPicker";
import {
  accountCodeSignInOffered,
  earlierAccountWithSameEmail,
  hasKeyAccounts,
  isApiKeyAccount,
  isProviderKeyAccount,
  type ProviderPickerAccount,
  providerAccountName,
} from "../../components/provider-accounts";
import {
  createProviderRow,
  customEngineDownloadAction,
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
import { toast } from "../../toast";
import { AccountUsageWindowList } from "../account/AccountUsageDetails";
import type { AccountUsageProviderRow, AccountUsageWindowRow } from "../account/account-usage-view";
import { providerUpdateAvailable, providerVersionLabel } from "../provider-updates/provider-update";
import { DangerZone, DetailHeader, type IntegrationStatus } from "./IntegrationLayout";
import { type KeyDialogText, OpenCodeKeyDialog, type ProviderKeyApi } from "./OpenCodeKeyDialog";

export interface ProviderSettingsDetail {
  title: string;
  back: () => void;
}

export type ProviderDefaultChoice = AgentProviderId | "custom";

export interface ProviderPromptCache {
  value: PromptCacheTtl | null;
  appliesToPi: boolean;
  pending: boolean;
  error: string | null;
  onChange: (ttl: PromptCacheTtl) => void;
  compaction?: ProviderCacheExpiryCompaction | undefined;
}

export interface ProviderCacheExpiryCompaction {
  value: boolean | null;
  pending: boolean;
  error: string | null;
  onChange: (enabled: boolean) => void;
}

export interface ProviderClaudeCompactWindow {
  value: ClaudeCompactWindowSetting | null;
  pending: boolean;
  error: string | null;
  onChange: (tokens: number | null) => void;
}

export interface ProviderEnvironmentControl {
  value: ProviderEnvironment | null;
  pending: boolean;
  error: string | null;
  onSave: (variables: ProviderEnvironmentVariableInput[]) => void;
}

export interface ProviderClaudeUserSetup {
  value: boolean | null;
  pending: boolean;
  error: string | null;
  remote?: boolean;
  onChange: (enabled: boolean) => void;
}

export interface ProviderModelVisibilityControl {
  list: ProviderModelVisibility | null;
  error: string | null;
  onChange: (shown: AgentModelId[]) => void;
  onReset: () => void;
}

export interface ProviderSettingsPageProps extends ProviderRowHost {
  options: ProviderPickerOption[];
  defaultProvider?:
    | {
        value: ProviderDefaultChoice | null;
        pending: boolean;
        onChange: (choice: ProviderDefaultChoice) => void;
      }
    | undefined;
  disabled?: boolean | undefined;
  onCancelProviderRestart?: ((provider: AgentProviderId) => void | Promise<void>) | undefined;
  onChooseInstalledCli?: ((provider: ManagedProviderId, installed: boolean) => void | Promise<void>) | undefined;
  onSetProviderOn?: ((provider: AgentProviderId, on: boolean) => void | Promise<void>) | undefined;
  onMeasureProviderDownload?: ((provider: AgentProviderId) => Promise<ProviderRuntimeDownload>) | undefined;
  onRemoveProviderDownload?: ((provider: AgentProviderId) => Promise<void>) | undefined;
  usage?: readonly AccountUsageProviderRow[] | undefined;
  menuMount?: HTMLElement | undefined;
  customProviders?: readonly CustomProviderSummary[] | undefined;
  onAddCustomProvider?: (() => void) | undefined;
  onEditCustomProvider?: ((provider: CustomProviderSummary) => void) | undefined;
  customProviderHarnesses?: boolean | undefined;
  onRemoveCustomProvider?: ((provider: CustomProviderSummary) => void) | undefined;
  removingCustomProvider?: string | null | undefined;
  onDetailChange?: ((detail: ProviderSettingsDetail | null) => void) | undefined;
  promptCache?: ProviderPromptCache | undefined;
  claudeUserSetup?: ProviderClaudeUserSetup | undefined;
  claudeCompactWindow?: ProviderClaudeCompactWindow | undefined;
  environment?: ((provider: AgentProviderId) => ProviderEnvironmentControl | undefined) | undefined;
  modelVisibility?: ((provider: AgentProviderId) => ProviderModelVisibilityControl) | undefined;
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
  const page = (): PageId | null => {
    if (open() === "custom") return customOffered() ? "custom" : null;
    return openOption()?.id ?? null;
  };
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

function isConnected(option: ProviderPickerOption): boolean {
  return !option.off && (option.state === "available" || option.connectionState === "connecting");
}

function updateOffered(option: ProviderPickerOption): boolean {
  const runtime = option.runtimeStatus;
  return (
    !option.off &&
    !isInstallerProvider(option.id) &&
    runtime !== undefined &&
    providerUpdateAvailable(runtime, option.availableVersion ?? null)
  );
}

function UpdateAllButton(props: ProviderSettingsPageProps) {
  const { t } = useText();
  const [starting, setStarting] = createSignal(false);
  const updates = () => props.options.filter(updateOffered);
  const offered = () => Boolean(props.onUpdateProvider) && updates().length > 0;
  const updateAll = async () => {
    const update = props.onUpdateProvider;
    if (!update) return;
    setStarting(true);
    try {
      await Promise.allSettled(updates().map(async (option) => await update(option.id)));
    } finally {
      setStarting(false);
    }
  };
  return (
    <Show when={offered()}>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={props.disabled || starting()}
        onClick={() => void updateAll()}
      >
        {t("provider.settings.updateAll")}
      </Button>
    </Show>
  );
}

function waitingAccounts(option: ProviderPickerOption): number {
  return (option.accounts ?? []).filter((account) => account.state === "signed-out" || account.state === "error")
    .length;
}

function ProviderList(props: ProviderSettingsPageProps & { onOpen: (id: PageId) => void }) {
  const { t, format } = useText();
  const [query, setQuery] = createSignal("");
  const needle = () => query().trim().toLowerCase();
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
          <>
            <UpdateAllButton {...props} />
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
          </>
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

type PageProps = ProviderSettingsPageProps & { option: ProviderPickerOption };

function ProviderPage(props: PageProps) {
  const { t, format } = useText();
  const row = createProviderRow(() => props.option, props);
  const usedBy = () => props.option.usedBy ?? [];
  const header = (): { status: IntegrationStatus; label: string } => {
    const option = props.option;
    const runtime = option.runtimeStatus;
    if (row.off()) return { status: "unavailable", label: t("provider.status.off") };
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
  const provider = createMemo(() => props.option.id);
  const runtimeMissing = () => {
    const runtime = props.option.runtimeStatus;
    return (
      Boolean(runtime) &&
      runtime?.phase !== "ready" &&
      runtime?.version === null &&
      !row.available() &&
      props.option.state !== "outdated" &&
      !row.off()
    );
  };
  const modelVisibility = createMemo(() => props.modelVisibility);
  const models = createMemo(() => modelVisibility()?.(provider()));
  const environmentControl = createMemo(() => props.environment);
  const environment = createMemo(() => environmentControl()?.(provider()));
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
        <Show
          when={accountsShown()}
          fallback={<SignInSection {...props} row={row} keyShown={keyShown()} runtimeMissing={runtimeMissing()} />}
        >
          <AccountsSection {...props} row={row} />
        </Show>
      </Show>
      <Show when={!(row.off() || runtimeMissing())}>
        <Show when={keyShown()}>
          <ApiKeySection {...props} row={row} />
        </Show>
        <RuntimeSection {...props} row={row} />
        <Show
          when={
            (props.option.id === "claude" || (props.option.id === "pi" && props.promptCache?.appliesToPi)) &&
            props.promptCache
          }
        >
          {(cache) => <PromptCacheSection cache={cache()} disabled={props.disabled} menuMount={props.menuMount} />}
        </Show>
        <Show when={props.option.id === "claude" && props.claudeCompactWindow}>
          {(compaction) => (
            <CompactWindowSection compaction={compaction()} disabled={props.disabled} menuMount={props.menuMount} />
          )}
        </Show>
        <Show when={props.option.id === "claude" && props.claudeUserSetup}>
          {(setup) => <ClaudeUserSetupSection setup={setup()} disabled={props.disabled} />}
        </Show>
        <Show when={models()}>{(control) => <ModelsSection control={control()} />}</Show>
        <Show when={isProviderEnvironmentProvider(props.option.id) && environment()}>
          {(control) => (
            <EnvironmentSection
              control={control()}
              provider={props.option.id}
              name={props.option.name}
              disabled={props.disabled}
            />
          )}
        </Show>
      </Show>
      <Show when={!runtimeMissing()}>
        <UseSection {...props} row={row} />
      </Show>
      <DeleteSection {...props} row={row} />
    </>
  );
}

type SectionProps = PageProps & { row: ProviderRow };

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

function AlternativeItem(props: { row: ProviderRow }) {
  const { t } = useText();
  return (
    <>
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
      <Show when={props.row.mainlandChinaSite()}>
        {(site) => (
          <DropdownMenu.Item onSelect={props.row.connectInMainlandChina}>
            <Globe2 aria-hidden="true" />
            {t("provider.action.signInMainlandChina", { site: site() })}
          </DropdownMenu.Item>
        )}
      </Show>
    </>
  );
}

const SIGN_OUT_PROVIDERS: ReadonlySet<AgentProviderId> = new Set([
  "claude",
  "codex",
  "grok",
  "muse",
  "cursor",
  "devin",
  "copilot",
  "mistral",
  "antigravity",
]);

const SIGN_OUT_KEEPS_TERMINAL: ReadonlySet<AgentProviderId> = new Set(["antigravity"]);

function disconnectDescription(
  t: AppTranslate,
  format: AppFormat,
  options: {
    id: AgentProviderId;
    provider: string;
    local: boolean;
    usedBy: readonly string[];
    otherAccounts: boolean;
  },
): string {
  const { provider, usedBy } = options;
  return [
    !options.local
      ? t("provider.settings.disconnectHost", { provider })
      : SIGN_OUT_KEEPS_TERMINAL.has(options.id)
        ? t("provider.settings.disconnectLocalOnly", { provider })
        : t("provider.settings.disconnectLocal", { provider }),
    usedBy.length > 0
      ? t("provider.settings.accountBlocked", { agents: format.list(usedBy) })
      : t("provider.settings.removeUnused"),
    options.otherAccounts ? t("provider.settings.disconnectOthers", { provider }) : null,
  ]
    .filter(Boolean)
    .join(" ");
}

const ACCOUNT_KEY_TEXT: Partial<Record<AgentProviderId, KeyDialogText>> = {
  cursor: {
    name: "Cursor",
    title: "provider.cursorKey.title",
    description: "provider.cursorKey.description",
    descriptionHost: "provider.cursorKey.descriptionHost",
    label: "provider.cursorKey.label",
  },
};

function AccountsSection(props: SectionProps) {
  const { t, format, errorMessage, sourceText } = useText();
  const accounts = () => props.option.accounts ?? [];
  const keyText = () => (hasKeyAccounts(props.option.id) ? ACCOUNT_KEY_TEXT[props.option.id] : undefined);
  const keyOffered = () => Boolean(keyText() && props.accountActions?.connectKey);
  const [keyTarget, setKeyTarget] = createSignal<string | null | undefined>(undefined);
  const keyApi = (accountId: string | null): ProviderKeyApi => ({
    onHost: !props.accountActions?.local,
    getProviderApiKeyState: async () => ({ provider: props.option.id, status: "missing" }),
    setProviderApiKey: async ({ key }) => {
      await props.accountActions?.connectKey?.(props.option.id, accountId, key);
    },
    clearProviderApiKey: async () => undefined,
    openExternal: async () => undefined,
  });
  const [removing, setRemoving] = createSignal<ProviderPickerAccount | null>(null);
  const [resetting, setResetting] = createSignal<ProviderPickerAccount | null>(null);
  const [disconnecting, setDisconnecting] = createSignal<ProviderPickerAccount | null>(null);
  const [error, setError] = createSignal<string | null>(null);
  const [notice, setNotice] = createSignal<string | null>(null);
  const [usageResets, setUsageResets] = createSignal<readonly ProviderUsageResets[]>([]);
  const run = (name: string, action: () => Promise<void> | undefined) => {
    setError(null);
    setNotice(null);
    void Promise.resolve(action()).catch((failure: unknown) =>
      setError(errorMessage(failure, t("provider.account.actionFailed", { name }))),
    );
  };
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
  const pool = () => (props.accountActions?.setPool ? props.option.accountPool : undefined);
  const planAccounts = () => accounts().filter((account) => !isApiKeyAccount(account.id, props.option.id));
  const poolOffered = () => Boolean(props.accountActions?.setPool) && (planAccounts().length > 1 || Boolean(pool()));
  const poolLabelId = `provider-settings-${props.option.id}-pool-label`;
  const maxAccounts = () => props.accountActions?.maxAccounts ?? MAX_PROVIDER_ACCOUNTS;
  const setPool = (enabled: boolean, leftOut: readonly string[], strategy?: ProviderAccountPoolStrategy) =>
    run(props.option.name, () => props.accountActions?.setPool?.(props.option.id, enabled, leftOut, strategy));
  const poolStrategy = () => pool()?.strategy ?? "fillFirst";
  const poolDescription = (): AppTextKey =>
    poolStrategy() === "spread" ? "provider.account.poolSpreadDescription" : "provider.account.poolDescription";
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
  return (
    <SettingsSection
      title={t("provider.settings.accounts")}
      description={t(pool() ? "provider.settings.accountsPooledDescription" : "provider.settings.accountsDescription", {
        count: accounts().length,
        max: maxAccounts(),
      })}
      actions={
        <Show when={!hasKeyAccounts(props.option.id) || keyOffered()}>
          <Button
            type="button"
            variant="outline"
            size="sm"
            aria-label={t("provider.account.addLabel", { name: props.option.name })}
            disabled={props.disabled || !props.row.accountsOffered() || accounts().length >= maxAccounts() || adding()}
            onClick={() => (keyOffered() ? setKeyTarget(null) : props.row.addAccount())}
          >
            <UserRoundPlus aria-hidden="true" />
            {t("provider.account.add")}
          </Button>
          <Show when={!keyOffered() && props.row.accountCodeOffered()}>
            <DropdownMenu.Root placement="bottom-end" gutter={4} modal={false}>
              <MenuTrigger
                label={t("provider.account.moreActions", { name: t("provider.account.add") })}
                disabled={props.disabled || accounts().length >= maxAccounts() || adding()}
              />
              <DropdownMenu.Portal mount={props.menuMount ?? document.body}>
                <DropdownMenu.Content>
                  <DropdownMenu.Item onSelect={props.row.addAccountWithCode}>
                    <Smartphone aria-hidden="true" />
                    {t("provider.account.addWithCode")}
                  </DropdownMenu.Item>
                </DropdownMenu.Content>
              </DropdownMenu.Portal>
            </DropdownMenu.Root>
          </Show>
        </Show>
      }
    >
      <ItemGroup class="settings-modal-card" aria-label={t("provider.account.listLabel", { name: props.option.name })}>
        <Show when={poolOffered()}>
          <Item class="settings-modal-row">
            <ItemContent>
              <ItemTitle id={poolLabelId}>{t("provider.account.pool")}</ItemTitle>
              <ItemDescription>{t(poolDescription())}</ItemDescription>
            </ItemContent>
            <ItemActions>
              <Switch
                checked={Boolean(pool())}
                disabled={props.disabled === true}
                aria-labelledby={poolLabelId}
                onChange={(enabled: boolean) => setPool(enabled, pool()?.leftOut ?? [])}
              />
            </ItemActions>
          </Item>
        </Show>
        <Show when={poolOffered() && pool() && props.accountActions?.poolStrategy}>
          <Item class="settings-modal-row">
            <ItemContent>
              <ItemTitle>{t("provider.account.poolStrategy")}</ItemTitle>
            </ItemContent>
            <ItemActions>
              <PoolStrategySelect
                value={poolStrategy()}
                disabled={props.disabled === true}
                menuMount={props.menuMount}
                onChange={(strategy) => setPool(true, pool()?.leftOut ?? [], strategy)}
              />
            </ItemActions>
          </Item>
        </Show>
        <For each={accounts()} keyed={(account) => account.id}>
          {(account) => (
            <AccountRow
              {...props}
              account={account()}
              accounts={accounts()}
              pool={pool()}
              onTogglePool={() => {
                const current = pool();
                if (!current) return;
                const id = account().id;
                setPool(
                  true,
                  current.leftOut.includes(id)
                    ? current.leftOut.filter((left) => left !== id)
                    : [...current.leftOut, id],
                );
              }}
              run={run}
              onRemove={() => setRemoving({ ...account() })}
              onDisconnect={
                props.accountActions?.signOut && SIGN_OUT_PROVIDERS.has(props.option.id)
                  ? () => setDisconnecting({ ...account() })
                  : undefined
              }
              resetsLeft={props.accountActions?.resetUsage ? resetsLeft(account().id) : 0}
              onResetUsage={() => setResetting({ ...account() })}
              onChangeKey={keyOffered() ? () => setKeyTarget(account().id) : undefined}
            />
          )}
        </For>
      </ItemGroup>
      <Show when={props.option.checkError}>
        {(message) => <ItemDescription>{sourceText(message())}</ItemDescription>}
      </Show>
      <Show when={notice()}>{(message) => <ItemDescription role="status">{message()}</ItemDescription>}</Show>
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
      <Show when={keyTarget() !== undefined ? keyText() : undefined}>
        {(text) => (
          <OpenCodeKeyDialog api={keyApi(keyTarget() ?? null)} text={text()} onClose={() => setKeyTarget(undefined)} />
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
        description={
          disconnecting()
            ? disconnectDescription(t, format, {
                id: props.option.id,
                provider: props.option.name,
                local: Boolean(props.accountActions?.local),
                usedBy: disconnecting()?.usedBy ?? [],
                otherAccounts: accounts().length > 1,
              })
            : ""
        }
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

const VERSION_SOURCE = {
  system: "provider.settings.versionInstalledByUser",
  managed: "provider.settings.versionDownloaded",
} as const satisfies Record<NonNullable<AgentProviderStatus["cliSource"]>, keyof AppMessages>;

const OTHER_VERSION = {
  managed: "provider.settings.otherVersionInstalledByUser",
  system: "provider.settings.otherVersionDownloaded",
} as const satisfies Record<NonNullable<AgentProviderStatus["cliSource"]>, keyof AppMessages>;
const OTHER_VERSION_ACTION = {
  managed: "provider.settings.useInstalledVersion",
  system: "provider.settings.useDownloadedVersion",
} as const satisfies Record<NonNullable<AgentProviderStatus["cliSource"]>, keyof AppMessages>;

interface PoolStrategyOption {
  readonly id: ProviderAccountPoolStrategy;
  readonly labelKey: AppTextKey;
}

const POOL_STRATEGY_OPTION: Record<ProviderAccountPoolStrategy, PoolStrategyOption> = {
  fillFirst: { id: "fillFirst", labelKey: "provider.account.poolFillFirst" },
  spread: { id: "spread", labelKey: "provider.account.poolSpread" },
};
const POOL_STRATEGY_OPTIONS = PROVIDER_ACCOUNT_POOL_STRATEGIES.map((id) => POOL_STRATEGY_OPTION[id]);

function PoolStrategySelect(props: {
  value: ProviderAccountPoolStrategy;
  disabled: boolean;
  menuMount: HTMLElement | undefined;
  onChange: (strategy: ProviderAccountPoolStrategy) => void;
}) {
  const { t } = useText();
  return (
    <Select<PoolStrategyOption>
      class="provider-settings-select"
      options={POOL_STRATEGY_OPTIONS}
      optionValue="id"
      optionTextValue={(option) => t(option.labelKey)}
      value={POOL_STRATEGY_OPTION[props.value]}
      disabled={props.disabled}
      onChange={(option) => {
        if (option && option.id !== props.value) props.onChange(option.id);
      }}
      placement="bottom-end"
      itemComponent={(itemProps) => (
        <SelectItem item={itemProps.item}>{t(itemProps.item.rawValue.labelKey)}</SelectItem>
      )}
    >
      <SelectTrigger size="sm" aria-label={t("provider.account.poolStrategy")}>
        <SelectValue<PoolStrategyOption>>{(state) => t(state.selectedOption().labelKey)}</SelectValue>
      </SelectTrigger>
      <SelectContent mount={props.menuMount} />
    </Select>
  );
}

function AccountRow(
  props: SectionProps & {
    account: ProviderPickerAccount;
    accounts: readonly ProviderPickerAccount[];
    run: (name: string, action: () => Promise<void> | undefined) => void;
    onRemove: () => void;
    onDisconnect: (() => void) | undefined;
    resetsLeft: number;
    onResetUsage: () => void;
    pool: ProviderAccountPool | undefined;
    onTogglePool: () => void;
    onChangeKey: (() => void) | undefined;
  },
) {
  const { t, format, sourceText } = useText();
  const [renaming, setRenaming] = createSignal(false);
  const name = () => providerAccountName(t, props.accounts, props.account.id);
  const sameEmailNote = () => {
    const earlier = earlierAccountWithSameEmail(props.accounts, props.account.id);
    return earlier
      ? t("provider.account.sameEmail", { name: providerAccountName(t, props.accounts, earlier.id) })
      : null;
  };
  const own = () => props.account.id === DEFAULT_PROVIDER_ACCOUNT_ID;
  const apiKey = () => isApiKeyAccount(props.account.id);
  const keyAccount = () => isProviderKeyAccount(props.option.id, props.account.id);
  const keyReplacesOwn = () => own() && props.option.id === "antigravity" && props.option.keyStatus === "saved";
  const state = (): ProviderAccountState =>
    Object.hasOwn(ACCOUNT_STATE_TEXT, props.account.state) ? props.account.state : "error";
  const needsSignIn = () => state() === "signed-out" || state() === "error";
  const signInAgain = () => !own() && !apiKey() && !keyAccount() && needsSignIn();
  const changeKey = () => (keyAccount() ? props.onChangeKey : undefined);
  const connecting = () => !own() && !apiKey() && !keyAccount() && state() === "connecting";
  const ownSigningIn = () => own() && props.row.signingIn();
  const agents = () => props.account.usedBy ?? [];
  const poolMember = () => Boolean(props.pool) && !apiKey() && !keyAccount();
  const inPool = () => poolMember() && !props.pool?.leftOut.includes(props.account.id);
  const detail = () =>
    [
      props.account.email && props.account.email !== name() ? props.account.email : null,
      sameEmailNote(),
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
  const reconnect = (): "reconnect" | null =>
    own() &&
    !keyReplacesOwn() &&
    (props.row.runtimeAction() === "reconnect" || (!props.row.runtimeStatus() && props.row.browserConnect()))
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
        <Show when={keyReplacesOwn()}>
          <ItemDescription>{t("provider.settings.geminiKeyReplacesAccount")}</ItemDescription>
        </Show>
        <Show when={state() === "connected" && props.account.message}>
          {(message) => <ItemDescription role="status">{sourceText(message())}</ItemDescription>}
        </Show>
        <Show when={state() !== "connected"}>
          <ItemDescription class={{ "provider-settings-warning": needsSignIn() }}>
            {props.account.message ? sourceText(props.account.message) : t(ACCOUNT_STATE_TEXT[state()])}
            <Show when={needsSignIn() && agents().length > 0}>
              {` ${t("provider.settings.accountBlocked", { agents: format.list(agents()) })}`}
            </Show>
          </ItemDescription>
        </Show>
      </ItemContent>
      <ItemActions>
        <Show when={poolMember() && !inPool()}>
          <Badge variant="secondary">{t("provider.account.notInPool")}</Badge>
        </Show>
        <Show when={inPool() && props.pool?.inUse === props.account.id}>
          <Badge variant="success-light">{t("provider.account.inUse")}</Badge>
        </Show>
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
        <Show when={needsSignIn() ? changeKey() : undefined}>
          {(open) => (
            <Button type="button" size="sm" disabled={props.disabled} onClick={() => open()()}>
              <KeyRound aria-hidden="true" />
              {t("provider.settings.changeKey")}
            </Button>
          )}
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
              <Show when={poolMember()}>
                <DropdownMenu.Item onSelect={() => props.onTogglePool()}>
                  <Show
                    when={inPool()}
                    fallback={
                      <>
                        <CirclePlus aria-hidden="true" />
                        {t("provider.account.putBackInPool")}
                      </>
                    }
                  >
                    <CirclePause aria-hidden="true" />
                    {t("provider.account.leaveOutOfPool")}
                  </Show>
                </DropdownMenu.Item>
              </Show>
              <Show when={state() === "connected" && !apiKey() && !keyAccount() && props.resetsLeft > 0}>
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
              <Show when={signInAgain() && accountCodeSignInOffered(props.option.id, props.accountActions)}>
                <DropdownMenu.Item
                  onSelect={() =>
                    props.run(name(), () => props.accountActions?.connectWithCode?.(props.option.id, props.account.id))
                  }
                >
                  <Smartphone aria-hidden="true" />
                  {t("provider.action.signInWithCode")}
                </DropdownMenu.Item>
              </Show>
              <Show when={apiKey()}>
                <DropdownMenu.Item onSelect={() => void props.onSignInProvider?.(props.option.id)}>
                  <KeyRound aria-hidden="true" />
                  {t("provider.settings.changeKey")}
                </DropdownMenu.Item>
              </Show>
              <Show when={changeKey()}>
                {(open) => (
                  <DropdownMenu.Item onSelect={() => open()()}>
                    <KeyRound aria-hidden="true" />
                    {t("provider.settings.changeKey")}
                  </DropdownMenu.Item>
                )}
              </Show>
              <Show when={!own() && !apiKey()}>
                <DropdownMenu.Separator />
                <DropdownMenu.Item onSelect={() => props.onRemove()}>
                  <Trash2 aria-hidden="true" />
                  {t("provider.account.remove")}
                </DropdownMenu.Item>
              </Show>
              <Show when={own() && !keyReplacesOwn() && state() === "connected" && props.onDisconnect}>
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

const RESET_CLOCK_MS = 30_000;

function UsageBadge(props: { reading: AccountUsageProviderRow; name: string }) {
  const low = () =>
    props.reading.windows
      .filter((window) => window.tone !== "neutral")
      .sort((left, right) => left.remainingPercent - right.remainingPercent)[0];
  return (
    <Show when={low()}>{(limit) => <LowUsageBadge reading={props.reading} name={props.name} limit={limit()} />}</Show>
  );
}

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

function SignInSection(props: SectionProps & { keyShown: boolean; runtimeMissing: boolean }) {
  const { t, format, sourceText, errorMessage } = useText();
  const row = () => props.row;
  const disconnectOffered = () =>
    Boolean(props.accountActions?.signOut) &&
    SIGN_OUT_PROVIDERS.has(props.option.id) &&
    row().available() &&
    !row().connecting() &&
    (props.option.id === "muse" ? props.option.keyStatus === "missing" : props.option.keyStatus !== "saved");
  const [disconnecting, setDisconnecting] = createSignal(false);
  const [disconnectError, setDisconnectError] = createSignal<string | null>(null);
  const disconnect = () => {
    setDisconnecting(false);
    setDisconnectError(null);
    void Promise.resolve(props.accountActions?.signOut?.(props.option.id)).catch((failure: unknown) =>
      setDisconnectError(errorMessage(failure, t("provider.account.actionFailed", { name: props.option.name }))),
    );
  };
  const downloadAction = () => {
    if (!props.runtimeMissing) return;
    const action = row().runtimeAction();
    return action === "download" || action === "cancel" || action === "retry" ? action : undefined;
  };
  const progress = () => {
    const runtime = row().runtimeStatus();
    if (!props.runtimeMissing || runtime?.phase !== "downloading" || runtime.message) return null;
    return Math.round(Math.max(0, Math.min(100, runtime.progress ?? 0)));
  };
  const connectAction = () => {
    const action = row().runtimeAction();
    return action === "connect" || action === "reconnect" || action === "restart" ? action : undefined;
  };
  const browserAction = () => providerAction(row().state(), row().connecting());
  const signInButton = () => row().signInOffered() && !props.keyShown && !props.runtimeMissing;
  const title = () => {
    const percent = progress();
    if (percent !== null) return t("provider.picker.downloading", { percent: format.percent(percent / 100) });
    if (
      !props.option.email &&
      row().state() === "not-installed" &&
      !row().connecting() &&
      row().runtimeStatus()?.phase === "ready"
    )
      return t("provider.status.notConnected");
    return (
      props.option.email ??
      providerStatusLabel(
        t,
        format,
        row().state(),
        row().connecting(),
        props.runtimeMissing ? row().runtimeStatus() : undefined,
      )
    );
  };
  const messages = () =>
    [
      props.option.checkError ? sourceText(props.option.checkError) : null,
      row().hostSignInHint() ? t("provider.gemini.hostSignIn") : null,
      row().signingIn() ? t("provider.connecting.browserHint") : null,
    ].filter((text): text is string => Boolean(text));
  const error = () =>
    row().connectError() ??
    disconnectError() ??
    (row().statusMessage() ? sourceText(row().statusMessage() ?? "") : null);
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
                      Boolean(disconnectError()) ||
                      row().state() === "error" ||
                      row().runtimeStatus()?.phase === "download-error",
                  }}
                >
                  {message()}
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
            <Show when={downloadAction()}>
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
            <Show when={row().codeFallbackOffered()}>
              <Button
                type="button"
                variant="outline"
                size="sm"
                aria-label={t(
                  row().alternative() === "address" ? "provider.aria.addressFallback" : "provider.aria.codeFallback",
                  { name: props.option.name },
                )}
                disabled={props.disabled}
                onClick={row().signInAlternative}
              >
                {t(
                  row().alternative() === "address" ? "provider.action.pasteAddress" : "provider.action.signInWithCode",
                )}
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
            <Show when={row().alternative() || row().mainlandChinaSite() || disconnectOffered()}>
              <DropdownMenu.Root placement="bottom-end" gutter={4} modal={false}>
                <MenuTrigger
                  label={t("provider.aria.moreActions", { name: props.option.name })}
                  disabled={props.disabled}
                />
                <DropdownMenu.Portal mount={props.menuMount ?? document.body}>
                  <DropdownMenu.Content>
                    <AlternativeItem row={row()} />
                    <Show when={disconnectOffered()}>
                      <Show when={row().alternative() || row().mainlandChinaSite()}>
                        <DropdownMenu.Separator />
                      </Show>
                      <DropdownMenu.Item onSelect={() => setDisconnecting(true)}>
                        <LogOut aria-hidden="true" />
                        {t("provider.account.disconnect")}
                      </DropdownMenu.Item>
                    </Show>
                  </DropdownMenu.Content>
                </DropdownMenu.Portal>
              </DropdownMenu.Root>
            </Show>
          </ItemActions>
        </Item>
      </ItemGroup>
      <ConfirmDialog
        open={disconnecting()}
        tone="destructive"
        title={t("provider.settings.disconnectTitle", { name: props.option.email ?? props.option.name })}
        description={disconnectDescription(t, format, {
          id: props.option.id,
          provider: props.option.name,
          local: Boolean(props.accountActions?.local),
          usedBy: props.option.usedBy ?? [],
          otherAccounts: false,
        })}
        confirmLabel={t("provider.account.disconnect")}
        onCancel={() => setDisconnecting(false)}
        onConfirm={disconnect}
      />
    </SettingsSection>
  );
}

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
                      : props.option.id === "muse" && saved()
                        ? t("provider.settings.museKeyInUse")
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

function RuntimeSection(props: SectionProps) {
  const { t, format, sourceText } = useText();
  const row = () => props.row;
  const runtime = () => row().runtimeStatus();
  const storeAction = () => {
    const action = row().runtimeAction();
    return action === "download" || action === "cancel" || action === "retry" ? action : undefined;
  };
  const progress = () =>
    runtime()?.phase === "downloading" ? Math.round(Math.max(0, Math.min(100, runtime()?.progress ?? 0))) : null;
  const versionLine = () => {
    const current = runtime();
    if (!current) return null;
    if (current.phase === "not-downloaded") {
      const version = props.option.incompleteCliVersion;
      return version
        ? t("provider.settings.versionInstalledByUser", {
            version: providerVersionLabel({ ...current, version }, { t }) ?? version,
          })
        : t("provider.status.notDownloaded");
    }
    if (current.phase === "download-error")
      return current.message ?? providerStatusLabel(t, format, row().state(), false, current);
    if (current.phase === "downloading" || current.phase === "finishing") {
      return current.message ?? providerStatusLabel(t, format, row().state(), false, current);
    }
    const installed = row().version();
    if (row().updatable() && installed) {
      return t("provider.settings.versionAvailable", { installed, available: props.option.availableVersion ?? "" });
    }
    const source = props.option.cliSource;
    return installed && source ? t(VERSION_SOURCE[source], { version: installed }) : installed;
  };
  const otherCli = () => {
    const source = props.option.cliSource;
    const version = props.option.otherCliVersion;
    const provider = props.option.id;
    if (!source || !version || !props.onChooseInstalledCli || !isManagedRuntimeProvider(provider)) return null;
    const current = runtime();
    if (storeAction() || props.option.restartPending || current?.phase !== "ready") return null;
    return { source, version: providerVersionLabel({ ...current, version }, { t }) ?? version, provider };
  };
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
                <Show when={otherCli()}>
                  {(other) => (
                    <ItemDescription>{t(OTHER_VERSION[other().source], { version: other().version })}</ItemDescription>
                  )}
                </Show>
                <Show when={runtime()?.phase === "not-downloaded" && props.option.incompleteCliVersion}>
                  <ItemDescription>{t("provider.settings.installedVersionIncomplete")}</ItemDescription>
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
                <Show when={otherCli()}>
                  {(other) => (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={props.disabled || row().connecting()}
                      onClick={() => void props.onChooseInstalledCli?.(other().provider, other().source === "managed")}
                    >
                      {t(OTHER_VERSION_ACTION[other().source])}
                    </Button>
                  )}
                </Show>
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
        <Show when={props.cache.compaction}>
          {(compaction) => <CacheExpiryCompactionRow compaction={compaction()} disabled={props.disabled} />}
        </Show>
      </ItemGroup>
    </SettingsSection>
  );
}

function CacheExpiryCompactionRow(props: { compaction: ProviderCacheExpiryCompaction; disabled: boolean | undefined }) {
  const { t } = useText();
  return (
    <Item class="settings-modal-row">
      <ItemContent>
        <ItemTitle id="provider-settings-cache-expiry-compaction-label">
          {t("provider.settings.cacheExpiryCompaction")}
        </ItemTitle>
        <Show
          when={props.compaction.error}
          fallback={<ItemDescription>{t("provider.settings.cacheExpiryCompactionDescription")}</ItemDescription>}
        >
          {(message) => (
            <ItemDescription class="provider-settings-error" role="alert">
              {message()}
            </ItemDescription>
          )}
        </Show>
      </ItemContent>
      <Show when={props.compaction.value !== null}>
        <ItemActions>
          <Switch
            checked={props.compaction.value === true}
            disabled={Boolean(props.disabled || props.compaction.pending)}
            aria-busy={props.compaction.pending ? "true" : "false"}
            aria-labelledby="provider-settings-cache-expiry-compaction-label"
            onChange={(enabled: boolean) => props.compaction.onChange(enabled)}
          />
        </ItemActions>
      </Show>
    </Item>
  );
}

type CompactWindowChoice = "default" | `${number}`;

function compactWindowChoice(tokens: number | null): CompactWindowChoice {
  return tokens === null ? "default" : `${tokens}`;
}

function CompactWindowSection(props: {
  compaction: ProviderClaudeCompactWindow;
  disabled: boolean | undefined;
  menuMount: HTMLElement | undefined;
}) {
  const { t, format } = useText();
  const choices = (): CompactWindowChoice[] =>
    claudeCompactWindowSizes(props.compaction.value?.tokens ?? null).map(compactWindowChoice);
  const label = (choice: CompactWindowChoice) =>
    choice === "default"
      ? t("provider.settings.compactWindowDefault")
      : t("provider.settings.compactWindowTokens", { size: format.compact(Number(choice)) });
  return (
    <SettingsSection title={t("provider.settings.context")}>
      <ItemGroup class="settings-modal-card">
        <Item class="settings-modal-row">
          <ItemContent>
            <ItemTitle id="provider-settings-compact-window-label">{t("provider.settings.compactWindow")}</ItemTitle>
            <Show
              when={props.compaction.error}
              fallback={<ItemDescription>{t("provider.settings.compactWindowDescription")}</ItemDescription>}
            >
              {(message) => (
                <ItemDescription class="provider-settings-error" role="alert">
                  {message()}
                </ItemDescription>
              )}
            </Show>
          </ItemContent>
          <Show when={props.compaction.value}>
            {(value) => (
              <ItemActions>
                <Select<CompactWindowChoice>
                  options={choices()}
                  value={compactWindowChoice(value().tokens)}
                  disabled={Boolean(props.disabled || props.compaction.pending)}
                  placement="bottom-end"
                  onChange={(choice) => {
                    if (!choice || choice === compactWindowChoice(props.compaction.value?.tokens ?? null)) return;
                    props.compaction.onChange(choice === "default" ? null : Number(choice));
                  }}
                  itemComponent={(item) => <SelectItem item={item.item}>{label(item.item.rawValue)}</SelectItem>}
                >
                  <SelectTrigger size="sm" aria-labelledby="provider-settings-compact-window-label">
                    <SelectValue<CompactWindowChoice>>
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

function ClaudeUserSetupSection(props: { setup: ProviderClaudeUserSetup; disabled: boolean | undefined }) {
  const { t } = useText();
  function claudeUserSetupDescription(): string {
    if (props.setup.remote === true) return t("provider.settings.claudeUserSetupServerDescription");
    return t("provider.settings.claudeUserSetupDescription");
  }
  return (
    <SettingsSection title={t("provider.settings.claudeSetup")}>
      <ItemGroup class="settings-modal-card">
        <Item class="settings-modal-row">
          <ItemContent>
            <ItemTitle id="provider-settings-claude-setup-label">{t("provider.settings.claudeUserSetup")}</ItemTitle>
            <Show when={props.setup.error} fallback={<ItemDescription>{claudeUserSetupDescription()}</ItemDescription>}>
              {(message) => (
                <ItemDescription class="provider-settings-error" role="alert">
                  {message()}
                </ItemDescription>
              )}
            </Show>
          </ItemContent>
          <Show when={props.setup.value !== null}>
            <ItemActions>
              <Switch
                checked={props.setup.value === true}
                disabled={Boolean(props.disabled || props.setup.pending)}
                aria-busy={props.setup.pending ? "true" : "false"}
                aria-labelledby="provider-settings-claude-setup-label"
                onChange={(enabled: boolean) => props.setup.onChange(enabled)}
              />
            </ItemActions>
          </Show>
        </Item>
      </ItemGroup>
    </SettingsSection>
  );
}

interface EnvironmentRow {
  id: number;
  name: string;
  value: string;
  sensitive: boolean;
  stored: boolean;
}

function EnvironmentSection(props: {
  control: ProviderEnvironmentControl;
  provider: AgentProviderId;
  name: string;
  disabled: boolean | undefined;
}) {
  const { t } = useText();
  let nextId = 0;
  const rowsOf = (environment: ProviderEnvironment | null): EnvironmentRow[] =>
    (environment?.variables ?? []).map((variable) => ({ ...variable, id: nextId++ }));
  const [draft, setDraft] = createSignal<EnvironmentRow[]>([]);
  const [baseline, setBaseline] = createSignal<string>("[]");
  const [leaving, setLeaving] = createSignal<ReadonlySet<number>>(new Set());
  const [saved, setSaved] = createSignal(false);
  const removeButtons = new Map<number, HTMLButtonElement>();
  let addButton: HTMLButtonElement | undefined;
  const snapshot = (rows: readonly Omit<EnvironmentRow, "id">[]) =>
    JSON.stringify(rows.map(({ name, value, sensitive, stored }) => ({ name, value, sensitive, stored })));
  const kept = () => draft().filter((row) => !leaving().has(row.id));
  const dirty = () => snapshot(kept()) !== baseline();
  const reset = (environment: ProviderEnvironment | null) => {
    const rows = rowsOf(environment);
    setLeaving(new Set<number>());
    setDraft(rows);
    setBaseline(snapshot(rows));
  };
  createEffect(
    () => props.control.value,
    (environment) => {
      const keep = untrack(() => dirty() && !(saved() && !props.control.error));
      if (keep) return;
      reset(environment);
    },
  );
  const busy = () => Boolean(props.disabled || props.control.pending || props.control.value === null);
  const keptNames = () => kept().map((row) => row.name.trim());
  const problem = (row: EnvironmentRow): string | null => {
    if (!isProviderEnvironmentProvider(props.provider)) return null;
    const name = row.name.trim();
    if (name === "" && row.value === "") return null;
    const found = providerEnvironmentProblem(props.provider, name, keptNames());
    if (found === "name") return t("error.provider.environmentNameInvalid", { name: name || "…" });
    if (found === "reserved") return t("error.provider.environmentNameReserved", { name });
    if (found === "duplicate") return t("error.provider.environmentNameDuplicate", { name });
    return null;
  };
  const invalid = () => kept().some((row) => problem(row) !== null);
  const update = (id: number, change: Partial<EnvironmentRow>) => {
    setSaved(false);
    setDraft((rows) => rows.map((row) => (row.id === id ? { ...row, ...change } : row)));
  };
  const drop = (id: number) => {
    setLeaving((current) => {
      const next = new Set(current);
      next.delete(id);
      return next;
    });
    setDraft((rows) => rows.filter((row) => row.id !== id));
    removeButtons.delete(id);
  };
  const remove = (id: number) => {
    if (leaving().has(id)) return;
    setSaved(false);
    const rows = draft();
    const index = rows.findIndex((row) => row.id === id);
    const staying = rows.filter((row) => row.id !== id && !leaving().has(row.id));
    const next = staying.find((row) => rows.indexOf(row) > index) ?? staying.at(-1) ?? null;
    if (removeButtons.get(id)?.matches(":focus-visible"))
      (next ? removeButtons.get(next.id) : addButton)?.focus({ preventScroll: true });
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      drop(id);
      return;
    }
    setLeaving((current) => new Set(current).add(id));
    setTimeout(() => {
      if (leaving().has(id)) drop(id);
    }, 260);
  };
  const save = () => {
    const variables: ProviderEnvironmentVariableInput[] = kept()
      .filter((row) => row.name.trim() !== "" || row.value !== "")
      .map((row) => ({
        name: row.name.trim(),
        value: row.sensitive && row.stored && row.value === "" ? null : row.value,
        sensitive: row.sensitive,
      }));
    setSaved(true);
    props.control.onSave(variables);
  };
  const label = (row: EnvironmentRow, index: number) =>
    row.name.trim() || t("provider.settings.environmentUnnamed", { index: index + 1 });
  return (
    <SettingsSection title={t("provider.settings.environment")}>
      <ItemGroup class="settings-modal-card">
        <Item class="settings-modal-row">
          <ItemContent>
            <ItemTitle>{t("provider.settings.environmentVariables")}</ItemTitle>
            <Show
              when={props.control.error}
              fallback={
                <ItemDescription>
                  {t("provider.settings.environmentDescription", { name: props.name })}{" "}
                  {props.provider === "codex" ? `${t("provider.settings.environmentCodexHint")} ` : ""}
                  {t("provider.settings.environmentShellNote")}
                </ItemDescription>
              }
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
              variant="outline"
              size="sm"
              disabled={busy()}
              ref={(element: HTMLButtonElement) => {
                addButton = element;
              }}
              onClick={() => {
                setSaved(false);
                setDraft((rows) => [...rows, { id: nextId++, name: "", value: "", sensitive: false, stored: false }]);
              }}
            >
              <Plus />
              {t("provider.settings.environmentAdd")}
            </Button>
          </ItemActions>
        </Item>
        <For each={draft()} keyed={(row) => row.id}>
          {(row, index) => (
            <div
              class="provider-environment-fold"
              data-leaving={leaving().has(row().id) ? "" : undefined}
              inert={leaving().has(row().id)}
              onTransitionEnd={(event) => {
                if (event.target === event.currentTarget && event.propertyName === "grid-template-rows") drop(row().id);
              }}
            >
              <Item class="settings-modal-row provider-environment-row">
                <div class="provider-environment-fields">
                  <Input
                    size="sm"
                    class="provider-environment-mono"
                    spellcheck={false}
                    autocomplete="off"
                    placeholder={t("provider.settings.environmentNamePlaceholder")}
                    aria-label={t("provider.settings.environmentNameLabel", { index: index() + 1 })}
                    disabled={busy()}
                    value={row().name}
                    onValueChange={(value) => update(row().id, { name: value, stored: false })}
                  />
                  <Input
                    size="sm"
                    class="provider-environment-mono"
                    type={row().sensitive ? "password" : "text"}
                    spellcheck={false}
                    autocomplete="off"
                    placeholder={
                      row().stored
                        ? t("provider.settings.environmentSaved")
                        : t("provider.settings.environmentValuePlaceholder")
                    }
                    aria-label={t("provider.settings.environmentValueLabel", { name: label(row(), index()) })}
                    disabled={busy()}
                    value={row().value}
                    onValueChange={(value) => update(row().id, { value })}
                  />
                  <Show when={problem(row())}>
                    {(message) => <ItemDescription class="provider-settings-error">{message()}</ItemDescription>}
                  </Show>
                </div>
                <ItemActions>
                  <div class="provider-environment-sensitive">
                    <Switch
                      size="sm"
                      checked={row().sensitive}
                      disabled={busy()}
                      aria-label={t("provider.settings.environmentSensitiveLabel", { name: label(row(), index()) })}
                      onChange={(on: boolean) => update(row().id, { sensitive: on, stored: on && row().stored })}
                    />
                    <span aria-hidden="true">{t("provider.settings.environmentSensitive")}</span>
                  </div>
                  <IconButton
                    variant="ghost"
                    size="icon-sm"
                    label={t("provider.settings.environmentRemoveLabel", { name: label(row(), index()) })}
                    disabled={busy()}
                    ref={(element: HTMLButtonElement) => {
                      removeButtons.set(row().id, element);
                    }}
                    onClick={() => remove(row().id)}
                  >
                    <Trash2 />
                  </IconButton>
                </ItemActions>
              </Item>
            </div>
          )}
        </For>
        <Show when={dirty() || (saved() && !props.control.pending && !props.control.error)}>
          <Item class="settings-modal-row">
            <ItemContent>
              <ItemDescription>
                {dirty()
                  ? t("provider.settings.environmentPending", { name: props.name })
                  : t("provider.settings.environmentDone", { name: props.name })}
              </ItemDescription>
            </ItemContent>
            <Show when={dirty()}>
              <ItemActions>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={props.control.pending}
                  onClick={() => reset(props.control.value)}
                >
                  {t("provider.settings.environmentDiscard")}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  loading={props.control.pending}
                  disabled={busy() || invalid()}
                  onClick={save}
                >
                  {t("provider.settings.environmentSave")}
                </Button>
              </ItemActions>
            </Show>
          </Item>
        </Show>
      </ItemGroup>
    </SettingsSection>
  );
}

function ModelsSection(props: { control: ProviderModelVisibilityControl }) {
  const { t } = useText();
  const [query, setQuery] = createSignal("");
  const order = createMemo<readonly AgentModelId[]>((previous = []) => {
    const list = props.control.list;
    if (!list) return previous;
    const listed = new Set(list.models.map((model) => model.id));
    const kept = previous.filter((id) => listed.has(id));
    const placed = new Set(kept);
    const shown = new Set(list.shown);
    const added = list.models.map((model) => model.id).filter((id) => !placed.has(id));
    return [...kept, ...added.filter((id) => shown.has(id)), ...added.filter((id) => !shown.has(id))];
  });
  const names = createMemo(() => new Map((props.control.list?.models ?? []).map((model) => [model.id, model.name])));
  const shown = createMemo(() => new Set(props.control.list?.shown ?? []));
  const rows = createMemo(() => {
    const needle = query().trim().toLowerCase();
    return order()
      .map((id) => ({ id, name: names().get(id) ?? id }))
      .filter((model) => !needle || `${model.name} ${model.id}`.toLowerCase().includes(needle));
  });
  const total = () => props.control.list?.models.length ?? 0;
  const set = (id: AgentModelId, on: boolean) => {
    const next = order().filter((candidate) => (candidate === id ? on : shown().has(candidate)));
    props.control.onChange(next);
  };
  return (
    <Show when={total() > 0 || props.control.error}>
      <SettingsSection
        title={t("provider.settings.models")}
        description={t("provider.settings.modelsDescription", { shown: shown().size, count: total() })}
        actions={
          <Show when={total() > 0}>
            <Show when={props.control.list?.changed}>
              <Button type="button" variant="ghost" size="xs" onClick={() => props.control.onReset()}>
                {t("provider.settings.modelsReset")}
              </Button>
            </Show>
            <Button
              type="button"
              variant="ghost"
              size="xs"
              onClick={() => props.control.onChange(shown().size === 0 ? [...order()] : [])}
            >
              {shown().size === 0 ? t("provider.settings.modelsShowAll") : t("provider.settings.modelsHideAll")}
            </Button>
          </Show>
        }
      >
        <Show when={props.control.error}>
          {(message) => (
            <Text variant="body-sm" class="provider-settings-models-error" role="alert">
              {message()}
            </Text>
          )}
        </Show>
        <Show when={total() > 0}>
          <Input
            aria-label={t("provider.settings.modelsSearch")}
            placeholder={t("provider.settings.modelsSearch")}
            value={query()}
            onValueChange={setQuery}
          />
          <ItemGroup class="settings-modal-card provider-settings-models">
            <Show
              when={rows().length > 0}
              fallback={
                <Text variant="body-sm" tone="muted" class="provider-settings-models-empty" role="status">
                  {t("provider.settings.modelsNoMatch")}
                </Text>
              }
            >
              <ul class="provider-settings-models-list">
                <For each={rows()} keyed={(model) => model.id}>
                  {(model) => (
                    <li class="provider-settings-models-row">
                      <span class="provider-settings-models-name">
                        <Text as="span" variant="body-sm">
                          {model().name}
                        </Text>
                        <Text as="span" variant="caption" tone="muted" class="provider-settings-models-id">
                          {model().id}
                        </Text>
                      </span>
                      <Switch
                        checked={shown().has(model().id)}
                        aria-label={t("provider.settings.modelShow", { name: model().name, id: model().id })}
                        onChange={(on: boolean) => set(model().id, on)}
                      />
                    </li>
                  )}
                </For>
              </ul>
            </Show>
          </ItemGroup>
        </Show>
      </SettingsSection>
    </Show>
  );
}

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

function DeleteSection(props: SectionProps) {
  const { t, format, errorMessage } = useText();
  const [state, setState] = createStore({ bytes: 0, busy: false });
  const usedBy = () => props.option.usedBy ?? [];
  const offered = () =>
    Boolean(props.onSetProviderOn && props.onRemoveProviderDownload) && isManagedRuntimeProvider(props.option.id);
  const onWithDownload = () =>
    props.option.id !== "pi" &&
    !props.row.off() &&
    props.option.runtimeStatus?.phase === "ready" &&
    props.option.cliSource !== "system";
  let reads = 0;
  async function measure(provider: AgentProviderId, read = props.onMeasureProviderDownload): Promise<number> {
    const serial = ++reads;
    const bytes = read
      ? await read(provider).then(
          (download) => download.bytes,
          () => 0,
        )
      : 0;
    if (serial === reads)
      setState((draft) => {
        draft.bytes = bytes;
      });
    return bytes;
  }
  createEffect(
    () => ({ provider: props.option.id, off: offered() && props.row.off(), read: props.onMeasureProviderDownload }),
    ({ provider, off, read }) => {
      if (off) void measure(provider, read);
      else
        setState((draft) => {
          draft.bytes = 0;
        });
    },
  );
  const description = () =>
    props.row.off() && state.bytes > 0
      ? t("provider.settings.deleteOff", { name: props.option.name, size: format.fileSize(state.bytes) })
      : t("provider.settings.deleteOn", { name: props.option.name });
  async function remove() {
    const provider = props.option.id;
    setState((draft) => {
      draft.busy = true;
    });
    try {
      if (!props.row.off()) await props.onSetProviderOn?.(provider, false);
    } catch (error) {
      toast.error(errorMessage(error, t("error.provider.useChangeFailed")));
      setState((draft) => {
        draft.busy = false;
      });
      return;
    }
    try {
      if ((await measure(provider)) > 0) await props.onRemoveProviderDownload?.(provider);
    } catch (error) {
      toast.error(errorMessage(error, t("provider.settings.removeDownloadFailed")));
    }
    await measure(provider);
    setState((draft) => {
      draft.busy = false;
    });
  }
  return (
    <Show when={offered() && !props.disabled && (state.busy || onWithDownload() || state.bytes > 0)}>
      <DangerZone
        title={t("provider.settings.deleteTitle", { name: props.option.name })}
        description={description()}
        action={t("common.delete")}
        busy={state.busy}
        confirm={usedBy().length === 0}
        onAction={() => {
          if (usedBy().length > 0) showProviderInUse(t, usedBy(), props.option.name);
          else void remove();
        }}
      />
    </Show>
  );
}

function servesCustomEndpoints(props: ProviderSettingsPageProps): boolean {
  const option = (id: AgentProviderId) => props.options.find((candidate) => candidate.id === id);
  return (
    servesCustomProvider(option("opencode")) ||
    Boolean(props.customProviderHarnesses && servesCustomProvider(option("pi")))
  );
}

function CustomEndpointsPage(props: ProviderSettingsPageProps) {
  const { t, format, errorMessage } = useText();
  const endpoints = () => props.customProviders ?? [];
  const engine = () => props.options.find((option) => option.id === "opencode");
  const ready = () => servesCustomEndpoints(props);
  const engineOff = () => !ready() && Boolean(engine()?.off);
  const turnOnOffered = () => engineOff() && Boolean(props.onSetProviderOn);
  const [turningOn, setTurningOn] = createSignal(false);
  async function turnEngineOn() {
    setTurningOn(true);
    try {
      await props.onSetProviderOn?.("opencode", true);
    } catch (error) {
      toast.error(errorMessage(error, t("error.provider.useChangeFailed")));
    } finally {
      setTurningOn(false);
    }
  }
  const engineAction = () => {
    if (ready() || turnOnOffered() || (!props.onDownloadProvider && !props.onCancelProviderDownload)) return undefined;
    return customEngineDownloadAction(engine());
  };
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
            : engineOff()
              ? t("provider.settings.turnOnFirst", { name: engine()?.name ?? "" })
              : providerStatusLabel(t, format, engine()?.state ?? "checking")
        }
      />
      <SettingsSection
        title={t("provider.settings.endpoints")}
        actions={
          <Show
            when={engineAction()}
            fallback={
              <Show
                when={turnOnOffered()}
                fallback={
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
                <Button
                  type="button"
                  size="sm"
                  aria-label={t("provider.aria.use", { name: engine()?.name ?? "" })}
                  loading={turningOn()}
                  disabled={props.disabled || turningOn()}
                  onClick={() => void turnEngineOn()}
                >
                  {t("provider.settings.useTitle", { name: engine()?.name ?? "" })}
                </Button>
              </Show>
            }
          >
            {(action) => (
              <Button
                type="button"
                variant={action() === "download" ? "default" : "outline"}
                size="sm"
                aria-label={t(PROVIDER_ACTION_LABEL[action()], { name: engine()?.name ?? "" })}
                disabled={props.disabled}
                onClick={() =>
                  void (action() === "cancel"
                    ? props.onCancelProviderDownload?.("opencode")
                    : props.onDownloadProvider?.("opencode"))
                }
              >
                {t(PROVIDER_ACTION_TEXT[action()])}
              </Button>
            )}
          </Show>
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
