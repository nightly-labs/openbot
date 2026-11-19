import { ProviderLogo } from "@openbot/brand";
import { agentProviderDescriptor } from "@openbot/contracts/agent-providers";
import type {
  AgentProviderId,
  AgentProviderState,
  AgentProviderStatus,
  CustomProviderSummary,
  ProviderAccountPool,
  ProviderApiKeyStatus,
  ProviderRuntimeStatus,
} from "@openbot/contracts/ipc";
import {
  Badge,
  Button,
  buttonVariants,
  Copy,
  DropdownMenu,
  Ellipsis,
  Globe2,
  Input,
  Link,
  RefreshCw,
  RotateCcw,
  SlidersHorizontal,
  Smartphone,
  Spinner,
  Switch,
  UserRoundPlus,
  X,
} from "@openbot/ui";
import type { JSX } from "@solidjs/web";
import { createEffect, createSignal, createStore, createUniqueId, For, Show } from "solid-js";
import { useText } from "../text";
import { MoreProvidersDialog } from "./MoreProvidersDialog";
import { ProviderAccountList } from "./ProviderAccountList";
import { hasKeyAccounts, type ProviderAccountActions, type ProviderPickerAccount } from "./provider-accounts";
import {
  createProviderRow,
  customEngineDownloadAction,
  PROVIDER_ACTION_LABEL,
  PROVIDER_ACTION_TEXT,
  type ProviderAction,
  providerAction,
  providerStatusLabel,
  providerStatusVariant,
  runtimeStoreAction,
  servesCustomProvider,
  showProviderInUse,
} from "./provider-row";

export type ProviderConnectKind = "browser" | "dialog";

export type ProviderAlternativeSignIn = "code" | "address";

export interface ProviderConnection {
  connectKind: (provider: AgentProviderId) => ProviderConnectKind | null;
  alternativeKind: (provider: AgentProviderId) => ProviderAlternativeSignIn | null;
  connect: (provider: AgentProviderId) => void | Promise<void>;
  alternative: (provider: AgentProviderId) => void;
  mainlandChinaSite?: (provider: AgentProviderId) => string | null;
  connectInMainlandChina?: (provider: AgentProviderId) => Promise<void>;
}

export interface ProviderPickerOption {
  id: AgentProviderId;
  name: string;
  state: AgentProviderState;
  description?: string | null;
  message?: string | null | undefined;
  email?: string | null | undefined;
  connectionState?: "connecting" | undefined;
  signInPending?: boolean | undefined;
  checkError?: string | null | undefined;
  restartPending?: boolean | undefined;
  runtimeStatus?: ProviderRuntimeStatus | undefined;
  cliSource?: AgentProviderStatus["cliSource"];
  otherCliVersion?: string | undefined;
  incompleteCliVersion?: string | undefined;
  keyStatus?: ProviderApiKeyStatus | undefined;
  freeModels?: boolean;
  callout?: { title: string; detail: string } | null;
  availableVersion?: string | null;
  lastError?: string | null | undefined;
  diagnostics?: string | undefined;
  off?: boolean | undefined;
  usedBy?: readonly string[] | undefined;
  accounts?: readonly ProviderPickerAccount[] | undefined;
  accountPool?: ProviderAccountPool | undefined;
}

export interface ProviderPickerProps {
  value: AgentProviderId | null;
  options: ProviderPickerOption[];
  ariaLabel: string;
  label?: string | undefined;
  hint?: string | undefined;
  embedded?: boolean;
  disabled?: boolean | undefined;
  allowUnavailableSelection?: boolean;
  focusFirst?: boolean;
  refreshingProviders?: boolean | undefined;
  connection?: ProviderConnection | undefined;
  onCancelProviderSignIn?: ((provider: AgentProviderId) => void | Promise<void>) | undefined;
  onDownloadProvider?: ((provider: AgentProviderId) => void | Promise<void>) | undefined;
  onCancelProviderDownload?: ((provider: AgentProviderId) => void | Promise<void>) | undefined;
  onUpdateProvider?: ((provider: AgentProviderId) => void | Promise<void>) | undefined;
  onRestartProvider?: ((provider: AgentProviderId) => void | Promise<void>) | undefined;
  onCancelProviderRestart?: ((provider: AgentProviderId) => void | Promise<void>) | undefined;
  onSetProviderOn?: ((provider: AgentProviderId, on: boolean) => void | Promise<void>) | undefined;
  onInstallProvider?: ((provider: AgentProviderId) => void | Promise<void>) | undefined;
  onSignInProvider?: ((provider: AgentProviderId) => void | Promise<void>) | undefined;
  accountActions?: ProviderAccountActions | undefined;
  menuMount?: HTMLElement | undefined;
  onRefreshProviders?: (() => void | Promise<void>) | undefined;
  onAddCustomProvider?: (() => void) | undefined;
  customProviders?: readonly CustomProviderSummary[] | undefined;
  customSelected?: boolean;
  onSelectCustomProvider?: (() => void) | undefined;
  onManageCustomProviders?: (() => void) | undefined;
  moreProviders?: readonly ProviderPickerOption[] | undefined;
  customInMore?: boolean;
  customEngine?: ProviderPickerOption | undefined;
  versionInDetail?: boolean;
  moreCallout?: { title: string; detail: string } | null;
  onChooseMoreProvider?: ((provider: AgentProviderId) => void) | undefined;
  onChooseMoreCustom?: (() => void) | undefined;
  detected?: JSX.Element;
  onChange: (provider: AgentProviderId) => void;
}

export function ProviderPicker(props: ProviderPickerProps) {
  const { t, format, sourceText, errorMessage } = useText();
  const inputs = new Set<HTMLInputElement>();
  const inputFor = (provider: AgentProviderId) =>
    [...inputs].find((input) => input.isConnected && input.value === provider);
  let moreButton: HTMLButtonElement | undefined;
  const pickerId = createUniqueId();
  const addCustomId = `${pickerId}-custom`;
  const customRadioId = `${pickerId}-custom-radio`;
  const openCode = () => props.customEngine ?? props.options.find((option) => option.id === "opencode");
  const customReady = () => servesCustomProvider(openCode());
  const endpointCount = () => props.customProviders?.length ?? 0;
  const endpointCountLabel = () => t("provider.endpointCount", { count: endpointCount() });
  const countManageable = () => endpointCount() > 0 && Boolean(props.onManageCustomProviders);
  const customSelectable = () => Boolean(props.onSelectCustomProvider) && endpointCount() > 0;
  const checkedProvider = () => (customSelectable() && props.customSelected ? null : props.value);
  const moreProviders = () => props.moreProviders ?? [];
  const moreOffered = () => moreProviders().length > 0 || Boolean(props.customInMore);
  const [moreOpen, setMoreOpen] = createSignal(false);
  let moreChoice: AgentProviderId | "custom" | null = null;
  let focused = false;
  const [useChanges, setUseChanges] = createStore<
    Partial<Record<AgentProviderId, { pending: boolean; error: string | null }>>
  >({});
  async function setProviderOn(provider: AgentProviderId, on: boolean) {
    if (useChanges[provider]?.pending) return;
    setUseChanges((state) => {
      state[provider] = { pending: true, error: null };
    });
    try {
      await props.onSetProviderOn?.(provider, on);
    } catch (error) {
      setUseChanges((state) => {
        state[provider] = { pending: false, error: errorMessage(error, t("error.provider.useChangeFailed")) };
      });
      return;
    }
    setUseChanges((state) => {
      state[provider] = { pending: false, error: null };
    });
  }
  const customRow = (engine: () => ProviderPickerOption) => (
    <div
      class={[
        "provider-picker-option",
        "provider-picker-option-custom",
        {
          "provider-picker-option-selected": customSelectable() && Boolean(props.customSelected),
          "provider-picker-option-unavailable": !customReady(),
        },
      ]}
    >
      <label
        for={customSelectable() ? customRadioId : customReady() ? addCustomId : undefined}
        class="provider-picker-option-selection"
      >
        <Show when={customSelectable()}>
          <Input
            id={customRadioId}
            type="radio"
            name={props.ariaLabel}
            value="custom"
            checked={Boolean(props.customSelected)}
            disabled={props.disabled || (!props.allowUnavailableSelection && !customReady())}
            onChange={() => props.onSelectCustomProvider?.()}
          />
        </Show>
        <SlidersHorizontal class="provider-picker-custom-mark" aria-hidden="true" />
        <span class="provider-picker-identity">
          <span class="provider-picker-name">{t("provider.custom.name")}</span>
          <small class="provider-picker-email">{t("provider.custom.description")}</small>
        </span>
        <span class="provider-picker-state">
          <Show when={endpointCount() > 0 && !countManageable()}>
            <Badge class="provider-picker-custom-count" variant="secondary">
              {endpointCountLabel()}
            </Badge>
          </Show>
          <Show when={!customReady()}>
            <Badge
              class={`provider-picker-status provider-picker-status-${engine().state}`}
              variant={providerStatusVariant(engine().state)}
            >
              {providerStatusLabel(t, format, engine().state)}
            </Badge>
          </Show>
        </span>
      </label>
      <div class="provider-picker-actions">
        <Show when={countManageable()}>
          <Button
            type="button"
            variant="ghost"
            size="xs"
            class="provider-picker-custom-count"
            aria-label={t("provider.manageEndpoints", { count: endpointCount() })}
            disabled={props.disabled}
            onClick={() => props.onManageCustomProviders?.()}
          >
            {endpointCountLabel()}
          </Button>
        </Show>
        <Show when={customReady() && props.onAddCustomProvider}>
          <Button
            id={addCustomId}
            type="button"
            variant="outline"
            size="xs"
            class="provider-picker-install"
            aria-label={t("provider.custom.addLabel")}
            disabled={props.disabled || props.refreshingProviders}
            onClick={() => props.onAddCustomProvider?.()}
          >
            {t("common.add")}
          </Button>
        </Show>
        <Show
          when={(() => {
            if (!props.onDownloadProvider && !props.onCancelProviderDownload) return undefined;
            if (customReady()) return undefined;
            return customEngineDownloadAction(engine());
          })()}
        >
          {(action) => (
            <Button
              type="button"
              variant={action() === "download" ? "default" : "outline"}
              size="xs"
              class="provider-picker-install"
              aria-label={t(PROVIDER_ACTION_LABEL[action()], { name: engine().name })}
              disabled={props.disabled || (props.refreshingProviders && !runtimeStoreAction(action()))}
              onClick={() => {
                if (action() === "cancel") {
                  void props.onCancelProviderDownload?.(engine().id);
                } else {
                  void props.onDownloadProvider?.(engine().id);
                }
              }}
            >
              {t(PROVIDER_ACTION_TEXT[action()])}
            </Button>
          )}
        </Show>
        <Show
          when={
            !engine().runtimeStatus &&
            engine().state === "not-installed" &&
            agentProviderDescriptor(engine().id).installGuideLink !== null &&
            props.onInstallProvider
          }
        >
          <Button
            type="button"
            variant="outline"
            size="xs"
            class="provider-picker-install"
            aria-label={t("provider.custom.installLabel")}
            disabled={props.disabled || props.refreshingProviders}
            onClick={() => void props.onInstallProvider?.(engine().id)}
          >
            {t("provider.action.install")}
          </Button>
        </Show>
      </div>
    </div>
  );

  createEffect(
    () => ({
      focusFirst: props.focusFirst,
      options: props.options,
      allowUnavailableSelection: props.allowUnavailableSelection,
    }),
    ({ focusFirst, options, allowUnavailableSelection }) => {
      if (!focusFirst || focused) return;
      const first =
        options.find((option) => option.state === "available" && !option.off) ??
        (allowUnavailableSelection ? options.find((option) => !option.off) : undefined);
      const input = first ? inputFor(first.id) : undefined;
      if (!input) return;
      focused = true;
      input.focus();
    },
  );

  return (
    <div
      class={[
        "provider-picker",
        {
          "provider-picker-standalone": !props.embedded,
          "provider-picker-embedded": Boolean(props.embedded),
        },
      ]}
    >
      <Show when={props.label || props.onRefreshProviders}>
        <div class="provider-picker-heading">
          <Show when={props.label}>{(label) => <div class="provider-picker-label">{label()}</div>}</Show>
          <Show when={props.onRefreshProviders}>
            <Button
              type="button"
              variant="ghost"
              size="xs"
              class="provider-picker-refresh"
              aria-label={props.refreshingProviders ? t("provider.refreshingLabel") : t("provider.refreshLabel")}
              loading={props.refreshingProviders}
              loadingLabel={t("provider.refreshing")}
              disabled={props.disabled}
              onClick={() => void props.onRefreshProviders?.()}
            >
              <RefreshCw size={13} aria-hidden="true" />
              {t("provider.refresh")}
            </Button>
          </Show>
        </div>
      </Show>
      <div class="provider-picker-list">
        <div role="radiogroup" aria-label={props.ariaLabel}>
          <For each={props.options} keyed={false}>
            {(option) => {
              const {
                state,
                runtimeStatus,
                connecting,
                available,
                off,
                updatable,
                version,
                visualState,
                alternative,
                mainlandChinaSite,
                connectInMainlandChina,
                connectOptional,
                runtimeAction,
                browserConnect,
                keyConnect,
                codeFallbackOffered,
                signInAlternative,
                connectError,
                connect,
                runAction,
                cancelSignIn,
                signingIn,
                hostSignInHint,
                statusMessage,
                updateOffered,
                restartOffered,
                diagnosticsOffered,
                accountsOffered,
                accountError,
                addAccount,
                accountCodeOffered,
                addAccountWithCode,
                installOffered,
                signInOffered,
                apiKeyOffered,
                freeKey,
              } = createProviderRow(option, props);
              const actionsMenu = () =>
                alternative() !== null ||
                mainlandChinaSite() !== null ||
                (accountCodeOffered() && !hasKeyAccounts(option().id)) ||
                updateOffered() ||
                restartOffered() ||
                diagnosticsOffered();
              const inputId = () => `${pickerId}-${option().id}`;
              const checked = () => !off() && checkedProvider() === option().id;
              const listedAccounts = () => {
                const accounts = option().accounts ?? [];
                return props.accountActions && accounts.length > 1 && !off() ? accounts : null;
              };
              return (
                <div
                  class={[
                    "provider-picker-option",
                    {
                      "provider-picker-option-selected": checked(),
                      "provider-picker-option-unavailable": !available() || off(),
                      "provider-picker-option-runtime": Boolean(runtimeStatus()),
                      "provider-picker-option-selectable-unavailable":
                        !available() && !off() && Boolean(props.allowUnavailableSelection),
                      "provider-picker-option-with-callout": Boolean(option().callout),
                    },
                  ]}
                  title={!off() && option().message ? sourceText(option().message ?? "") : undefined}
                >
                  <Show when={option().callout}>
                    {(callout) => <ProviderCallout title={callout().title} detail={callout().detail} />}
                  </Show>
                  <label for={inputId()} class="provider-picker-option-selection">
                    <Input
                      id={inputId()}
                      ref={(element) => inputs.add(element)}
                      type="radio"
                      name={props.ariaLabel}
                      value={option().id}
                      checked={checked()}
                      disabled={props.disabled || off() || (!props.allowUnavailableSelection && !available())}
                      onChange={() => props.onChange(option().id)}
                    />
                    <ProviderLogo provider={option().id} class="provider-picker-logo" />
                    <span class="provider-picker-identity">
                      <span class="provider-picker-name">{option().name}</span>
                      <Show
                        when={
                          listedAccounts()
                            ? t("provider.account.count", { count: listedAccounts()?.length ?? 0 })
                            : (option().email ?? option().description ?? (props.versionInDetail ? version() : null))
                        }
                      >
                        {(detail) => <small class="provider-picker-email">{detail()}</small>}
                      </Show>
                      <Show when={off() ? undefined : option().checkError}>
                        {(checkError) => <small class="provider-picker-check-error">{sourceText(checkError())}</small>}
                      </Show>
                      <Show
                        when={!off() && option().lastError !== option().checkError ? option().lastError : undefined}
                      >
                        {(lastError) => (
                          <small class="provider-picker-check-error" title={sourceText(lastError())}>
                            {t("provider.lastError", { detail: sourceText(lastError()) })}
                          </small>
                        )}
                      </Show>
                      <Show when={!off() && option().restartPending}>
                        <small class="provider-picker-email" role="status">
                          {t("provider.restartPending")}
                        </small>
                      </Show>
                      <Show when={hostSignInHint()}>
                        <small class="provider-picker-email" role="status">
                          {t("provider.gemini.hostSignIn")}
                        </small>
                      </Show>
                      <Show when={connectError() ?? statusMessage()}>
                        {(message) => (
                          <small
                            class={[
                              "provider-picker-status-message",
                              state() === "error" || runtimeStatus()?.phase === "download-error" || connectError()
                                ? "provider-picker-check-error"
                                : "provider-picker-email",
                            ]}
                          >
                            {sourceText(message())}
                          </small>
                        )}
                      </Show>
                      <Show when={!off() && signingIn()}>
                        <small class="provider-picker-email" role="status">
                          {t("provider.connecting.browserHint")}
                        </small>
                      </Show>
                    </span>
                    <span class="provider-picker-state">
                      <Show
                        when={!off()}
                        fallback={
                          <Badge class="provider-picker-status provider-picker-status-off" variant="secondary">
                            {t("provider.status.off")}
                          </Badge>
                        }
                      >
                        <Show when={props.versionInDetail ? null : version()}>
                          {(installed) => <small class="provider-picker-version">{installed()}</small>}
                        </Show>
                        <Show when={freeKey()}>
                          <Badge class="provider-picker-status provider-picker-key-status" variant="secondary">
                            {t("provider.key.free")}
                          </Badge>
                        </Show>
                        <Show when={runtimeStatus()?.phase !== "not-downloaded" || updatable()}>
                          <Badge
                            class={`provider-picker-status provider-picker-status-${visualState()}`}
                            variant={providerStatusVariant(visualState())}
                          >
                            {providerStatusLabel(t, format, state(), connecting(), runtimeStatus(), updatable())}
                          </Badge>
                        </Show>
                      </Show>
                    </span>
                  </label>
                  <div class="provider-picker-actions">
                    <Show when={!off()}>
                      <Show when={accountsOffered() && !hasKeyAccounts(option().id)}>
                        <Button
                          type="button"
                          variant="outline"
                          size="xs"
                          class="provider-picker-install provider-picker-add-account"
                          aria-label={t("provider.account.addLabel", { name: option().name })}
                          disabled={props.disabled || props.refreshingProviders}
                          onClick={addAccount}
                        >
                          <UserRoundPlus aria-hidden="true" />
                          {t("provider.account.add")}
                        </Button>
                      </Show>
                      <Show when={codeFallbackOffered()}>
                        <Button
                          type="button"
                          variant="outline"
                          size="xs"
                          class="provider-picker-install"
                          aria-label={t("provider.aria.codeFallback", { name: option().name })}
                          disabled={props.disabled || props.refreshingProviders}
                          onClick={signInAlternative}
                        >
                          {t("provider.action.signInWithCode")}
                        </Button>
                      </Show>
                      <Show when={runtimeAction()}>
                        {(action) => (
                          <Button
                            type="button"
                            variant={
                              action() === "download" || (action() === "connect" && !connectOptional())
                                ? "default"
                                : "outline"
                            }
                            size="xs"
                            class={connectOptional() ? "provider-picker-install" : providerActionClass(action())}
                            aria-label={t(PROVIDER_ACTION_LABEL[action()], { name: option().name })}
                            disabled={props.disabled || (props.refreshingProviders && !runtimeStoreAction(action()))}
                            onClick={() => runAction(action())}
                          >
                            {t(PROVIDER_ACTION_TEXT[action()])}
                          </Button>
                        )}
                      </Show>
                      <Show when={signingIn() && props.onCancelProviderSignIn}>
                        <Button
                          type="button"
                          variant="ghost"
                          size="xs"
                          aria-label={t("provider.aria.cancelSignIn", { name: option().name })}
                          disabled={props.disabled}
                          onClick={cancelSignIn}
                        >
                          {t("common.cancel")}
                        </Button>
                      </Show>
                      <Show when={installOffered()}>
                        <Button
                          type="button"
                          variant="outline"
                          size="xs"
                          class="provider-picker-install"
                          aria-label={t("provider.aria.install", { name: option().name })}
                          disabled={props.disabled || props.refreshingProviders}
                          onClick={() => void props.onInstallProvider?.(option().id)}
                        >
                          {t("provider.action.install")}
                        </Button>
                      </Show>
                      <Show when={!runtimeStatus() && (browserConnect() || keyConnect())}>
                        <Button
                          type="button"
                          variant={providerAction(state(), connecting()) === "connect" ? "default" : "outline"}
                          size="xs"
                          class={providerActionClass(providerAction(state(), connecting()))}
                          aria-label={t(PROVIDER_ACTION_LABEL[providerAction(state(), connecting())], {
                            name: option().name,
                          })}
                          aria-busy={connecting() ? "true" : undefined}
                          disabled={props.disabled || props.refreshingProviders}
                          onClick={connect}
                        >
                          <Show when={connecting()}>
                            <Spinner size="sm" />
                          </Show>
                          {t(PROVIDER_ACTION_TEXT[providerAction(state(), connecting())])}
                        </Button>
                      </Show>
                      <Show when={signInOffered()}>
                        <Button
                          type="button"
                          variant="outline"
                          size="xs"
                          class="provider-picker-install"
                          aria-label={t("provider.aria.signIn", { name: option().name })}
                          disabled={props.disabled || props.refreshingProviders}
                          onClick={() => void props.onSignInProvider?.(option().id)}
                        >
                          {t("provider.action.signIn")}
                        </Button>
                      </Show>
                      <Show when={apiKeyOffered()}>
                        <Button
                          type="button"
                          variant="outline"
                          size="xs"
                          class="provider-picker-install"
                          aria-label={t("provider.aria.apiKey", { name: option().name })}
                          disabled={props.disabled || props.refreshingProviders}
                          onClick={() => void props.onSignInProvider?.(option().id)}
                        >
                          {t("provider.action.apiKey")}
                        </Button>
                      </Show>

                      <Show when={actionsMenu()}>
                        <DropdownMenu.Root placement="bottom-end" gutter={4} modal={false}>
                          <DropdownMenu.Trigger
                            class={`${buttonVariants({ variant: "ghost", size: "icon-sm" })} ui-icon-button`}
                            aria-label={t("provider.aria.moreActions", { name: option().name })}
                            disabled={props.disabled || props.refreshingProviders}
                          >
                            <Ellipsis aria-hidden="true" />
                          </DropdownMenu.Trigger>
                          <DropdownMenu.Portal mount={props.menuMount ?? document.body}>
                            <DropdownMenu.Content>
                              <Show when={updateOffered()}>
                                <DropdownMenu.Item
                                  disabled={connecting()}
                                  onSelect={() => void props.onUpdateProvider?.(option().id)}
                                >
                                  <RefreshCw aria-hidden="true" />
                                  {updatable()
                                    ? t("provider.action.updateTo", { version: option().availableVersion ?? "" })
                                    : t("provider.action.checkForUpdates")}
                                </DropdownMenu.Item>
                              </Show>
                              <Show when={restartOffered()}>
                                <Show
                                  when={option().restartPending}
                                  fallback={
                                    <DropdownMenu.Item onSelect={() => void props.onRestartProvider?.(option().id)}>
                                      <RotateCcw aria-hidden="true" />
                                      {t("provider.action.restart")}
                                    </DropdownMenu.Item>
                                  }
                                >
                                  <DropdownMenu.Item onSelect={() => void props.onCancelProviderRestart?.(option().id)}>
                                    <X aria-hidden="true" />
                                    {t("provider.action.cancelRestart")}
                                  </DropdownMenu.Item>
                                </Show>
                              </Show>
                              <Show when={alternative()}>
                                {(kind) => (
                                  <DropdownMenu.Item onSelect={signInAlternative}>
                                    <Show when={kind() === "address"} fallback={<Smartphone aria-hidden="true" />}>
                                      <Link aria-hidden="true" />
                                    </Show>
                                    {t(
                                      kind() === "address"
                                        ? "provider.action.pasteAddress"
                                        : "provider.action.signInWithCode",
                                    )}
                                  </DropdownMenu.Item>
                                )}
                              </Show>
                              <Show when={mainlandChinaSite()}>
                                {(site) => (
                                  <DropdownMenu.Item onSelect={connectInMainlandChina}>
                                    <Globe2 aria-hidden="true" />
                                    {t("provider.action.signInMainlandChina", { site: site() })}
                                  </DropdownMenu.Item>
                                )}
                              </Show>
                              <Show when={accountCodeOffered() && !hasKeyAccounts(option().id)}>
                                <DropdownMenu.Item onSelect={addAccountWithCode}>
                                  <Smartphone aria-hidden="true" />
                                  {t("provider.account.addWithCode")}
                                </DropdownMenu.Item>
                              </Show>
                              <Show when={diagnosticsOffered()}>
                                <DropdownMenu.Item
                                  onSelect={() => void navigator.clipboard.writeText(option().diagnostics ?? "")}
                                >
                                  <Copy aria-hidden="true" />
                                  {t("provider.action.copyDiagnostics")}
                                </DropdownMenu.Item>
                              </Show>
                            </DropdownMenu.Content>
                          </DropdownMenu.Portal>
                        </DropdownMenu.Root>
                      </Show>
                    </Show>
                    <Show when={props.onSetProviderOn}>
                      <Switch
                        size="sm"
                        class="provider-picker-use"
                        checked={!off()}
                        disabled={Boolean(
                          props.disabled || props.refreshingProviders || useChanges[option().id]?.pending,
                        )}
                        aria-busy={useChanges[option().id]?.pending ? "true" : "false"}
                        aria-label={t("provider.aria.use", { name: option().name })}
                        onChange={(on: boolean) => {
                          const usedBy = option().usedBy ?? [];
                          if (!on && usedBy.length > 0) {
                            showProviderInUse(t, usedBy, option().name);
                            return;
                          }
                          void setProviderOn(option().id, on);
                        }}
                      />
                    </Show>
                  </div>
                  <Show when={accountError()}>
                    {(message) => (
                      <small class="provider-picker-check-error provider-picker-used-by" role="alert">
                        {message()}
                      </small>
                    )}
                  </Show>
                  <Show when={listedAccounts()}>
                    {(accounts) => (
                      <Show when={props.accountActions}>
                        {(actions) => (
                          <ProviderAccountList
                            provider={option().id}
                            providerName={option().name}
                            accounts={accounts()}
                            actions={actions()}
                            disabled={props.disabled}
                            menuMount={props.menuMount}
                          />
                        )}
                      </Show>
                    )}
                  </Show>
                  <Show when={useChanges[option().id]?.error}>
                    {(message) => (
                      <small class="provider-picker-check-error provider-picker-used-by" role="alert">
                        {message()}
                      </small>
                    )}
                  </Show>
                </div>
              );
            }}
          </For>
          <Show when={customSelectable() && !props.customInMore ? openCode() : undefined}>
            {(engine) => customRow(engine)}
          </Show>
        </div>
        <Show when={!customSelectable() && props.onAddCustomProvider && !props.customInMore ? openCode() : undefined}>
          {(engine) => customRow(engine)}
        </Show>
      </div>
      {props.detected}
      <Show
        when={moreOffered()}
        fallback={<Show when={props.hint}>{(hint) => <p class="provider-picker-hint">{hint()}</p>}</Show>}
      >
        <div class="provider-picker-footer">
          <Show when={props.hint}>{(hint) => <p class="provider-picker-hint">{hint()}</p>}</Show>
          <Button
            type="button"
            variant="ghost"
            size="xs"
            class="provider-picker-refresh provider-picker-more"
            aria-haspopup="dialog"
            data-cuelume-tap="open"
            ref={(element: HTMLButtonElement) => {
              moreButton = element;
            }}
            disabled={props.disabled}
            onClick={() => setMoreOpen(true)}
          >
            <Show when={moreProviders().length > 0}>
              <span class="provider-picker-logo-stack" aria-hidden="true">
                <For each={moreProviders().slice(0, 2)} keyed={false}>
                  {(option) => (
                    <span class="provider-picker-logo-stack-mark">
                      <ProviderLogo provider={option().id} class="provider-picker-logo" />
                    </span>
                  )}
                </For>
              </span>
            </Show>
            {t("onboarding.provider.more")}
          </Button>
          <Show when={!moreOpen() ? props.moreCallout : undefined}>
            {(callout) => (
              <ProviderCallout title={callout().title} detail={callout().detail} class="provider-picker-callout-end" />
            )}
          </Show>
        </div>
        <MoreProvidersDialog
          open={moreOpen()}
          onOpenChange={setMoreOpen}
          providers={moreProviders()}
          custom={Boolean(props.customInMore)}
          onChoose={(provider) => {
            moreChoice = provider;
            props.onChooseMoreProvider?.(provider);
          }}
          onChooseCustom={() => {
            moreChoice = "custom";
            props.onChooseMoreCustom?.();
          }}
          onCloseAutoFocus={(event) => {
            const choice = moreChoice;
            moreChoice = null;
            event.preventDefault();
            if (!choice || (choice === "custom" && !customReady())) moreButton?.focus();
            else if (choice !== "custom") inputFor(choice)?.focus();
          }}
        />
      </Show>
    </div>
  );
}

function ProviderCallout(props: { title: string; detail: string; class?: string }) {
  return (
    <span class={["provider-picker-callout", props.class]} aria-hidden="true">
      <span class="provider-picker-callout-title">{props.title}</span>
      <span class="provider-picker-callout-detail">{props.detail}</span>
      <svg class="provider-picker-callout-arrow" viewBox="0 0 92 40" fill="none" aria-hidden="true">
        <circle cx="4" cy="6" r="3" fill="currentColor" />
        <path d="M4 6C20 34 56 38 81 31" stroke="currentColor" stroke-width="1.6" />
        <path d="M89 28.5L81.6 34.7L79.2 27Z" fill="currentColor" />
      </svg>
    </span>
  );
}

function providerActionClass(action: ProviderAction) {
  return action === "connect" ? "provider-picker-install provider-picker-connect" : "provider-picker-install";
}
