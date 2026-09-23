import { ProviderLogo } from "@openbot/brand";
import { agentProviderDescriptor } from "@openbot/contracts/agent-providers";
import type {
  AgentProviderId,
  AgentProviderState,
  CustomProviderSummary,
  ProviderApiKeyStatus,
  ProviderRuntimePhase,
  ProviderRuntimeStatus,
} from "@openbot/contracts/ipc";
import type { AppMessages, AppTextKey, AppTranslate } from "@openbot/i18n";
import {
  Badge,
  Button,
  buttonVariants,
  DropdownMenu,
  Ellipsis,
  Input,
  RefreshCw,
  SlidersHorizontal,
  Smartphone,
  Spinner,
} from "@openbot/ui";
import { createEffect, createUniqueId, For, Show } from "solid-js";
import { providerUpdateAvailable, providerVersionLabel } from "../features/provider-updates/provider-update";

export interface ProviderPickerOption {
  id: AgentProviderId;
  name: string;
  state: AgentProviderState;
  description?: string | null;
  message?: string | null;
  email?: string | null;
  connectionState?: "connecting";
  checkError?: string | null;
  runtimeStatus?: ProviderRuntimeStatus;
  /**
   * Whether the optional OpenCode key is saved. Only the OpenCode row carries it: no other
   * provider signs in with a pasted key. Absent while unknown, so the row shows no badge rather
   * than a wrong one.
   */
  keyStatus?: ProviderApiKeyStatus;
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
}

export interface ProviderPickerProps {
  t: AppTranslate;
  value: AgentProviderId | null;
  options: ProviderPickerOption[];
  ariaLabel: string;
  label?: string;
  hint?: string;
  embedded?: boolean;
  disabled?: boolean;
  allowUnavailableSelection?: boolean;
  focusFirst?: boolean;
  refreshingProviders?: boolean;
  onConnectProvider?: (provider: AgentProviderId) => void | Promise<void>;
  onDownloadProvider?: (provider: AgentProviderId) => void | Promise<void>;
  onCancelProviderDownload?: (provider: AgentProviderId) => void | Promise<void>;
  /**
   * Starts the update the row offers. Whether that re-downloads the managed runtime or runs the
   * CLI's own updater is decided by the caller, which knows who owns the install.
   */
  onUpdateProvider?: (provider: AgentProviderId) => void | Promise<void>;
  onInstallProvider?: (provider: AgentProviderId) => void | Promise<void>;
  onSignInProvider?: (provider: AgentProviderId) => void | Promise<void>;
  /**
   * Starts the sign-in the user finishes on another device. Offered beside the row's usual sign-in,
   * never instead of it: this is the way out for a computer whose browser cannot complete the
   * hand-off, and only for a provider whose descriptor says `codeSignIn`.
   */
  onSignInWithCodeProvider?: (provider: AgentProviderId) => void | Promise<void>;
  /**
   * The dialog element a row's actions menu portals into. Without it the menu lands beside the
   * dialog in `body`, where a modal makes it inert and out of reach.
   */
  menuMount?: HTMLElement;
  onRefreshProviders?: () => void | Promise<void>;
  /** Add row gated by OpenCode install; else offers install. */
  onAddCustomProvider?: () => void;
  /** Named endpoints share one row; endpoint pick is model pick. */
  customProviders?: readonly CustomProviderSummary[];
  /** Custom check suppresses provider check; needs endpoint + handler. */
  customSelected?: boolean;
  onSelectCustomProvider?: () => void;
  /**
   * Opens the list of saved endpoints, where they are removed. With it the count is a button beside
   * Add; without it the count stays a badge inside the label, because a button must not sit inside
   * a `<label>`: a click there would answer the radio instead.
   */
  onManageCustomProviders?: () => void;
  onChange: (provider: AgentProviderId) => void;
}

export function ProviderPicker(props: ProviderPickerProps) {
  const inputs = new Map<AgentProviderId, HTMLInputElement>();
  const pickerId = createUniqueId();
  const addCustomId = `${pickerId}-custom`;
  const customRadioId = `${pickerId}-custom-radio`;
  const openCode = () => props.options.find((option) => option.id === "opencode");
  const customReady = () => servesCustomProvider(openCode());
  const endpointCount = () => props.customProviders?.length ?? 0;
  const endpointCountLabel = () => props.t("provider.endpointCount", { count: endpointCount() });
  /** The count answers a click only where the list can be opened. Elsewhere it stays a badge. */
  const countManageable = () => endpointCount() > 0 && Boolean(props.onManageCustomProviders);
  /** The row is a choice once it has something to run and someone to tell about the choice. */
  const customSelectable = () => Boolean(props.onSelectCustomProvider) && endpointCount() > 0;
  /** The Custom provider row holds the check mark, so the provider row that serves it does not. */
  const checkedProvider = () => (customSelectable() && props.customSelected ? null : props.value);
  let focused = false;

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
          <span class="provider-picker-name">{props.t("provider.custom.name")}</span>
          <small class="provider-picker-email">{props.t("provider.custom.description")}</small>
        </span>
        <span class="provider-picker-state">
          {/* Count only; endpoint naming is the model picker's job. Moves beside Add when it opens the list. */}
          <Show when={endpointCount() > 0 && !countManageable()}>
            <Badge class="provider-picker-custom-count" tone="neutral" shape="pill">
              {endpointCountLabel()}
            </Badge>
          </Show>
          {/* Reports OpenCode state in shared words, without naming OpenCode. */}
          <Show when={!customReady()}>
            <Badge
              class={`provider-picker-status provider-picker-status-${engine().state}`}
              tone={providerStatusTone(engine().state)}
              shape="pill"
            >
              {providerStatusLabel(props.t, engine().state)}
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
            aria-label={props.t("provider.manageEndpoints", { count: endpointCount() })}
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
            aria-label={props.t("provider.custom.addLabel")}
            disabled={props.disabled || props.refreshingProviders}
            onClick={() => props.onAddCustomProvider?.()}
          >
            {props.t("provider.action.add")}
          </Button>
        </Show>
        {/* Same OpenCode runtime fetch unblocks Add. */}
        <Show
          when={(() => {
            if (!props.onDownloadProvider && !props.onCancelProviderDownload) return undefined;
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
              aria-label={props.t(PROVIDER_ACTION_LABEL[action()], { name: engine().name })}
              disabled={props.disabled || (props.refreshingProviders && !runtimeStoreAction(action()))}
              onClick={() => {
                if (action() === "cancel") {
                  void props.onCancelProviderDownload?.("opencode");
                } else {
                  void props.onDownloadProvider?.("opencode");
                }
              }}
            >
              {props.t(PROVIDER_ACTION_TEXT[action()])}
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
            aria-label={props.t("provider.custom.installLabel")}
            disabled={props.disabled || props.refreshingProviders}
            onClick={() => void props.onInstallProvider?.("opencode")}
          >
            {props.t("provider.action.install")}
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
        options.find((option) => option.state === "available") ?? (allowUnavailableSelection ? options[0] : undefined);
      const input = first ? inputs.get(first.id) : undefined;
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
              aria-label={
                props.refreshingProviders ? props.t("provider.refreshingLabel") : props.t("provider.refreshLabel")
              }
              loading={props.refreshingProviders}
              loadingLabel={props.t("provider.refreshing")}
              disabled={props.disabled}
              onClick={() => void props.onRefreshProviders?.()}
            >
              <RefreshCw size={13} aria-hidden="true" />
              {props.t("provider.refresh")}
            </Button>
          </Show>
        </div>
      </Show>
      <div class="provider-picker-list">
        {/* Custom row joins the group once endpoints exist. */}
        <div role="radiogroup" aria-label={props.ariaLabel}>
          <For each={props.options} keyed={false}>
            {(option) => {
              const state = () => option().state;
              const runtimeStatus = () => option().runtimeStatus;
              const connecting = () => option().connectionState === "connecting";
              const available = () => state() === "available";
              const updatable = () => {
                const runtime = runtimeStatus();
                return runtime ? providerUpdateAvailable(runtime, option().availableVersion ?? null) : false;
              };
              const version = () => {
                const runtime = runtimeStatus();
                return runtime ? providerVersionLabel(runtime) : null;
              };
              const visualState = () => providerVisualState(state(), connecting(), runtimeStatus(), updatable());
              /**
               * A downloaded row that runs free models needs no sign-in, so its Connect is an option
               * rather than the step the row waits for: it stays outlined, and it opens the key
               * dialog when the caller has one. The caller starts the provider when it is chosen.
               */
              const connectOptional = () =>
                freeModelsReady(option()) &&
                providerRuntimeAction(state(), connecting(), runtimeStatus()) === "connect";
              const runtimeAction = () =>
                updatable() && props.onUpdateProvider && runtimeStatus()?.phase === "not-downloaded"
                  ? undefined
                  : providerRuntimeAction(state(), connecting(), runtimeStatus());
              /**
               * The row has a way in the user finishes elsewhere, and something to run it with.
               *
               * Offered while connected as well: that is how the user reaches a second account,
               * which is otherwise only possible by signing out first and hoping the new sign-in
               * works. A runtime still being downloaded has no CLI to ask for a code yet.
               */
              const codeSignInOffered = () =>
                Boolean(props.onSignInWithCodeProvider) &&
                agentProviderDescriptor(option().id).codeSignIn &&
                (runtimeStatus()?.phase ?? "ready") === "ready";
              /**
               * Every row with a runtime on the computer offers Update in the same place, so the user
               * looks for it in one menu. It is enabled only while a newer version waits; the badge
               * says so, and the menu names the version it installs.
               */
              const updateOffered = () =>
                Boolean(props.onUpdateProvider) && (runtimeStatus()?.phase === "ready" || updatable());
              const actionsMenu = () => codeSignInOffered() || updateOffered();
              const inputId = () => `${pickerId}-${option().id}`;
              return (
                <div
                  class={[
                    "provider-picker-option",
                    {
                      "provider-picker-option-selected": checkedProvider() === option().id,
                      "provider-picker-option-unavailable": !available(),
                      "provider-picker-option-runtime": Boolean(runtimeStatus()),
                      "provider-picker-option-selectable-unavailable":
                        !available() && Boolean(props.allowUnavailableSelection),
                      "provider-picker-option-with-callout": Boolean(option().callout),
                    },
                  ]}
                  title={option().message ?? undefined}
                >
                  <Show when={option().callout}>
                    {(callout) => (
                      <span class="provider-picker-callout" aria-hidden="true">
                        <span class="provider-picker-callout-title">{callout().title}</span>
                        <span class="provider-picker-callout-detail">{callout().detail}</span>
                        <svg class="provider-picker-callout-arrow" viewBox="0 0 92 40" fill="none" aria-hidden="true">
                          <circle cx="4" cy="6" r="3" fill="currentColor" />
                          <path d="M4 6C20 34 56 38 81 31" stroke="currentColor" stroke-width="1.6" />
                          <path d="M89 28.5L81.6 34.7L79.2 27Z" fill="currentColor" />
                        </svg>
                      </span>
                    )}
                  </Show>
                  <label for={inputId()} class="provider-picker-option-selection">
                    <Input
                      id={inputId()}
                      ref={(element) => inputs.set(option().id, element)}
                      type="radio"
                      name={props.ariaLabel}
                      value={option().id}
                      checked={checkedProvider() === option().id}
                      disabled={props.disabled || (!props.allowUnavailableSelection && !available())}
                      onChange={() => props.onChange(option().id)}
                    />
                    <ProviderLogo provider={option().id} class="provider-picker-logo" />
                    <span class="provider-picker-identity">
                      <span class="provider-picker-name">{option().name}</span>
                      <Show when={option().email ?? option().description}>
                        {(detail) => <small class="provider-picker-email">{detail()}</small>}
                      </Show>
                      <Show when={option().checkError}>
                        {(checkError) => <small class="provider-picker-check-error">{checkError()}</small>}
                      </Show>
                    </span>
                    {/* Version shares the badge column. */}
                    <span class="provider-picker-state">
                      <Show when={version()}>
                        {(installed) => <small class="provider-picker-version">{installed()}</small>}
                      </Show>
                      {/* Free-tier badge only beside runtime badge. */}
                      <Show
                        when={
                          option().id === "opencode" &&
                          (option().keyStatus === "missing" || option().keyStatus === "unreadable")
                        }
                      >
                        <Badge class="provider-picker-status provider-picker-key-status" tone="neutral" shape="pill">
                          {props.t("provider.key.free")}
                        </Badge>
                      </Show>
                      <Show when={runtimeStatus()?.phase !== "not-downloaded" || updatable()}>
                        <Badge
                          class={`provider-picker-status provider-picker-status-${visualState()}`}
                          tone={providerStatusTone(visualState())}
                          shape="pill"
                        >
                          {providerStatusLabel(props.t, state(), connecting(), runtimeStatus(), updatable())}
                        </Badge>
                      </Show>
                    </span>
                  </label>
                  {/* Actions share one grid cell; a sibling button would stretch its own row. */}
                  <div class="provider-picker-actions">
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
                          aria-label={props.t(PROVIDER_ACTION_LABEL[action()], { name: option().name })}
                          disabled={props.disabled || (props.refreshingProviders && !runtimeStoreAction(action()))}
                          onClick={() => {
                            if (action() === "cancel") {
                              void props.onCancelProviderDownload?.(option().id);
                            } else if (action() !== "download" && action() !== "retry") {
                              // Reconnect and an optional Connect open the key dialog; the rest stay on onConnectProvider.
                              if (
                                option().id === "opencode" &&
                                (action() === "reconnect" || connectOptional()) &&
                                props.onSignInProvider
                              ) {
                                void props.onSignInProvider(option().id);
                              } else {
                                void props.onConnectProvider?.(option().id);
                              }
                            } else {
                              void props.onDownloadProvider?.(option().id);
                            }
                          }}
                        >
                          {props.t(PROVIDER_ACTION_TEXT[action()])}
                        </Button>
                      )}
                    </Show>
                    <Show
                      when={
                        !runtimeStatus() &&
                        agentProviderDescriptor(option().id).installGuideLink !== null &&
                        state() === "not-installed" &&
                        !props.onConnectProvider &&
                        props.onInstallProvider
                      }
                    >
                      <Button
                        type="button"
                        variant="outline"
                        size="xs"
                        class="provider-picker-install"
                        aria-label={props.t("provider.aria.install", { name: option().name })}
                        disabled={props.disabled || props.refreshingProviders}
                        onClick={() => void props.onInstallProvider?.(option().id)}
                      >
                        {props.t("provider.action.install")}
                      </Button>
                    </Show>
                    <Show when={!runtimeStatus() && props.onConnectProvider}>
                      <Button
                        type="button"
                        variant={providerAction(state(), connecting()) === "connect" ? "default" : "outline"}
                        size="xs"
                        class={providerActionClass(providerAction(state(), connecting()))}
                        aria-label={props.t(PROVIDER_ACTION_LABEL[providerAction(state(), connecting())], {
                          name: option().name,
                        })}
                        aria-busy={connecting() ? "true" : undefined}
                        disabled={props.disabled || props.refreshingProviders}
                        onClick={() => void props.onConnectProvider?.(option().id)}
                      >
                        <Show when={connecting()}>
                          <Spinner size="sm" />
                        </Show>
                        {props.t(PROVIDER_ACTION_TEXT[providerAction(state(), connecting())])}
                      </Button>
                    </Show>
                    {/* Claude's sign-in is a browser round trip it only needs while signed out.
                      OpenCode reconnects through its runtime Reconnect, so Sign in stays only where
                      the row cannot offer it: with no runtime action at all, or a Connect or Restart
                      that retries the same credentials. A saved key that blocks startup must stay
                      replaceable and removable, so those actions never take the dialog away. */}
                    <Show
                      when={
                        props.onSignInProvider &&
                        !connectOptional() &&
                        (option().id === "opencode"
                          ? runtimeAction() === undefined ||
                            runtimeAction() === "connect" ||
                            runtimeAction() === "restart"
                          : option().id === "claude" &&
                            !runtimeStatus() &&
                            state() === "sign-in-required" &&
                            !props.onConnectProvider)
                      }
                    >
                      <Button
                        type="button"
                        variant="outline"
                        size="xs"
                        class="provider-picker-install"
                        aria-label={props.t("provider.aria.signIn", { name: option().name })}
                        disabled={props.disabled || props.refreshingProviders}
                        onClick={() => void props.onSignInProvider?.(option().id)}
                      >
                        {props.t("provider.action.signIn")}
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
                          aria-label={props.t("provider.aria.moreActions", { name: option().name })}
                          disabled={props.disabled || props.refreshingProviders}
                        >
                          <Ellipsis aria-hidden="true" />
                        </DropdownMenu.Trigger>
                        <DropdownMenu.Portal mount={props.menuMount}>
                          <DropdownMenu.Content>
                            <Show when={updateOffered()}>
                              <DropdownMenu.Item
                                disabled={!updatable() || connecting()}
                                onSelect={() => void props.onUpdateProvider?.(option().id)}
                              >
                                <RefreshCw aria-hidden="true" />
                                {updatable()
                                  ? props.t("provider.action.updateTo", { version: option().availableVersion ?? "" })
                                  : props.t("provider.action.upToDate")}
                              </DropdownMenu.Item>
                            </Show>
                            <Show when={codeSignInOffered()}>
                              <DropdownMenu.Item onSelect={() => void props.onSignInWithCodeProvider?.(option().id)}>
                                <Smartphone aria-hidden="true" />
                                {props.t("provider.action.signInWithCode")}
                              </DropdownMenu.Item>
                            </Show>
                          </DropdownMenu.Content>
                        </DropdownMenu.Portal>
                      </DropdownMenu.Root>
                    </Show>
                  </div>
                </div>
              );
            }}
          </For>
          <Show when={customSelectable() ? openCode() : undefined}>{(engine) => customRow(engine)}</Show>
        </div>
        <Show when={!customSelectable() && props.onAddCustomProvider ? openCode() : undefined}>
          {(engine) => customRow(engine)}
        </Show>
      </div>
      <Show when={props.hint}>{(hint) => <p class="provider-picker-hint">{hint()}</p>}</Show>
    </div>
  );
}

/** OpenCode runs user endpoints when its CLI is installed and answers; sign-in is irrelevant. */
function servesCustomProvider(openCode: ProviderPickerOption | undefined): boolean {
  return openCode?.state === "available" || openCode?.state === "sign-in-required";
}

type ProviderVisualState = AgentProviderState | ProviderRuntimePhase | "connecting" | "update-available";

function providerStatusTone(state: ProviderVisualState): "success" | "warning" | "danger" | "neutral" {
  if (state === "available") return "success";
  if (state === "ready") return "success";
  if (state === "error" || state === "download-error") return "danger";
  if (state === "sign-in-required" || state === "outdated" || state === "finishing") return "warning";
  if (state === "update-available") return "warning";
  return "neutral";
}

/** Badge text, translated where drawn; downloads report a percentage, not a key. */
function providerStatusLabel(
  translate: AppTranslate,
  state: AgentProviderState,
  connecting = false,
  runtimeStatus?: ProviderRuntimeStatus,
  updatable = false,
): string {
  // Downloads outrank connection words; the row reports progress until it ends.
  if (runtimeStatus?.phase === "downloading") {
    return `${Math.round(Math.max(0, Math.min(100, runtimeStatus.progress ?? 0)))}%`;
  }
  if (runtimeStatus?.phase === "finishing") return translate("provider.status.settingUp");
  if (connecting && state !== "available") return translate("provider.status.connecting");
  // Update offers outrank "Connected"/"Ready": a hidden offer is never taken.
  if (updatable) return translate("provider.status.updateAvailable");
  if (runtimeStatus?.phase === "download-error") return translate("provider.status.downloadFailed");
  if (state === "available") return translate("provider.status.connected");
  if (runtimeStatus?.phase === "not-downloaded") return translate("provider.status.notDownloaded");
  if (runtimeStatus?.phase === "ready") return translate("provider.status.ready");
  if (state === "sign-in-required") return translate("provider.status.notConnected");
  if (state === "not-installed") return translate("provider.status.notInstalled");
  if (state === "outdated") return translate("provider.status.updateRequired");
  if (state === "error") return translate("provider.status.unavailable");
  return translate("provider.status.checking");
}

function providerVisualState(
  state: AgentProviderState,
  connecting: boolean,
  runtimeStatus?: ProviderRuntimeStatus,
  updatable = false,
): ProviderVisualState {
  const phase = runtimeStatus?.phase;
  // Same order as the label above.
  if (phase === "downloading" || phase === "finishing") return phase;
  if (connecting && state !== "available") return "connecting";
  if (updatable) return "update-available";
  if (phase === "download-error") return phase;
  if (state === "available") return "available";
  return phase ?? state;
}

/** Row action identifier; never a translated label, since the handler branches on it. */
type ProviderAction = "download" | "cancel" | "connect" | "reconnect" | "restart" | "retry";

const PROVIDER_ACTION_TEXT = {
  download: "provider.action.download",
  cancel: "provider.action.cancel",
  connect: "provider.action.connect",
  reconnect: "provider.action.reconnect",
  restart: "provider.action.restart",
  retry: "provider.action.retry",
} as const satisfies Record<ProviderAction, AppTextKey>;

/** The name a screen reader reads. It repeats the provider, because a list of rows that all say
 * "Connect" names nothing. */
const PROVIDER_ACTION_LABEL = {
  download: "provider.aria.download",
  cancel: "provider.aria.cancel",
  connect: "provider.aria.connect",
  reconnect: "provider.aria.reconnect",
  restart: "provider.aria.restart",
  retry: "provider.aria.retry",
} as const satisfies Record<ProviderAction, keyof AppMessages>;

/**
 * Connect is the step a row is waiting for, so it takes the accent colour. An outlined Connect read
 * as a disabled button beside a "Ready" badge (issue #643). Reconnect and Restart repeat a step
 * already done, so they stay outlined.
 */
function providerActionClass(action: ProviderAction) {
  return action === "connect" ? "provider-picker-install provider-picker-connect" : "provider-picker-install";
}

/**
 * Whether a free-models row can be used without Connect: its runtime is on disk and nothing reports
 * it broken. The provider state can still say signed out or unchecked, because free models need no
 * sign-in and the first connection only asks the CLI for its models. An error or an outdated CLI
 * keeps Connect, which is how the user retries.
 */
export function freeModelsReady(option: ProviderPickerOption): boolean {
  if (!option.freeModels || option.state === "error" || option.state === "outdated") return false;
  return option.runtimeStatus?.phase === "ready";
}

/**
 * Whether the action reaches main's managed runtime store rather than a provider CLI.
 *
 * A download, its cancellation and its retry are file transfers the runtime manager owns; it neither
 * asks the agent runtime for anything nor waits for it. The rest put a question to a CLI, so they
 * wait while the providers are being checked. Keeping the two apart is what stops a provider check
 * that never ends from disabling the one action that would end it: with nothing downloaded, every
 * other button on the first-run screen is refused by design, and disabling Download as well leaves
 * the user with no way forward at all.
 */
function runtimeStoreAction(action: ProviderAction): boolean {
  return action === "download" || action === "cancel" || action === "retry";
}

function providerRuntimeAction(
  state: AgentProviderState,
  connecting: boolean,
  runtimeStatus?: ProviderRuntimeStatus,
): ProviderAction | undefined {
  if (!runtimeStatus) return;
  if (runtimeStatus.phase === "not-downloaded") return "download";
  if (runtimeStatus.phase === "downloading") return "cancel";
  if (runtimeStatus.phase === "ready") return providerAction(state, connecting);
  if (runtimeStatus.phase === "download-error") return "retry";
}

function providerAction(state: AgentProviderState, connecting: boolean): ProviderAction {
  if (connecting) return "restart";
  return state === "available" ? "reconnect" : "connect";
}
