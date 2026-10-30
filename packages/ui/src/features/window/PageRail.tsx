import { AppLogo, type AppLogoVariant, ProviderLogo } from "@openbot/brand";
import {
  Bot,
  Button,
  CalendarClock,
  ChartArea,
  DropdownMenu,
  Ellipsis,
  ListChecks,
  MotionTooltip,
  Pin,
  Settings,
  Store,
  Waypoints,
  Workflow,
} from "@openbot/ui";
import { AccountUsageDetails } from "@openbot/ui/features/account/AccountUsageDetails";
import {
  type AccountUsageProviderRow,
  type AccountUsageWindowRow,
  accountUsageRowKey,
} from "@openbot/ui/features/account/account-usage-view";
import { useText } from "@openbot/ui/text";
import { Dynamic, type JSX } from "@solidjs/web";
import { createMemo, createSignal, For, Show } from "solid-js";

/** One rail button. Its name shows as a tooltip, unless it has a `card`: the card shows instead. */
function RailButton(props: {
  label: string;
  /** Renders the card while it is open. */
  card?: () => JSX.Element;
  current?: boolean;
  class?: string;
  onClick: (button: HTMLElement) => void;
  children: JSX.Element;
}) {
  const button = () => (
    <Button
      variant="ghost"
      type="button"
      class={props.class ? `window-rail-button ${props.class}` : "window-rail-button"}
      aria-label={props.label}
      aria-current={props.current ? "page" : undefined}
      onClick={(event) => props.onClick(event.currentTarget)}
    >
      {props.children}
    </Button>
  );
  return (
    <Show when={props.card} fallback={<MotionTooltip content={props.label}>{button()}</MotionTooltip>}>
      {(card) => (
        <MotionTooltip
          content={card()()}
          class="ui-popover-menu-surface account-usage-popover window-rail-usage-card"
          placement="right-end"
          openDelay={250}
          closeDelay={75}
        >
          {button()}
        </MotionTooltip>
      )}
    </Show>
  );
}

/** One track in a 34px box. The stroke is the icon stroke, so the ring does not look heavier than the
 * rail icons. */
const RING = { size: 34, stroke: 1.75 };

/**
 * The limit of one provider as one ring: the window that stops work first, so every provider in the
 * rail has the same mark. The arc shows how much is left, in the tone of that window. The hover card
 * shows all windows with their reset times. `shared` are the readings that count the same quota, such
 * as Cursor on a merged Grok plan: the card lists them, with no ring of their own. The ring draws the
 * reading with the least left, so a shared reading that runs out first still shows.
 */
function UsageRings(props: {
  row: AccountUsageProviderRow;
  shared: readonly AccountUsageProviderRow[];
  onOpen: (button: HTMLElement) => void;
}) {
  const { t, format } = useText();
  const rows = () => [props.row, ...props.shared];
  const label = () =>
    t("app.rail.usageRings", {
      name: format.list(rows().map((row) => row.name)),
      windows: rows()
        .flatMap((row) => row.windows)
        .map((window) => t("account.usage.row.window", { window: window.label, percent: window.remainingPercent }))
        .join(", "),
    });
  const ringRow = () =>
    rows().reduce((lowest, row) => ((row.remainingPercent ?? 100) < (lowest.remainingPercent ?? 100) ? row : lowest));
  // The shortest window comes first, so on a tie the shorter window shows.
  const binding = () =>
    ringRow().ringWindows.reduce<AccountUsageWindowRow | undefined>(
      (lowest, item) => (lowest === undefined || item.remainingPercent < lowest.remainingPercent ? item : lowest),
      undefined,
    );
  const radius = (RING.size - RING.stroke) / 2;
  return (
    <RailButton
      label={label()}
      card={() => (
        <AccountUsageDetails
          rows={rows()}
          loading={false}
          error={null}
          refreshActive={false}
          refreshDisabled
          onRefresh={() => undefined}
          title={<h2 class="account-usage-popover-title">{t("account.usage.title")}</h2>}
        />
      )}
      class="window-rail-usage"
      onClick={props.onOpen}
    >
      <svg class="window-rail-usage-ring" viewBox={`0 0 ${RING.size} ${RING.size}`} fill="none" aria-hidden="true">
        <Show when={binding()}>
          {(window) => (
            <g>
              <circle
                class="window-rail-usage-track"
                cx={RING.size / 2}
                cy={RING.size / 2}
                r={radius}
                stroke-width={RING.stroke}
              />
              <Show when={window().remainingPercent > 0}>
                <circle
                  class="window-rail-usage-arc"
                  data-usage-tone={window().tone}
                  cx={RING.size / 2}
                  cy={RING.size / 2}
                  r={radius}
                  stroke-width={RING.stroke}
                  stroke-linecap="round"
                  pathLength={100}
                  stroke-dasharray={`${window().remainingPercent} 100`}
                />
              </Show>
            </g>
          )}
        </Show>
      </svg>
      <ProviderLogo provider={props.row.provider} class="window-rail-usage-logo" />
    </RailButton>
  );
}

/** The answer of one custom agent to its usage prompt. OpenBot cannot read a percent from it. */
export interface CustomAgentUsageRailRow {
  id: string;
  name: string;
  text: string;
}

/**
 * The plan usage of one custom agent: the agent logo, with no ring. The hover card shows the answer
 * as the agent wrote it.
 */
function CustomAgentUsageButton(props: { row: CustomAgentUsageRailRow; onOpen: (button: HTMLElement) => void }) {
  const { t } = useText();
  return (
    <RailButton
      label={t("app.rail.customAgentUsage", { name: props.row.name })}
      card={() => (
        <div class="window-rail-agent-usage">
          <h2 class="account-usage-popover-title">{props.row.name}</h2>
          <p class="window-rail-agent-usage-text">{props.row.text}</p>
        </div>
      )}
      class="window-rail-usage"
      onClick={props.onOpen}
    >
      <ProviderLogo provider="acp" class="window-rail-usage-logo window-rail-agent-usage-logo" />
    </RailButton>
  );
}

/** The rail pages. Agents and Routines show the same page with a different sidebar list. */
export type PageRailPage =
  | "agents"
  | "routines"
  | "workflows"
  | "tasks"
  | "schedule"
  | "usage"
  | "marketplace"
  | "settings";

/** The pages that the user can pin to the rail, in rail order. Agents always shows. */
export const PAGE_RAIL_PINNABLE_PAGES = [
  "routines",
  "workflows",
  "tasks",
  "schedule",
  "usage",
] as const satisfies readonly PageRailPage[];
export type PageRailPinnablePage = (typeof PAGE_RAIL_PINNABLE_PAGES)[number];

export interface PageRailProps {
  hidden: boolean;
  /** The page in the card, or `null` while a page that the rail does not open shows. */
  current: PageRailPage | null;
  /** The pages that show as rail buttons. The More menu has all pages, with a pin for each one. */
  pinned: readonly PageRailPinnablePage[];
  onPinChange: (page: PageRailPinnablePage, pinned: boolean) => void;
  /** The plan limits of each provider account. Each one with a reported window shows as rings. */
  usageRows: readonly AccountUsageProviderRow[];
  /** The answers of the custom agents on this computer that have a usage prompt. Absent on the web. */
  customAgentUsage?: readonly CustomAgentUsageRailRow[] | undefined;
  onAgents: () => void;
  /** Absent when the server has no routines. */
  onRoutines?: (() => void) | undefined;
  /** Absent when the server has no workflows. */
  onWorkflows?: (() => void) | undefined;
  /** Absent where the server keeps no tasks. */
  onTasks?: ((button: HTMLElement) => void) | undefined;
  /** Absent where there is no schedule page. */
  onSchedule?: ((button: HTMLElement) => void) | undefined;
  onUsage: (button: HTMLElement) => void;
  /** Absent while Marketplace cannot open. */
  onMarketplace?: (() => void) | undefined;
  onSettings: (button: HTMLElement) => void;
  /** A notice for the Settings button, such as an update, when no other place shows it. A dot marks it. */
  settingsNotice?: string | undefined;
  /** The Help menu, between Marketplace and Settings. */
  help: JSX.Element;
  /**
   * The OpenBot logo in the top row, for a window that has no macOS window buttons there. With
   * `href`, the logo is a link to the OpenBot site.
   */
  logo?: { variant: AppLogoVariant; href?: string | undefined } | undefined;
}

/** A page that the user can pin to the rail. */
interface RailPage {
  id: PageRailPinnablePage;
  label: string;
  icon: typeof Bot;
  open: (button: HTMLElement) => void;
}

/**
 * The More button of the rail. Its menu lists every page that the user can pin. A row opens its page;
 * the pin at the end of the row pins or unpins it, and the menu stays open. When the open page has no
 * rail button, the More button shows as the current page.
 */
function RailMoreMenu(props: {
  pages: readonly RailPage[];
  current: PageRailPage | null;
  pinned: readonly PageRailPinnablePage[];
  onPinChange: (page: PageRailPinnablePage, pinned: boolean) => void;
}) {
  const { t } = useText();
  const [open, setOpen] = createSignal(false);
  let trigger: HTMLElement | undefined;
  // A pin adds or removes a rail button above More, so the trigger moves. The menu keeps the place
  // where it opened, so the row under the pointer stays the same.
  let anchor: DOMRect | undefined;
  const changeOpen = (next: boolean) => {
    anchor = next ? trigger?.getBoundingClientRect() : undefined;
    setOpen(next);
  };
  const pinned = (page: PageRailPinnablePage) => props.pinned.includes(page);
  const currentInMenu = () => props.pages.some((page) => page.id === props.current && !pinned(page.id));
  return (
    <DropdownMenu.Root
      placement="right-start"
      gutter={10}
      onOpenChange={changeOpen}
      getAnchorRect={(element?: HTMLElement) => anchor ?? element?.getBoundingClientRect()}
    >
      <MotionTooltip content={t("app.rail.more")} suppressed={open()}>
        <DropdownMenu.Trigger
          ref={(element: HTMLElement) => {
            trigger = element;
          }}
          class="window-rail-button"
          aria-label={t("app.rail.more")}
          aria-current={currentInMenu() ? "page" : undefined}
        >
          <Ellipsis aria-hidden="true" />
        </DropdownMenu.Trigger>
      </MotionTooltip>
      <DropdownMenu.Portal>
        <DropdownMenu.Content class="agent-context-menu window-rail-more-menu" aria-label={t("app.rail.more")}>
          <For each={props.pages} keyed={(page) => page.id}>
            {(page) => (
              // The pin is its own menu item beside the page, so the keyboard reaches it.
              <div role="none" class="window-rail-more-row" data-pinned={pinned(page().id) ? "" : undefined}>
                <DropdownMenu.Item onSelectAfterClose={() => trigger && page().open(trigger)}>
                  <Dynamic component={page().icon} class="agent-context-icon size-4" aria-hidden="true" />
                  <span>{page().label}</span>
                </DropdownMenu.Item>
                <DropdownMenu.CheckboxItem
                  class="window-rail-more-pin"
                  closeOnSelect={false}
                  checked={pinned(page().id)}
                  onChange={(checked: boolean) => props.onPinChange(page().id, checked)}
                  aria-label={t("app.rail.pinPage", { name: page().label })}
                >
                  <Pin class="agent-context-icon size-4" aria-hidden="true" />
                </DropdownMenu.CheckboxItem>
              </div>
            )}
          </For>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

/** The logo in the top row of the rail, in line with the icons of the rail and the server logo of the sidebar. */
function RailLogo(props: { variant: AppLogoVariant; href: string | undefined }) {
  const { t } = useText();
  return (
    <div class="window-rail-logo">
      <Show when={props.href} fallback={<AppLogo variant={props.variant} />}>
        {(href) => (
          <MotionTooltip content={t("app.rail.website")}>
            <a
              class="window-rail-logo-link"
              href={href()}
              target="_blank"
              rel="noopener"
              aria-label={t("app.rail.website")}
            >
              <AppLogo variant={props.variant} />
            </a>
          </MotionTooltip>
        )}
      </Show>
    </div>
  );
}

/**
 * The page rail at the left of the window, on desktop and on the web. Its buttons change the page in
 * the card. A usage ring shows the plan limits of one provider and opens the usage page.
 */
export function PageRail(props: PageRailProps) {
  const { t } = useText();
  /**
   * One ring per reading, except a reading that counts the quota of another provider's own sign-in,
   * such as Cursor on a merged Grok plan: that ring's card lists it instead.
   */
  const rings = createMemo(() => {
    const rows = props.usageRows.filter((row) => row.reportsUsage && row.windows.length > 0);
    const owner = (row: AccountUsageProviderRow) =>
      rows.find((other) => other.accountId === null && other.provider === row.sharedQuotaWith);
    return rows
      .filter((row) => !owner(row))
      .map((row) => ({ row, shared: rows.filter((other) => owner(other) === row) }));
  });
  /** The pages that this server has, in rail order. */
  const pages = createMemo((): RailPage[] => {
    const list: RailPage[] = [];
    const { onRoutines, onWorkflows, onTasks, onSchedule } = props;
    if (onRoutines) {
      list.push({
        id: "routines",
        label: t("sidebar.view.routines"),
        icon: Workflow,
        open: () => onRoutines(),
      });
    }
    if (onWorkflows) {
      list.push({
        id: "workflows",
        label: t("app.rail.workflows"),
        icon: Waypoints,
        open: () => onWorkflows(),
      });
    }
    if (onTasks) {
      list.push({ id: "tasks", label: t("app.rail.tasks"), icon: ListChecks, open: onTasks });
    }
    if (onSchedule) {
      list.push({
        id: "schedule",
        label: t("app.rail.schedule"),
        icon: CalendarClock,
        open: onSchedule,
      });
    }
    list.push({ id: "usage", label: t("app.rail.usage"), icon: ChartArea, open: props.onUsage });
    return list;
  });
  return (
    <nav class="window-rail" aria-label={t("app.rail.label")} hidden={props.hidden}>
      <Show when={props.logo}>{(logo) => <RailLogo variant={logo().variant} href={logo().href} />}</Show>
      <div class="window-rail-group">
        <RailButton label={t("app.rail.agents")} current={props.current === "agents"} onClick={props.onAgents}>
          <Bot aria-hidden="true" />
        </RailButton>
        <For each={pages().filter((page) => props.pinned.includes(page.id))} keyed={(page) => page.id}>
          {(page) => (
            <RailButton label={page().label} current={props.current === page().id} onClick={page().open}>
              <Dynamic component={page().icon} aria-hidden="true" />
            </RailButton>
          )}
        </For>
        <RailMoreMenu pages={pages()} current={props.current} pinned={props.pinned} onPinChange={props.onPinChange} />
      </div>
      <div class="window-rail-group">
        {/* A status update builds new rows. The key keeps each ring, and its open hover card, mounted. */}
        <For each={rings()} keyed={(ring) => accountUsageRowKey(ring.row)}>
          {(ring) => <UsageRings row={ring().row} shared={ring().shared} onOpen={props.onUsage} />}
        </For>
        <For each={props.customAgentUsage ?? []} keyed={(row) => row.id}>
          {(row) => <CustomAgentUsageButton row={row()} onOpen={props.onUsage} />}
        </For>
        <Show when={props.onMarketplace}>
          {(onMarketplace) => (
            <RailButton
              label={t("app.rail.marketplace")}
              current={props.current === "marketplace"}
              onClick={() => onMarketplace()()}
            >
              <Store aria-hidden="true" />
            </RailButton>
          )}
        </Show>
        {props.help}
        <RailButton
          label={
            props.settingsNotice
              ? t("app.rail.settingsNotice", { notice: props.settingsNotice })
              : t("app.rail.settings")
          }
          current={props.current === "settings"}
          onClick={props.onSettings}
        >
          <Settings aria-hidden="true" />
          <Show when={props.settingsNotice}>
            <span class="window-rail-notice" aria-hidden="true" />
          </Show>
        </RailButton>
      </div>
    </nav>
  );
}
