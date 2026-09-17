import type {
  AccountUsage,
  AccountUsageWindow,
  AgentStatus,
  AgentSummary,
  AppInfo,
  CentralAuthUser,
  ExternalDestination,
  UpdateStatus,
} from "@openbot/contracts/ipc";
import { agentProviderName } from "@openbot/contracts/ipc";
import { createEffect, createMemo, createSignal, For, onCleanup, Show } from "solid-js";
import { TypingDots } from "../../components/TypingDots";
import {
  Badge,
  Button,
  buttonVariants,
  CalendarClock,
  ChevronUp,
  CircleArrowDown,
  Gauge,
  LogOut,
  Mail,
  Megaphone,
  Popover,
  Puzzle,
  RadialProgress,
  RefreshCw,
  Settings,
  ShieldCheck,
  Tooltip,
  UserAvatar,
} from "../../components/ui";
import { errorMessage } from "../../error-message";
import { presentUpdateStatus } from "../updates/update-status";
import { AccountUpdateIsland } from "./AccountUpdateIsland";

interface AccountDockProps {
  account: CentralAuthUser;
  appInfo: AppInfo | null;
  agentStatus: AgentStatus;
  accountUsage: AccountUsage | null;
  usageAgent: Pick<AgentSummary, "name" | "provider" | "model"> | null;
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
  let usageRequestGeneration = 0;
  let usageRequestTargetKey: string | null = null;
  let usageRequestRevision = -1;
  let legacyTrigger: HTMLButtonElement | undefined;
  let menuTrigger: HTMLButtonElement | undefined;
  let usageTrigger: HTMLButtonElement | undefined;
  let settingsTrigger: HTMLButtonElement | undefined;

  const hybridLayout = createMemo(() => props.appInfo?.platform === "darwin" && props.withServerRail && !props.compact);
  const accountName = createMemo(
    () => props.account.name?.trim() || props.account.email.split("@")[0] || props.account.email,
  );
  const usageProviderName = createMemo(() =>
    props.usageAgent ? agentProviderName(props.usageAgent.provider) : "Provider",
  );
  const usageTitle = createMemo(() => `${usageProviderName()} usage`);
  const weeklyUsage = createMemo(() => {
    for (const limit of props.accountUsage?.limits ?? []) {
      const weekly = [limit.primary, limit.secondary].find((window) => isWeeklyWindow(window?.windowDurationMins));
      if (weekly) return weekly;
    }
    return null;
  });
  const weeklyUsageRemaining = createMemo(() => {
    const usage = weeklyUsage();
    return usage ? Math.max(0, Math.round(100 - usage.usedPercent)) : null;
  });
  const usageValue = createMemo(() => weeklyUsageRemaining() ?? 0);
  const usageTone = createMemo(() => {
    const remaining = weeklyUsageRemaining();
    if (remaining === null || remaining >= 30) return "neutral";
    return remaining < 10 ? "critical" : "warning";
  });
  const usageRadialTone = createMemo(() => {
    const tone = usageTone();
    if (tone === "critical") return "danger";
    return tone === "warning" ? "warning" : "accent";
  });
  const usageButtonLabel = createMemo(() => {
    const label = `${usageProviderName()} weekly usage`;
    if (usageLoading() && weeklyUsageRemaining() === null) return `${label} is loading`;
    if (weeklyUsageRemaining() === null) return `${label} unavailable`;
    return `${label}, ${weeklyUsageRemaining()}% left`;
  });
  const usageRefreshActive = createMemo(() => usageLoading() || usageRefreshAcknowledging());
  const usageRefreshDisabled = createMemo(() => usageRefreshActive() || !props.usageReady || !props.usageTargetKey);
  const weeklyUsageReset = createMemo(() => formatUsageReset(weeklyUsage()?.resetsAt));
  const otherUsageWindows = createMemo(() =>
    (props.accountUsage?.limits ?? []).flatMap((limit) =>
      [limit.primary, limit.secondary]
        .filter((window): window is AccountUsageWindow => window !== null && window !== weeklyUsage())
        .map((window) => ({
          label:
            props.accountUsage && props.accountUsage.limits.length > 1
              ? `${limit.id} · ${usageWindowLabel(window.windowDurationMins)}`
              : usageWindowLabel(window.windowDurationMins),
          remaining: Math.max(0, Math.round(100 - window.usedPercent)),
          reset: formatUsageReset(window.resetsAt),
        })),
    ),
  );
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
  });

  createEffect(
    () =>
      [
        props.usageTargetKey,
        props.usageReady,
        props.usageRefreshRevision,
        hybridLayout(),
        menuOpen(),
        usageOpen(),
      ] as const,
    ([targetKey, ready, revision, hybrid, menu, usage]) => {
      if (!targetKey || !ready) {
        usageRequestGeneration += 1;
        usageRequestTargetKey = null;
        usageRequestRevision = -1;
        setUsageLoading(false);
        setUsageError(null);
        return;
      }
      if (!hybrid && !menu && !usage) return;
      if (usageRequestTargetKey === targetKey && usageRequestRevision === revision) return;
      void refreshUsage();
    },
  );

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
    usageRequestTargetKey = targetKey;
    usageRequestRevision = revision;
    setUsageLoading(true);
    setUsageError(null);
    try {
      await props.onRefreshUsage();
    } catch (cause) {
      if (generation === usageRequestGeneration && props.usageTargetKey === targetKey) {
        setUsageError(errorMessage(cause, "Usage is unavailable."));
      }
    } finally {
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

  function usageDetails() {
    return (
      <>
        <Show
          when={props.usageAgent}
          fallback={<p class="account-usage-description">Select an agent to see provider limits.</p>}
        >
          {(agent) => (
            <p class="account-usage-description">
              {agent().name} · {agent().model}
            </p>
          )}
        </Show>
        <div class="account-usage-popover-meter">
          <RadialProgress
            value={usageValue()}
            tone={usageRadialTone()}
            aria-label={`${usageProviderName()} weekly usage remaining`}
            aria-valuetext={
              usageLoading() && weeklyUsageRemaining() === null
                ? "Loading"
                : weeklyUsageRemaining() === null
                  ? "Unavailable"
                  : `${weeklyUsageRemaining()}% left`
            }
          >
            <strong>
              {usageLoading() && weeklyUsageRemaining() === null
                ? "…"
                : weeklyUsageRemaining() === null
                  ? "—"
                  : `${weeklyUsageRemaining()}%`}
            </strong>
          </RadialProgress>
          <span class="account-usage-description">left this week</span>
        </div>
        <div class="account-usage-popover-reset">
          <CalendarClock aria-hidden="true" />
          <span>Weekly reset</span>
          <strong>{weeklyUsageReset() ? weeklyUsageReset() : usageLoading() ? "Checking…" : "Unavailable"}</strong>
        </div>
        <For each={otherUsageWindows()}>
          {(window) => (
            <section class="account-usage-window" aria-label={window.label}>
              <div class="account-usage-window-summary">
                <span>{window.label}</span>
                <strong>{window.remaining}% left</strong>
              </div>
              <span class="account-usage-description">Resets {window.reset ?? "at an unknown time"}</span>
            </section>
          )}
        </For>
      </>
    );
  }

  function accountMenu(includeDockActions = false) {
    return (
      <>
        <Show when={includeDockActions}>
          <section class="account-menu-group" aria-label="Account">
            <Button
              variant="ghost"
              type="button"
              class="account-menu-row"
              aria-label={usageButtonLabel()}
              onClick={refreshUsageWithFeedback}
              disabled={usageRefreshDisabled()}
            >
              <Gauge class="account-menu-icon" aria-hidden="true" />
              <span>{usageProviderName()} weekly usage</span>
              <small>{weeklyUsageRemaining() === null ? "—" : `${weeklyUsageRemaining()}% left`}</small>
            </Button>
            {usageDetails()}
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
        <section class="account-menu-group" aria-label="OpenBot">
          <Show
            when={props.updateStatus.phase !== "unsupported" && (!hybridLayout() || !updatePresentation().available)}
          >
            <Button
              variant="ghost"
              type="button"
              class="account-menu-row"
              onClick={() => void runUpdateAction()}
              disabled={updatePresentation().busy}
            >
              <CircleArrowDown
                class={updatePresentation().busy ? "account-menu-icon account-menu-icon-spinning" : "account-menu-icon"}
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
        <Show when={includeDockActions ? usageError() : null}>
          {(message) => <p class="account-popover-error">{message()}</p>}
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
            <Show when={props.appInfo}>
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
              <Show when={props.appInfo}>
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
                      when={usageLoading() && weeklyUsageRemaining() === null}
                      fallback={<AnimatedUsagePercentage value={weeklyUsageRemaining()} />}
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
                  <header class="account-usage-popover-header">
                    <div class="account-usage-popover-heading">
                      <Gauge aria-hidden="true" />
                      <Popover.Title class="account-usage-popover-title">{usageTitle()}</Popover.Title>
                    </div>
                    <Button
                      variant="ghost"
                      type="button"
                      size="icon-sm"
                      class="account-usage-refresh"
                      aria-label={usageRefreshActive() ? "Refreshing" : usageError() ? "Try again" : "Refresh"}
                      title="Refresh usage"
                      onClick={refreshUsageWithFeedback}
                      disabled={usageRefreshDisabled()}
                    >
                      <RefreshCw
                        class={usageRefreshActive() ? "account-menu-icon-spinning" : undefined}
                        aria-hidden="true"
                      />
                    </Button>
                  </header>
                  {usageDetails()}
                  <Show when={usageError()}>{(message) => <p class="account-usage-popover-error">{message()}</p>}</Show>
                </Popover.Content>
              </Popover.Portal>
            </Popover.Root>
          </Tooltip.Trigger>
          <Tooltip.Portal>
            <Tooltip.Content class="ui-tooltip">{usageButtonLabel()}</Tooltip.Content>
          </Tooltip.Portal>
        </Tooltip.Root>

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

function formatUsageReset(resetsAt: number | null | undefined): string | null {
  if (resetsAt === null || resetsAt === undefined) return null;
  const date = new Date(resetsAt * 1_000);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function usageWindowLabel(durationMins: number | null): string {
  if (isWeeklyWindow(durationMins)) return "Weekly limit";
  if (durationMins === null || durationMins <= 0) return "Other limit";
  if (durationMins % 1_440 === 0) return `${durationMins / 1_440}-day limit`;
  if (durationMins % 60 === 0) return `${durationMins / 60}-hour limit`;
  return `${durationMins}-minute limit`;
}

function isWeeklyWindow(durationMins: number | null | undefined): boolean {
  return durationMins !== null && durationMins !== undefined && Math.abs(durationMins - 10_080) <= 10_080 * 0.05;
}
