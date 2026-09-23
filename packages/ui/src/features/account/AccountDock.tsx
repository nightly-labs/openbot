import type {
  AccountUsage,
  AgentProviderId,
  AgentStatus,
  AppInfo,
  CentralAuthUser,
  ExternalDestination,
  UpdateStatus,
} from "@openbot/contracts/ipc";
import {
  Badge,
  Button,
  buttonVariants,
  ChevronUp,
  CircleArrowDown,
  Gauge,
  LogOut,
  Mail,
  Megaphone,
  Popover,
  Puzzle,
  Settings,
  ShieldCheck,
  Tooltip,
  UserAvatar,
} from "@openbot/ui";
import { createEffect, createMemo, createSignal, For, onCleanup, Show } from "solid-js";
import { TypingDots } from "../../components/TypingDots";
import { errorMessage } from "../../error-message";
import { presentUpdateStatus } from "../updates/update-status";
import { AccountUpdateIsland } from "./AccountUpdateIsland";
import { AccountUsageDetails } from "./AccountUsageDetails";
import { accountUsageProviderRows, accountUsageSummary } from "./account-usage-view";

interface AccountDockProps {
  remoteClient?: boolean;
  account: CentralAuthUser;
  appInfo: AppInfo | null;
  agentStatus: AgentStatus;
  accountUsage: AccountUsage | null;
  /** The active agent's provider. The chip shows only its quota; null shows the lowest one. */
  usageProvider?: AgentProviderId | null;
  usageTargetKey: string | null;
  usageRefreshRevision: number;
  usageReady: boolean;
  updateStatus: UpdateStatus;
  compact: boolean;
  withServerRail: boolean;
  onRefreshUsage: () => Promise<AccountUsage>;
  onUpdateAction: () => Promise<void>;
  onLogout?: () => Promise<void>;
  onOpenExternal: (destination: ExternalDestination) => Promise<void>;
  onOpenPermissions: () => void;
  onOpenSettings: (trigger: HTMLElement) => void;
  onOpenSkills: () => void;
}

const USAGE_REFRESH_TIMEOUT_MS = 12_000;
/** How old a reading may get while it is on screen before it is fetched again. */
const USAGE_AUTO_REFRESH_MS = 5 * 60_000;
/**
 * The poll asks more often than it refreshes, and each tick compares the age of
 * the reading. A tick right after a manual refresh then costs nothing, instead of
 * pushing the next automatic one out to almost ten minutes.
 */
const USAGE_AUTO_REFRESH_CHECK_MS = 30_000;

function AnimatedUsagePercentage(props: { value: number | null }) {
  let digitGroup: HTMLSpanElement | undefined;
  const characters = () => (props.value === null ? ["—"] : `${props.value}%`.split(""));

  createEffect(
    () => props.value,
    (value) => {
      if (value === null || !digitGroup) return;

      digitGroup.classList.remove("is-animating");
      void digitGroup.offsetHeight;
      digitGroup.classList.add("is-animating");
    },
  );

  return (
    <span ref={digitGroup} class="t-digit-group" aria-hidden="true">
      <For each={characters()}>
        {(character, index) => {
          const stagger = () => {
            if (index() === characters().length - 2) return "1";
            if (index() === characters().length - 1) return "2";
            return undefined;
          };
          return (
            <span class="t-digit" data-stagger={stagger()}>
              {character}
            </span>
          );
        }}
      </For>
    </span>
  );
}

export function AccountDock(props: AccountDockProps) {
  const [menuOpen, setMenuOpen] = createSignal(false);
  const [usageOpen, setUsageOpen] = createSignal(false);
  const [usageTooltipOpen, setUsageTooltipOpen] = createSignal(false);
  const [usageLoading, setUsageLoading] = createSignal(false);
  const [usageRefreshAcknowledging, setUsageRefreshAcknowledging] = createSignal(false);
  const [usageError, setUsageError] = createSignal<string | null>(null);
  const [menuError, setMenuError] = createSignal<string | null>(null);
  const [updateError, setUpdateError] = createSignal<string | null>(null);
  const [loggingOut, setLoggingOut] = createSignal(false);
  let usageRefreshTimer: number | undefined;
  let usageWatchdog: number | undefined;
  let usageRequestGeneration = 0;
  let usageRequestTargetKey: string | null = null;
  let usageRequestRevision = -1;
  let lastUsageRefreshAt = 0;
  let legacyTrigger: HTMLButtonElement | undefined;
  let menuTrigger: HTMLButtonElement | undefined;
  let usageTrigger: HTMLButtonElement | undefined;
  let settingsTrigger: HTMLButtonElement | undefined;

  const hybridLayout = createMemo(() => props.appInfo?.platform === "darwin" && props.withServerRail && !props.compact);
  const accountName = createMemo(
    () => props.account.name?.trim() || props.account.email.split("@")[0] || props.account.email,
  );
  const usageRows = createMemo(() => accountUsageProviderRows(props.accountUsage, props.agentStatus.providers));
  const usageSummary = createMemo(() => accountUsageSummary(usageRows(), props.usageProvider));
  const usageRemaining = createMemo(() => usageSummary()?.remainingPercent ?? null);
  const usageTone = createMemo(() => usageSummary()?.tone ?? "neutral");
  const usageButtonLabel = createMemo(() => {
    const summary = usageSummary();
    if (usageLoading() && summary === null) return "Usage is loading";
    if (summary === null || summary.remainingPercent === null) return "Usage unavailable";
    return `Usage, ${summary.name} ${summary.remainingPercent}% left`;
  });
  const usageRefreshActive = createMemo(() => usageLoading() || usageRefreshAcknowledging());
  const usageRefreshDisabled = createMemo(() => usageRefreshActive() || !props.usageReady || !props.usageTargetKey);
  const updatePresentation = createMemo(() => presentUpdateStatus(props.updateStatus));
  const accountMenuError = createMemo(
    () =>
      menuError() ??
      updateError() ??
      (props.updateStatus.phase === "error"
        ? errorMessage(props.updateStatus.message, "Could not update OpenBot. Try again.")
        : null),
  );

  onCleanup(() => {
    if (usageRefreshTimer !== undefined) window.clearTimeout(usageRefreshTimer);
    if (usageWatchdog !== undefined) window.clearTimeout(usageWatchdog);
  });

  createEffect(
    () =>
      [
        props.usageTargetKey ?? "",
        props.usageReady ? "1" : "0",
        hybridLayout() ? "1" : "0",
        menuOpen() ? "1" : "0",
        usageOpen() ? "1" : "0",
      ].join("|"),
    (key) => {
      const [targetKeyRaw, readyRaw, hybridRaw, menuRaw, usageRaw] = key.split("|");
      const targetKey = targetKeyRaw || null;
      const ready = readyRaw === "1";
      const hybrid = hybridRaw === "1";
      const menu = menuRaw === "1";
      const usage = usageRaw === "1";
      if (!targetKey) {
        usageRequestGeneration += 1;
        usageRequestTargetKey = null;
        usageRequestRevision = -1;
        setUsageLoading(false);
        setUsageError(null);
        return;
      }
      if (!ready) return;
      if (!hybrid && !menu && !usage) return;
      if (usageRequestTargetKey === targetKey) return;
      void refreshUsage();
    },
  );

  /**
   * The figure ages: it counts down a provider's window, so a number read minutes
   * after it arrived is wrong. This polls while the reading is on screen - the
   * hybrid chip always shows it, and either popover shows the rows - and stays
   * quiet otherwise, because a background refresh the user cannot see only costs
   * a provider call. A hidden window does not poll either; coming back to it
   * refreshes at once when the interval has passed.
   */
  const usagePollingActive = createMemo(
    () => Boolean(props.usageTargetKey) && props.usageReady && (hybridLayout() || menuOpen() || usageOpen()),
  );

  createEffect(usagePollingActive, (active) => {
    if (!active) return;
    function refreshWhenDue() {
      if (document.hidden || usageLoading()) return;
      if (Date.now() - lastUsageRefreshAt < USAGE_AUTO_REFRESH_MS) return;
      void refreshUsage();
    }
    refreshWhenDue();
    const timer = window.setInterval(refreshWhenDue, USAGE_AUTO_REFRESH_CHECK_MS);
    document.addEventListener("visibilitychange", refreshWhenDue);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refreshWhenDue);
    };
  });

  createEffect(
    () => props.updateStatus.phase,
    () => {
      setUpdateError(null);
    },
  );

  function restoreFocusWhenDockIsIdle(target: HTMLButtonElement | undefined) {
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        if (target?.isConnected && !menuOpen() && !usageOpen() && document.activeElement === document.body) {
          target.focus();
        }
      });
    });
  }

  async function refreshUsage() {
    const targetKey = props.usageTargetKey;
    const revision = props.usageRefreshRevision;
    if (
      !targetKey ||
      !props.usageReady ||
      (usageLoading() && usageRequestTargetKey === targetKey && usageRequestRevision === revision)
    )
      return;
    const generation = ++usageRequestGeneration;
    lastUsageRefreshAt = Date.now();
    usageRequestTargetKey = targetKey;
    usageRequestRevision = revision;
    setUsageLoading(true);
    setUsageError(null);
    if (usageWatchdog !== undefined) window.clearTimeout(usageWatchdog);
    usageWatchdog = window.setTimeout(() => {
      if (generation !== usageRequestGeneration) return;
      setUsageLoading(false);
      setUsageError("Usage is unavailable.");
    }, USAGE_REFRESH_TIMEOUT_MS);
    try {
      await props.onRefreshUsage();
    } catch (cause) {
      if (generation === usageRequestGeneration && props.usageTargetKey === targetKey) {
        setUsageError(errorMessage(cause, "Usage is unavailable."));
      }
    } finally {
      if (usageWatchdog !== undefined) {
        window.clearTimeout(usageWatchdog);
        usageWatchdog = undefined;
      }
      if (generation === usageRequestGeneration && props.usageTargetKey === targetKey) {
        setUsageLoading(false);
      }
    }
  }

  function refreshUsageWithFeedback() {
    if (usageRefreshDisabled()) return;
    setUsageRefreshAcknowledging(true);
    if (usageRefreshTimer !== undefined) window.clearTimeout(usageRefreshTimer);
    usageRefreshTimer = window.setTimeout(() => {
      usageRefreshTimer = undefined;
      setUsageRefreshAcknowledging(false);
    }, 600);
    void refreshUsage();
  }

  function openExternal(destination: ExternalDestination) {
    setMenuError(null);
    void props
      .onOpenExternal(destination)
      .then(() => setMenuOpen(false))
      .catch((cause) => setMenuError(errorMessage(cause, "Could not open the link.")));
  }

  async function runUpdateAction(): Promise<void> {
    setMenuError(null);
    setUpdateError(null);
    try {
      await props.onUpdateAction();
    } catch (cause) {
      setUpdateError(errorMessage(cause, "Could not update OpenBot."));
    }
  }

  async function logout() {
    const onLogout = props.onLogout;
    if (!onLogout || loggingOut()) return;
    setLoggingOut(true);
    setMenuError(null);
    try {
      await onLogout();
    } catch (cause) {
      setMenuError(errorMessage(cause, "Could not sign out."));
      setLoggingOut(false);
    }
  }

  function avatar(className: string) {
    return <UserAvatar user={props.account} class={className} decorative />;
  }

  function accountMenu(includeDockActions = false) {
    return (
      <>
        <Show when={includeDockActions && !props.remoteClient}>
          <AccountUsageDetails
            rows={usageRows()}
            loading={usageLoading()}
            error={usageError()}
            refreshActive={usageRefreshActive()}
            refreshDisabled={usageRefreshDisabled()}
            onRefresh={refreshUsageWithFeedback}
            title={<h2 class="account-usage-popover-title">Usage</h2>}
          />
          <div class="account-menu-separator" />
          <section class="account-menu-group" aria-label="Account">
            <Button
              variant="ghost"
              type="button"
              class="account-menu-row"
              onClick={() => {
                setMenuOpen(false);
                if (legacyTrigger) props.onOpenSettings(legacyTrigger);
              }}
            >
              <Settings class="account-menu-icon" aria-hidden="true" />
              <span>Settings</span>
            </Button>
          </section>
          <div class="account-menu-separator" />
        </Show>
        <Show when={!props.remoteClient}>
          <section class="account-menu-group" aria-label="OpenBot">
            <Show
              when={props.updateStatus.phase !== "unsupported" && (!hybridLayout() || !updatePresentation().available)}
            >
              <Button
                variant="ghost"
                type="button"
                class="account-menu-row"
                onClick={() => void runUpdateAction()}
                disabled={updatePresentation().busy || updatePresentation().managed}
              >
                <CircleArrowDown
                  class={
                    updatePresentation().busy ? "account-menu-icon account-menu-icon-spinning" : "account-menu-icon"
                  }
                  aria-hidden="true"
                />
                <span>{updatePresentation().actionLabel}</span>
                <small>{updatePresentation().detail}</small>
              </Button>
            </Show>
            <Button
              variant="ghost"
              type="button"
              class="account-menu-row"
              onClick={() => {
                setMenuOpen(false);
                props.onOpenSkills();
              }}
            >
              <Puzzle class="account-menu-icon" aria-hidden="true" />
              <span>Marketplace</span>
            </Button>
            <Button
              variant="ghost"
              type="button"
              class="account-menu-row"
              onClick={() => {
                setMenuOpen(false);
                props.onOpenPermissions();
              }}
            >
              <ShieldCheck class="account-menu-icon" aria-hidden="true" />
              <span>Providers &amp; permissions</span>
            </Button>
          </section>

          <div class="account-menu-separator" />
          <section class="account-menu-group" aria-label="Help">
            <Button variant="ghost" type="button" class="account-menu-row" onClick={() => openExternal("feedback")}>
              <Megaphone class="account-menu-icon" aria-hidden="true" />
              <span>Send feedback</span>
            </Button>
            <Button variant="ghost" type="button" class="account-menu-row" onClick={() => openExternal("message")}>
              <Mail class="account-menu-icon" aria-hidden="true" />
              <span>Message</span>
            </Button>
          </section>
        </Show>
        <Show when={props.onLogout}>
          <div class="account-menu-separator" />
          <Button
            variant="ghost"
            type="button"
            class="account-menu-row account-menu-danger"
            onClick={() => void logout()}
            disabled={loggingOut()}
          >
            <LogOut class="account-menu-icon" aria-hidden="true" />
            <span>{loggingOut() ? "Signing out…" : "Sign out"}</span>
          </Button>
        </Show>
        <Show when={accountMenuError()}>
          {(message) => (
            // An update or sign-out failure appears while the menu is already open, so it needs to
            // be announced rather than only drawn under the action the user just pressed.
            <p class="account-popover-error" role="alert">
              {message()}
            </p>
          )}
        </Show>
      </>
    );
  }

  function legacyDock() {
    return (
      <Popover.Root
        open={menuOpen()}
        onOpenChange={(nextOpen) => {
          setMenuOpen(nextOpen);
          if (nextOpen) {
            setMenuError(null);
            if (!props.accountUsage && !usageLoading()) void refreshUsage();
          } else {
            restoreFocusWhenDockIsIdle(legacyTrigger);
          }
        }}
        placement="top-start"
        gutter={8}
      >
        <Popover.Trigger
          ref={(element) => (legacyTrigger = element)}
          as="button"
          type="button"
          class={buttonVariants({ variant: "ghost", class: "account-dock-trigger" })}
          aria-label="Open account menu"
          aria-expanded={menuOpen() ? "true" : "false"}
        >
          {avatar("account-dock-avatar")}
          <span class="account-dock-copy">
            <strong title={accountName()}>{accountName()}</strong>
            <span title={props.account.email}>{props.account.email}</span>
            <Show when={!props.remoteClient && props.appInfo}>
              {(info) => (
                <span class="sr-only" data-testid="app-version">
                  Version {info().version} · {info().platform}
                </span>
              )}
            </Show>
          </span>
          <Show when={updatePresentation().available}>
            <Badge class="sidebar-update-pill" variant="new">
              Update
            </Badge>
            <span class="sr-only">OpenBot update available</span>
          </Show>
          <ChevronUp class="account-dock-chevron" aria-hidden="true" />
        </Popover.Trigger>

        <Popover.Portal>
          <Popover.Content
            class="ui-popover-menu-surface account-popover"
            aria-hidden={menuOpen() ? undefined : "true"}
          >
            <Popover.Title class="sr-only">Account actions</Popover.Title>
            {accountMenu(true)}
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
    );
  }

  function hybridDock() {
    return (
      <div class="account-dock-hybrid-shelf">
        <Popover.Root
          open={menuOpen()}
          onOpenChange={(nextOpen) => {
            setMenuOpen(nextOpen);
            if (nextOpen) {
              setUsageOpen(false);
              setMenuError(null);
            } else {
              restoreFocusWhenDockIsIdle(menuTrigger);
            }
          }}
          placement="top-start"
          gutter={10}
        >
          <Popover.Trigger
            ref={(element) => (menuTrigger = element)}
            as="button"
            type="button"
            class={buttonVariants({ variant: "ghost", class: "account-dock-hybrid-identity" })}
            aria-label="Open account actions"
            aria-expanded={menuOpen() ? "true" : "false"}
          >
            <span class="account-dock-avatar-frame">{avatar("account-dock-avatar")}</span>
            <span class="account-dock-copy">
              <strong title={accountName()}>{accountName()}</strong>
              <span title={props.account.email}>{props.account.email}</span>
              <Show when={!props.remoteClient && props.appInfo}>
                {(info) => (
                  <span class="sr-only" data-testid="app-version">
                    Version {info().version} · {info().platform}
                  </span>
                )}
              </Show>
            </span>
          </Popover.Trigger>
          <Popover.Portal>
            <Popover.Content
              class="ui-popover-menu-surface account-popover"
              aria-hidden={menuOpen() ? undefined : "true"}
            >
              <Popover.Title class="sr-only">Account actions</Popover.Title>
              {accountMenu()}
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>

        <Show when={!props.remoteClient || props.usageTargetKey}>
          <Tooltip.Root
            open={usageTooltipOpen()}
            onOpenChange={(nextOpen) => setUsageTooltipOpen(usageOpen() ? false : nextOpen)}
            openDelay={250}
            closeDelay={75}
            placement="top"
            gutter={8}
          >
            <Tooltip.Trigger as="div" class="account-dock-tooltip-trigger">
              <Popover.Root
                open={usageOpen()}
                onOpenChange={(nextOpen) => {
                  setUsageOpen(nextOpen);
                  if (nextOpen) {
                    setUsageTooltipOpen(false);
                    setMenuOpen(false);
                    if (!props.accountUsage && !usageLoading()) void refreshUsage();
                  } else {
                    restoreFocusWhenDockIsIdle(usageTrigger);
                  }
                }}
                placement="top-end"
                gutter={10}
              >
                <Popover.Trigger
                  ref={(element) => (usageTrigger = element)}
                  as="button"
                  type="button"
                  class={buttonVariants({ variant: "ghost", class: "account-dock-usage-trigger" })}
                  aria-label={usageButtonLabel()}
                  aria-expanded={usageOpen() ? "true" : "false"}
                  data-usage-tone={usageTone()}
                >
                  <span class="account-dock-usage-chip">
                    <Gauge aria-hidden="true" />
                    <strong>
                      <Show
                        when={usageLoading() && usageRemaining() === null}
                        fallback={<AnimatedUsagePercentage value={usageRemaining()} />}
                      >
                        <TypingDots class="account-dock-usage-loading" />
                      </Show>
                    </strong>
                  </span>
                </Popover.Trigger>
                <Popover.Portal>
                  <Popover.Content
                    class="ui-popover-menu-surface account-usage-popover"
                    aria-hidden={usageOpen() ? undefined : "true"}
                  >
                    <AccountUsageDetails
                      rows={usageRows()}
                      loading={usageLoading()}
                      error={usageError()}
                      refreshActive={usageRefreshActive()}
                      refreshDisabled={usageRefreshDisabled()}
                      onRefresh={refreshUsageWithFeedback}
                      title={<Popover.Title class="account-usage-popover-title">Usage</Popover.Title>}
                    />
                  </Popover.Content>
                </Popover.Portal>
              </Popover.Root>
            </Tooltip.Trigger>
            <Tooltip.Portal>
              <Tooltip.Content class="ui-tooltip">
                {usageSummary() ? `${usageSummary()?.name} usage` : "Usage"}
              </Tooltip.Content>
            </Tooltip.Portal>
          </Tooltip.Root>
        </Show>
        <Show when={!props.remoteClient}>
          <Tooltip.Root openDelay={250} closeDelay={75} placement="top" gutter={8}>
            <Tooltip.Trigger as="div" class="account-dock-tooltip-trigger">
              <Button
                ref={(element) => (settingsTrigger = element)}
                variant="ghost"
                type="button"
                class="account-dock-icon-button"
                aria-label="Settings"
                onClick={() => {
                  setMenuOpen(false);
                  setUsageOpen(false);
                  if (settingsTrigger) props.onOpenSettings(settingsTrigger);
                }}
              >
                <Settings aria-hidden="true" />
              </Button>
            </Tooltip.Trigger>
            <Tooltip.Portal>
              <Tooltip.Content class="ui-tooltip">Settings</Tooltip.Content>
            </Tooltip.Portal>
          </Tooltip.Root>
        </Show>
      </div>
    );
  }

  return (
    <div
      class={[
        "account-dock",
        {
          "account-dock-with-server-rail": props.withServerRail,
          "account-dock-compact": props.compact,
          "account-dock-hybrid": hybridLayout(),
        },
      ]}
    >
      <Show when={hybridLayout()} fallback={legacyDock()}>
        <AccountUpdateIsland
          updateStatus={props.updateStatus}
          errorMessage={updateError()}
          onUpdateAction={runUpdateAction}
        />
        {hybridDock()}
      </Show>
    </div>
  );
}
