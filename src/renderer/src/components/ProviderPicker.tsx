import { ProviderLogo } from "@openbot/brand";
import { agentProviderDescriptor } from "@openbot/contracts/agent-providers";
import type {
  AgentProviderId,
  AgentProviderState,
  CustomProviderSummary,
  ProviderRuntimePhase,
  ProviderRuntimeStatus,
} from "@openbot/contracts/ipc";
import { createEffect, createUniqueId, For, Show } from "solid-js";
import { providerUpdateAvailable, providerVersionLabel } from "../features/provider-updates/provider-update";
import { Badge, Button, Input, RefreshCw, SlidersHorizontal, Spinner } from "./ui";

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
  /** The newer runtime main says exists. The renderer never works this out itself. */
  availableVersion?: string | null;
}

export interface ProviderPickerProps {
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
  onRefreshProviders?: () => void | Promise<void>;
  /**
   * Opens the custom-provider form from the last row of the list. That row can add only while
   * OpenCode can run an endpoint. Until then it offers OpenCode's install through
   * `onInstallProvider`.
   */
  onAddCustomProvider?: () => void;
  /**
   * The endpoints the user has already named. They share the one Custom provider row, which counts
   * them in a chip: one OpenCode process runs them all, and which endpoint an agent uses is a model
   * choice, not a provider choice.
   */
  customProviders?: readonly CustomProviderSummary[];
  /**
   * Whether the Custom provider row holds the check. While it does, no provider row is checked: the
   * user picked their own endpoints, and the caller keeps `value` on the provider that serves them.
   * The row becomes a choice only with `onSelectCustomProvider` and at least one endpoint, because
   * a choice nobody can take is not a choice.
   */
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
  const endpointCountLabel = () => (endpointCount() === 1 ? "1 endpoint" : `${endpointCount()} endpoints`);
  /** The count answers a click only where the list can be opened. Elsewhere it stays a badge. */
  const countManageable = () => endpointCount() > 0 && Boolean(props.onManageCustomProviders);
  /** The row is a choice once it has something to run and someone to tell about the choice. */
  const customSelectable = () => Boolean(props.onSelectCustomProvider) && endpointCount() > 0;
  /** The Custom provider row holds the check mark, so the provider row that serves it does not. */
  const checkedProvider = () => (customSelectable() && props.customSelected ? null : props.value);
  let focused = false;

  /**
   * The one row every named endpoint shares. It is mounted inside the group of choices while it is
   * a choice, and after the group while it only adds, so the group never holds a row nobody can
   * choose. One definition serves both places.
   */
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
      {/* With endpoints to choose the label points at the radio, as its neighbours' labels do.
          With none it points at the Add button, so a click anywhere on the row still answers. */}
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
          <span class="provider-picker-name">Custom provider</span>
          <small class="provider-picker-email">Your own model endpoint</small>
        </span>
        <span class="provider-picker-state">
          {/* How many endpoints the row stands for. The row never names them: which one an agent
              uses is a model choice, and the model picker makes it. The count moves out of the
              label, beside Add, wherever it opens the list. */}
          <Show when={endpointCount() > 0 && !countManageable()}>
            <Badge class="provider-picker-custom-count" tone="neutral" shape="pill">
              {endpointCountLabel()}
            </Badge>
          </Show>
          {/* The row reports OpenCode's state in the words the OpenCode row uses, without naming
              OpenCode: to the user this is a provider of its own. */}
          <Show when={!customReady()}>
            <Badge
              class={`provider-picker-status provider-picker-status-${engine().state}`}
              tone={providerStatusTone(engine().state)}
              shape="pill"
            >
              {providerStatusLabel(engine().state)}
            </Badge>
          </Show>
        </span>
      </label>
      <div class="provider-picker-actions">
        {/* The count reads as what it does here: it opens the saved endpoints, where they are
            removed. Its name says so, because "2 endpoints" alone reads as a state, not an action. */}
        <Show when={countManageable()}>
          <Button
            type="button"
            variant="ghost"
            size="xs"
            class="provider-picker-custom-count"
            aria-label={`Manage ${endpointCountLabel()}`}
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
            aria-label="Add custom provider"
            disabled={props.disabled || props.refreshingProviders}
            onClick={() => props.onAddCustomProvider?.()}
          >
            Add
          </Button>
        </Show>
        {/* The same install the OpenCode row offers, and only when that row offers it. */}
        <Show
          when={
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
            aria-label="Install custom provider"
            disabled={props.disabled || props.refreshingProviders}
            onClick={() => void props.onInstallProvider?.("opencode")}
          >
            Install
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
              aria-label={props.refreshingProviders ? "Checking providers" : "Refresh providers"}
              loading={props.refreshingProviders}
              loadingLabel="Checking…"
              disabled={props.disabled}
              onClick={() => void props.onRefreshProviders?.()}
            >
              <RefreshCw size={13} aria-hidden="true" />
              Refresh
            </Button>
          </Show>
        </div>
      </Show>
      <div class="provider-picker-list">
        {/* The group holds the choices alone, so the Custom provider row joins it once endpoints
            exist and stays after it while it can only add. */}
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
              const runtimeAction = () =>
                updatable() && props.onUpdateProvider && runtimeStatus()?.phase === "not-downloaded"
                  ? undefined
                  : providerRuntimeAction(state(), connecting(), runtimeStatus());
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
                    },
                  ]}
                  title={option().message ?? undefined}
                >
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
                    {/* The version reads with the badge rather than with the name: which runtime is
                      installed is a fact about its state, and the two share the row's last column so
                      that neither starts a column of its own. */}
                    <span class="provider-picker-state">
                      <Show when={version()}>
                        {(installed) => <small class="provider-picker-version">{installed()}</small>}
                      </Show>
                      <Show when={runtimeStatus()?.phase !== "not-downloaded" || updatable()}>
                        <Badge
                          class={`provider-picker-status provider-picker-status-${visualState()}`}
                          tone={providerStatusTone(visualState())}
                          shape="pill"
                        >
                          {providerStatusLabel(state(), connecting(), runtimeStatus(), updatable())}
                        </Badge>
                      </Show>
                    </span>
                  </label>
                  {/* The row is a two-column grid, so every action shares one cell. A second button
                    left as a sibling starts a grid row of its own and stretches across it. */}
                  <div class="provider-picker-actions">
                    <Show when={runtimeAction()}>
                      {(action) => (
                        <Button
                          type="button"
                          variant={action() === "Download" ? "default" : "outline"}
                          size="xs"
                          class="provider-picker-install"
                          aria-label={`${action()} ${option().name}`}
                          disabled={props.disabled || props.refreshingProviders}
                          onClick={() => {
                            if (action() === "Cancel") {
                              void props.onCancelProviderDownload?.(option().id);
                            } else if (["Connect", "Reconnect", "Restart"].includes(action())) {
                              void props.onConnectProvider?.(option().id);
                            } else {
                              void props.onDownloadProvider?.(option().id);
                            }
                          }}
                        >
                          {action()}
                        </Button>
                      )}
                    </Show>
                    {/* Beside the runtime action, never instead of it: an offered update must not take
                    Connect or Reconnect away from a provider that is ready to use as it is. It sits
                    last so the emphasized action is the one at the edge of the row. */}
                    <Show when={updatable() && props.onUpdateProvider}>
                      <Button
                        type="button"
                        variant="default"
                        size="xs"
                        class="provider-picker-install"
                        aria-label={`Update ${option().name} to ${option().availableVersion}`}
                        disabled={props.disabled || props.refreshingProviders || connecting()}
                        onClick={() => void props.onUpdateProvider?.(option().id)}
                      >
                        Update
                      </Button>
                    </Show>
                    <Show
                      when={
                        !runtimeStatus() &&
                        agentProviderDescriptor(option().id).installGuideLink !== null &&
                        state() === "not-installed" &&
                        (option().id === "opencode" || !props.onConnectProvider) &&
                        props.onInstallProvider
                      }
                    >
                      <Button
                        type="button"
                        variant="outline"
                        size="xs"
                        class="provider-picker-install"
                        aria-label={`Install ${option().name}`}
                        disabled={props.disabled || props.refreshingProviders}
                        onClick={() => void props.onInstallProvider?.(option().id)}
                      >
                        Install
                      </Button>
                    </Show>
                    <Show when={!runtimeStatus() && props.onConnectProvider}>
                      <Button
                        type="button"
                        variant="outline"
                        size="xs"
                        class="provider-picker-install"
                        aria-label={`${providerActionLabel(state(), connecting())} ${option().name}`}
                        aria-busy={connecting() ? "true" : undefined}
                        disabled={props.disabled || props.refreshingProviders}
                        onClick={() => void props.onConnectProvider?.(option().id)}
                      >
                        <Show when={connecting()}>
                          <Spinner size="sm" />
                        </Show>
                        {providerActionLabel(state(), connecting())}
                      </Button>
                    </Show>
                    <Show
                      when={
                        !runtimeStatus() &&
                        option().id === "claude" &&
                        state() === "sign-in-required" &&
                        !props.onConnectProvider &&
                        props.onSignInProvider
                      }
                    >
                      <Button
                        type="button"
                        variant="outline"
                        size="xs"
                        class="provider-picker-install"
                        aria-label={`Sign in to ${option().name}`}
                        disabled={props.disabled || props.refreshingProviders}
                        onClick={() => void props.onSignInProvider?.(option().id)}
                      >
                        Sign in
                      </Button>
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

/**
 * Whether OpenCode can run an endpoint the user describes. Its CLI must be installed and answer;
 * its own sign-in does not matter, because the endpoint brings its own key. A user with no OpenCode
 * account and a local model is the case a custom provider exists for.
 */
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

function providerStatusLabel(
  state: AgentProviderState,
  connecting = false,
  runtimeStatus?: ProviderRuntimeStatus,
  updatable = false,
): string {
  if (connecting && state !== "available") return "Connecting";
  // Ahead of both "Connected" and "Ready": an offer the row does not show is an
  // offer the user never sees, and "ready" is the phase every update starts from.
  if (updatable) return "Update available";
  // A download outranks "Connected": an update runs on a provider that is connected already, so
  // reporting the connection instead would hide both the progress the Cancel button reverses and
  // the failure the Retry button beside it answers.
  if (runtimeStatus?.phase === "downloading") {
    return `${Math.round(Math.max(0, Math.min(100, runtimeStatus.progress ?? 0)))}%`;
  }
  if (runtimeStatus?.phase === "finishing") return "Setting up";
  if (runtimeStatus?.phase === "download-error") return "Download failed";
  if (state === "available") return "Connected";
  if (runtimeStatus?.phase === "not-downloaded") return "Not downloaded";
  if (runtimeStatus?.phase === "ready") return "Ready";
  if (state === "sign-in-required") return "Not connected";
  if (state === "not-installed") return "Not installed";
  if (state === "outdated") return "Update required";
  if (state === "error") return "Unavailable";
  return "Checking";
}

function providerVisualState(
  state: AgentProviderState,
  connecting: boolean,
  runtimeStatus?: ProviderRuntimeStatus,
  updatable = false,
): ProviderVisualState {
  if (connecting && state !== "available") return "connecting";
  if (updatable) return "update-available";
  const phase = runtimeStatus?.phase;
  if (phase === "downloading" || phase === "finishing" || phase === "download-error") return phase;
  if (state === "available") return "available";
  return phase ?? state;
}

function providerRuntimeAction(
  state: AgentProviderState,
  connecting: boolean,
  runtimeStatus?: ProviderRuntimeStatus,
): "Download" | "Cancel" | "Connect" | "Reconnect" | "Restart" | "Retry" | undefined {
  if (!runtimeStatus) return;
  if (runtimeStatus.phase === "not-downloaded") return "Download";
  if (runtimeStatus.phase === "downloading") return "Cancel";
  if (runtimeStatus.phase === "ready") return providerActionLabel(state, connecting);
  if (runtimeStatus.phase === "download-error") return "Retry";
}

function providerActionLabel(state: AgentProviderState, connecting: boolean): "Connect" | "Reconnect" | "Restart" {
  if (connecting) return "Restart";
  return state === "available" ? "Reconnect" : "Connect";
}
