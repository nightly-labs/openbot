import { ProviderLogo } from "@openbot/brand";
import { agentProviderDescriptor } from "@openbot/contracts/agent-providers";
import type {
  AgentProviderId,
  AgentProviderState,
  CustomProviderSummary,
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
import type { ProviderAccountActions, ProviderPickerAccount } from "./provider-accounts";
import {
  createProviderRow,
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

/**
 * What a row's Connect opens: the sign-in in this computer's browser, which the row follows itself,
 * or a dialog that the caller shows (a code, a page or the hand-off to the app).
 */
export type ProviderConnectKind = "browser" | "dialog";

/**
 * What a row's ⋯ menu offers instead of its Connect: a code, or the address that the browser of a
 * relayed sign-in shows at its end.
 */
export type ProviderAlternativeSignIn = "code" | "address";

/**
 * How the provider rows sign in. The caller decides each row's ways in from where the user connects;
 * the rows only show and run them, so every surface offers the same ones.
 */
export interface ProviderConnection {
  /** What the row's Connect opens, or null when the row has no Connect here. */
  connectKind: (provider: AgentProviderId) => ProviderConnectKind | null;
  /** The second way in that the row's ⋯ menu offers, or null when it offers none. */
  alternativeKind: (provider: AgentProviderId) => ProviderAlternativeSignIn | null;
  /** Runs the row's Connect. A rejection is shown on the row. */
  connect: (provider: AgentProviderId) => void | Promise<void>;
  /** Runs the second way in from the ⋯ menu. */
  alternative: (provider: AgentProviderId) => void;
}

export interface ProviderPickerOption {
  id: AgentProviderId;
  name: string;
  state: AgentProviderState;
  description?: string | null;
  message?: string | null | undefined;
  email?: string | null | undefined;
  connectionState?: "connecting" | undefined;
  /** False while a connecting row is checked again, with no sign-in that waits for the user. */
  signInPending?: boolean | undefined;
  checkError?: string | null | undefined;
  /** A restart the user asked for waits for the provider's tasks to stop. */
  restartPending?: boolean | undefined;
  runtimeStatus?: ProviderRuntimeStatus | undefined;
  /**
   * Whether the provider's key is saved: the optional OpenCode key, a Gemini key in use, or a Claude
   * key on a host that reads it. Absent while unknown, so the row shows no badge rather than a
   * wrong one.
   */
  keyStatus?: ProviderApiKeyStatus | undefined;
  /**
   * Whether the row runs free models with no account, so a downloaded row needs no Connect.
   * Onboarding sets it for OpenCode, whose first-run choice needs no key.
   */
  freeModels?: boolean;
  /**
   * A short note drawn beside the row with an arrow pointing at it, like the drag hint of a macOS
   * installer. It repeats what the row already says, so assistive technology does not read it.
   */
  callout?: { title: string; detail: string } | null;
  /** The newer runtime main says exists. The renderer never works this out itself. */
  availableVersion?: string | null;
  /** The provider's last failure, kept until a model list fetched after it succeeds. */
  lastError?: string | null | undefined;
  /** What "Copy diagnostics" puts on the clipboard. Offered only while the row has a last error. */
  diagnostics?: string | undefined;
  /**
   * The user turned the provider off in OpenBot. OpenBot does not start, check or list it, so the
   * row shows only "Off" and the switch that turns it on again.
   */
  off?: boolean | undefined;
  /** The names of the agents that use the provider. While there is one, the switch does not turn it off. */
  usedBy?: readonly string[] | undefined;
  /**
   * The accounts of a provider that can hold more than one, its own sign-in first. With
   * `accountActions`, a connected row offers Add account, and lists them from the second one on.
   */
  accounts?: readonly ProviderPickerAccount[] | undefined;
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
  /** How each row signs in. Without it, no row offers Connect or a second way in. */
  connection?: ProviderConnection | undefined;
  /** Ends the browser sign-in that Connect started, so a closed or stuck page is not a dead end. */
  onCancelProviderSignIn?: ((provider: AgentProviderId) => void | Promise<void>) | undefined;
  onDownloadProvider?: ((provider: AgentProviderId) => void | Promise<void>) | undefined;
  onCancelProviderDownload?: ((provider: AgentProviderId) => void | Promise<void>) | undefined;
  /**
   * Starts the update the row offers, or asks for one when none is offered yet. Whether that
   * re-downloads the managed runtime or runs the CLI's own updater is decided by the caller, which
   * knows who owns the install.
   */
  onUpdateProvider?: ((provider: AgentProviderId) => void | Promise<void>) | undefined;
  /**
   * Restarts a connected provider's process after its tasks stop. Only the computer that runs the
   * provider has it; a row with `restartPending` offers `onCancelProviderRestart` instead.
   */
  onRestartProvider?: ((provider: AgentProviderId) => void | Promise<void>) | undefined;
  onCancelProviderRestart?: ((provider: AgentProviderId) => void | Promise<void>) | undefined;
  /**
   * Turns a provider on or off in OpenBot. With it each provider row has a switch. A row whose
   * `usedBy` names an agent stays on, and a toast tells why, so no agent loses its provider silently.
   */
  onSetProviderOn?: ((provider: AgentProviderId, on: boolean) => void | Promise<void>) | undefined;
  onInstallProvider?: ((provider: AgentProviderId) => void | Promise<void>) | undefined;
  onSignInProvider?: ((provider: AgentProviderId) => void | Promise<void>) | undefined;
  /** Adds, signs in, names and removes the accounts of a row. Settings has it; onboarding does not. */
  accountActions?: ProviderAccountActions | undefined;
  /**
   * The dialog element a row's actions menu portals into. Without it the menu lands beside the
   * dialog in `body`, where a modal makes it inert and out of reach.
   */
  menuMount?: HTMLElement | undefined;
  onRefreshProviders?: (() => void | Promise<void>) | undefined;
  /** Add row gated by OpenCode install; else offers install. */
  onAddCustomProvider?: (() => void) | undefined;
  /** Named endpoints share one row; endpoint pick is model pick. */
  customProviders?: readonly CustomProviderSummary[] | undefined;
  /** Custom check suppresses provider check; needs endpoint + handler. */
  customSelected?: boolean;
  onSelectCustomProvider?: (() => void) | undefined;
  /**
   * Opens the list of saved endpoints, where they are removed. With it the count is a button beside
   * Add; without it the count stays a badge inside the label, because a button must not sit inside
   * a `<label>`: a click there would answer the radio instead.
   */
  onManageCustomProviders?: (() => void) | undefined;
  /**
   * The providers that the list does not show. With one or more, or with `customInMore`, a
   * "More providers" button below the list opens a dialog that lists them. The caller adds the
   * provider that the user chooses to `options`, and selects it.
   */
  moreProviders?: readonly ProviderPickerOption[] | undefined;
  /** The custom provider row is in the "More providers" dialog, not in the list. */
  customInMore?: boolean;
  /** The OpenCode option that runs the custom endpoints, when OpenCode is not a row of `options`. */
  customEngine?: ProviderPickerOption | undefined;
  /**
   * The installed version goes on the line under the name when the row has no email and no
   * description, so the badge has the row's last column alone.
   */
  versionInDetail?: boolean;
  /** A note beside the "More providers" button, drawn like a row's `callout`. */
  moreCallout?: { title: string; detail: string } | null;
  onChooseMoreProvider?: ((provider: AgentProviderId) => void) | undefined;
  onChooseMoreCustom?: (() => void) | undefined;
  /** What the host found on this computer, below the list. It is not a row in the radio group. */
  detected?: JSX.Element;
  onChange: (provider: AgentProviderId) => void;
}

export function ProviderPicker(props: ProviderPickerProps) {
  const { t, format, sourceText, errorMessage } = useText();
  // Rows are keyed by position, so a row's input can show another provider after the list changes.
  // The input is found by its current value, not by the provider it was made for.
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
  /** The count answers a click only where the list can be opened. Elsewhere it stays a badge. */
  const countManageable = () => endpointCount() > 0 && Boolean(props.onManageCustomProviders);
  /** The row is a choice once it has something to run and someone to tell about the choice. */
  const customSelectable = () => Boolean(props.onSelectCustomProvider) && endpointCount() > 0;
  /** The Custom provider row holds the check mark, so the provider row that serves it does not. */
  const checkedProvider = () => (customSelectable() && props.customSelected ? null : props.value);
  const moreProviders = () => props.moreProviders ?? [];
  const moreOffered = () => moreProviders().length > 0 || Boolean(props.customInMore);
  const [moreOpen, setMoreOpen] = createSignal(false);
  /**
   * What the user chose in the dialog. A chosen provider becomes a row, so the focus goes to its
   * radio and not back to the button. The custom provider opens its own dialog, which takes the focus.
   */
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
  /** One custom row; inside group when choosable, after when add-only. */
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
      {/* Label targets radio when choosable, Add button otherwise. */}
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
          {/* Count only; endpoint naming is the model picker's job. Moves beside Add when it opens the list. */}
          <Show when={endpointCount() > 0 && !countManageable()}>
            <Badge class="provider-picker-custom-count" variant="secondary">
              {endpointCountLabel()}
            </Badge>
          </Show>
          {/* Reports OpenCode state in shared words, without naming OpenCode. */}
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
        {/* Count as action: named for what it opens, not the state it shows. */}
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
        {/* Same OpenCode runtime fetch unblocks Add. Once Add shows, the OpenCode row keeps its own Retry. */}
        <Show
          when={(() => {
            if (!props.onDownloadProvider && !props.onCancelProviderDownload) return undefined;
            if (customReady()) return undefined;
            const engineOption = engine();
            const runtime = engineOption.runtimeStatus;
            if (!runtime) return undefined;
            if (runtime.phase === "not-downloaded") return "download" as const;
            if (runtime.phase === "downloading") return "cancel" as const;
            if (runtime.phase === "download-error") return "retry" as const;
            return undefined;
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
                  void props.onCancelProviderDownload?.("opencode");
                } else {
                  void props.onDownloadProvider?.("opencode");
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
            agentProviderDescriptor("opencode").installGuideLink !== null &&
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
            onClick={() => void props.onInstallProvider?.("opencode")}
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
        {/* Custom row joins the group once endpoints exist. */}
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
                installOffered,
                signInOffered,
                apiKeyOffered,
                freeKey,
              } = createProviderRow(option, props);
              const actionsMenu = () =>
                alternative() !== null || updateOffered() || restartOffered() || diagnosticsOffered();
              const inputId = () => `${pickerId}-${option().id}`;
              /** An off row is not a choice, so it never holds the check. */
              const checked = () => !off() && checkedProvider() === option().id;
              /** From the second account on, the row counts them and lists each one under it. */
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
                    {/* Version shares the badge column. */}
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
                        {/* Free-tier badge only beside runtime badge. */}
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
                  {/* Actions share one grid cell; a sibling button would stretch its own row. */}
                  <div class="provider-picker-actions">
                    {/* An off provider has no process to act on, so the switch is its only action. */}
                    <Show when={!off()}>
                      <Show when={accountsOffered()}>
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
                      {/* The row's secondary actions: Update on every downloaded runtime, and the code
                      sign-in for the computer the browser hand-off cannot serve (no browser, a
                      remote session, or a browser signed in to the wrong account).

                      Behind a menu rather than beside Connect: a second button on every row would
                      make the rows argue about which one to press, and the "Update available" badge
                      already points at the offer. */}
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
                  {/* Outside the label: inside it, the message would be part of the radio's name, and
                    a click on it would choose the provider. */}
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
        {/* The button opens a dialog, so it is below the list and not a row in the radio group. */}
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
            {/* Up to two logos, so the user can see that their provider is behind the button. */}
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
            // The dialog has no trigger, so Kobalte focuses nothing when it closes. With no choice, or a
            // custom provider that no form opens for (OpenCode is not ready), the focus goes back to
            // the button. The custom form takes the focus itself.
            event.preventDefault();
            if (!choice || (choice === "custom" && !customReady())) moreButton?.focus();
            else if (choice !== "custom") inputFor(choice)?.focus();
          }}
        />
      </Show>
    </div>
  );
}

/**
 * A short note with an arrow, like the drag hint of a macOS installer. It repeats text that is
 * already on the screen, so assistive technology does not read it.
 */
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

/**
 * Connect is the step a row is waiting for, so it takes the accent colour. An outlined Connect read
 * as a disabled button beside a "Ready" badge (issue #643). Reconnect and Restart repeat a step
 * already done, so they stay outlined.
 */
function providerActionClass(action: ProviderAction) {
  return action === "connect" ? "provider-picker-install provider-picker-connect" : "provider-picker-install";
}
