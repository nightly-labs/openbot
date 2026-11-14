import { AppLogo, type AppLogoVariant, ProviderLogo } from "@openbot/brand";
import { usageTone } from "@openbot/team-client/plan-limits";
import {
  Bot,
  Button,
  CalendarClock,
  ChartArea,
  DropdownMenu,
  Ellipsis,
  GalleryVerticalEnd,
  ListChecks,
  MotionTooltip,
  Pin,
  Settings,
  Store,
  Waypoints,
  Workflow,
} from "@openbot/ui";
import { AccountUsageDetails, AccountUsageWindowList } from "@openbot/ui/features/account/AccountUsageDetails";
import { type AccountUsageProviderRow, accountUsageRowKey } from "@openbot/ui/features/account/account-usage-view";
import { useText } from "@openbot/ui/text";
import { Dynamic, type JSX } from "@solidjs/web";
import { createMemo, createSignal, For, onSettled, Show } from "solid-js";

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

/** The hover card of a usage ring: the limits of its readings, with no refresh. */
function UsageCard(props: { rows: AccountUsageProviderRow[] }) {
  const { t } = useText();
  return (
    <AccountUsageDetails
      rows={props.rows}
      loading={false}
      error={null}
      refreshActive={false}
      refreshDisabled
      onRefresh={() => undefined}
      title={<h2 class="account-usage-popover-title">{t("account.usage.title")}</h2>}
    />
  );
}

/** Two tracks in a 34px box, with 4.5px between their centers. */
const RING = { size: 34, stroke: 2.25, spacing: 4.5 };

/**
 * The limits of one provider as concentric rings: the outer ring is the longest window, the inner
 * ring the shortest. Each arc shows how much is left, in the tone of that window. The hover card
 * shows the windows with their reset times. `shared` are the readings that count the same quota, such
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
  const windows = () => [...ringRow().ringWindows].reverse().slice(0, 2);
  const outerRadius = (RING.size - RING.stroke) / 2;
  return (
    <RailButton
      label={label()}
      card={() => <UsageCard rows={rows()} />}
      class="window-rail-usage"
      onClick={props.onOpen}
    >
      <svg class="window-rail-usage-ring" viewBox={`0 0 ${RING.size} ${RING.size}`} fill="none" aria-hidden="true">
        <For each={windows()} keyed={false}>
          {(window, index) => (
            <g>
              <circle
                class="window-rail-usage-track"
                cx={RING.size / 2}
                cy={RING.size / 2}
                r={outerRadius - index * RING.spacing}
                stroke-width={RING.stroke}
              />
              <Show when={window().remainingPercent > 0}>
                <circle
                  class="window-rail-usage-arc"
                  data-usage-tone={window().tone}
                  cx={RING.size / 2}
                  cy={RING.size / 2}
                  r={outerRadius - index * RING.spacing}
                  stroke-width={RING.stroke}
                  stroke-linecap="round"
                  pathLength={100}
                  stroke-dasharray={`${window().remainingPercent} 100`}
                />
              </Show>
            </g>
          )}
        </For>
      </svg>
      <ProviderLogo provider={props.row.provider} class="window-rail-usage-logo" />
    </RailButton>
  );
}

/** One usage ring: a reading, and the readings that count the same quota. */
interface UsageRing {
  row: AccountUsageProviderRow;
  shared: AccountUsageProviderRow[];
}

/** The part left of the reading in the ring with the least left. */
function ringLeft(ring: UsageRing): number {
  return Math.min(...[ring.row, ...ring.shared].map((row) => row.remainingPercent ?? 100));
}

/**
 * The rings that do not fit in the rail, as one ring with their number. The hover card lists their
 * readings. A click opens the usage page.
 */
function MoreUsageRings(props: { rings: readonly UsageRing[]; onOpen: (button: HTMLElement) => void }) {
  const { t } = useText();
  const rows = () => props.rings.flatMap((ring) => [ring.row, ...ring.shared]);
  return (
    <RailButton
      label={t("app.rail.moreUsage", { count: props.rings.length })}
      card={() => <UsageCard rows={rows()} />}
      class="window-rail-usage window-rail-usage-more"
      onClick={props.onOpen}
    >
      <svg class="window-rail-usage-ring" viewBox={`0 0 ${RING.size} ${RING.size}`} fill="none" aria-hidden="true">
        <circle
          class="window-rail-usage-track"
          cx={RING.size / 2}
          cy={RING.size / 2}
          r={(RING.size - RING.stroke) / 2}
          stroke-width={RING.stroke}
        />
      </svg>
      <span class="window-rail-usage-count" aria-hidden="true">
        {t("app.rail.moreUsageCount", { count: props.rings.length })}
      </span>
    </RailButton>
  );
}

/**
 * The most ring places in the rail, also in a tall window: four rings and the "+N" ring, or five
 * rings. A "+N" ring never takes the place of one ring. When the window has space for one place
 * only, the "+N" ring shows all the readings.
 */
const MAX_RING_PLACES = 5;
/** The space in pixels that stays between the pages and the end of the rail. */
const RAIL_MIN_FREE = 12;

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

/** The credits of a media service that a canvas step spends, such as Sunra. */
export interface MediaCreditsRailRow {
  provider: "sunra";
  name: string;
  /** The credits that the account can spend now. */
  available: number;
  /** The limit of a team member, or null for an account with no limit of its own. */
  quota: number | null;
}

/**
 * The credits of one media service. A team quota draws a ring with the part that is left, as the
 * plan limits of a provider do. An account with no limit of its own shows the logo alone, as a custom
 * agent does. The hover card shows the number.
 */
function MediaCreditsButton(props: { row: MediaCreditsRailRow; onOpen: (button: HTMLElement) => void }) {
  const { t, format } = useText();
  /** The part of the quota that is left, 0 to 100. A quota of 0 has nothing left. */
  const percent = () => {
    const quota = props.row.quota ?? 0;
    return quota > 0 ? Math.min(100, Math.round((props.row.available / quota) * 100)) : 0;
  };
  const label = () => {
    const credits = format.number(props.row.available);
    const quota = props.row.quota;
    return quota !== null
      ? t("app.rail.mediaCreditsQuota", { name: props.row.name, credits, quota: format.number(quota) })
      : t("app.rail.mediaCredits", { name: props.row.name, credits });
  };
  const radius = (RING.size - RING.stroke) / 2;
  return (
    <RailButton
      label={label()}
      card={() => (
        <ul class="account-usage-providers" aria-label={props.row.name}>
          <li class="account-usage-provider">
            <ProviderLogo provider={props.row.provider} class="account-usage-provider-logo" />
            <Show
              when={props.row.quota !== null}
              fallback={
                <>
                  <span class="account-usage-provider-copy">
                    <strong class="account-usage-provider-name">{props.row.name}</strong>
                    <span class="account-usage-provider-meta">{t("app.rail.mediaCreditsMeta")}</span>
                  </span>
                  <strong class="account-usage-provider-remaining">{format.number(props.row.available)}</strong>
                </>
              }
            >
              <strong class="account-usage-provider-name">{props.row.name}</strong>
              <AccountUsageWindowList
                windows={[
                  {
                    label: t("app.rail.mediaCreditsWindow", {
                      credits: format.number(props.row.available),
                      quota: format.number(props.row.quota ?? 0),
                    }),
                    remainingPercent: percent(),
                    tone: usageTone(percent()),
                    resetsAt: null,
                    resetsAtLabel: null,
                  },
                ]}
                now={Date.now()}
              />
            </Show>
          </li>
        </ul>
      )}
      class="window-rail-usage"
      onClick={props.onOpen}
    >
      <Show
        when={props.row.quota !== null}
        fallback={
          <ProviderLogo provider={props.row.provider} class="window-rail-usage-logo window-rail-agent-usage-logo" />
        }
      >
        <svg class="window-rail-usage-ring" viewBox={`0 0 ${RING.size} ${RING.size}`} fill="none" aria-hidden="true">
          <circle
            class="window-rail-usage-track"
            cx={RING.size / 2}
            cy={RING.size / 2}
            r={radius}
            stroke-width={RING.stroke}
          />
          <Show when={percent() > 0}>
            <circle
              class="window-rail-usage-arc"
              data-usage-tone={usageTone(percent())}
              cx={RING.size / 2}
              cy={RING.size / 2}
              r={radius}
              stroke-width={RING.stroke}
              stroke-linecap="round"
              pathLength={100}
              stroke-dasharray={`${percent()} 100`}
            />
          </Show>
        </svg>
        <ProviderLogo provider={props.row.provider} class="window-rail-usage-logo" />
      </Show>
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
  | "library"
  | "marketplace"
  | "settings";

/** The pages that the user can pin to the rail, in rail order. Agents always shows. */
export const PAGE_RAIL_PINNABLE_PAGES = [
  "routines",
  "workflows",
  "tasks",
  "schedule",
  "usage",
  "library",
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
  /** The credits of the media services that the open Canvas page can spend. Absent on other pages. */
  mediaCredits?: readonly MediaCreditsRailRow[] | undefined;
  /** Opens the app page of a media service. */
  onMediaCredits?: ((provider: MediaCreditsRailRow["provider"]) => void) | undefined;
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
  /** Absent where the server keeps no files, such as the web client. */
  onLibrary?: ((button: HTMLElement) => void) | undefined;
  /** Absent while Marketplace cannot open. */
  onMarketplace?: (() => void) | undefined;
  onSettings: (button: HTMLElement) => void;
  /** A notice for the Settings button, such as an update, when no other place shows it. A dot marks it. */
  settingsNotice?: string | undefined;
  /** The Help menu, between Marketplace and Settings. */
  help: JSX.Element;
  /** The menu of the open server, below Settings. Absent where the window has one server and no menu. */
  server?: JSX.Element;
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
  const rings = createMemo((): UsageRing[] => {
    const rows = props.usageRows.filter((row) => row.reportsUsage && row.windows.length > 0);
    const owner = (row: AccountUsageProviderRow) =>
      rows.find((other) => other.accountId === null && other.provider === row.sharedQuotaWith);
    return rows
      .filter((row) => !owner(row))
      .map((row) => ({ row, shared: rows.filter((other) => owner(other) === row) }));
  });
  /** The number of ring places that fit between the pages and the end buttons. */
  const [ringSlots, setRingSlots] = createSignal(MAX_RING_PLACES);
  /**
   * When all rings do not fit, the rings with the least left stay, in their order, and one "+N" ring
   * takes the last place.
   */
  const ringLayout = createMemo(() => {
    const all = rings();
    if (all.length <= ringSlots()) return { shown: all, more: [] };
    const kept = new Set([...all].sort((a, b) => ringLeft(a) - ringLeft(b)).slice(0, ringSlots() - 1));
    return { shown: all.filter((ring) => kept.has(ring)), more: all.filter((ring) => !kept.has(ring)) };
  });
  let rail: HTMLElement | undefined;
  let pageGroup: HTMLElement | undefined;
  let railEnd: HTMLElement | undefined;
  let endGroup: HTMLElement | undefined;
  /* The free height comes from the layout: the rail height, the pages, and the end buttons other
   * than the rings. One place is one button and the gap after it. */
  onSettled(() => {
    if (!rail || !pageGroup || !railEnd || !endGroup) return;
    const [nav, pagesBox, endBox, end] = [rail, pageGroup, railEnd, endGroup];
    const measure = () => {
      const button = end.lastElementChild;
      if (!(button instanceof HTMLElement) || nav.hidden) return;
      const slot = button.offsetHeight + Number.parseFloat(getComputedStyle(end).rowGap);
      const rendered = ringLayout().shown.length + (ringLayout().more.length > 0 ? 1 : 0);
      const endWithoutRings = endBox.offsetHeight - rendered * slot;
      const free =
        nav.getBoundingClientRect().bottom -
        Number.parseFloat(getComputedStyle(nav).paddingBlockEnd) -
        pagesBox.getBoundingClientRect().bottom -
        endWithoutRings -
        RAIL_MIN_FREE;
      setRingSlots(Math.max(1, Math.min(MAX_RING_PLACES, Math.floor(free / slot))));
    };
    /* A new ring count changes the size of the end group, which this observer watches. The measure
     * waits for the next frame, so the change does not come back in the same observer loop. */
    let frame = 0;
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    });
    for (const element of [nav, pagesBox, endBox]) observer.observe(element);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
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
    const onLibrary = props.onLibrary;
    if (onLibrary) {
      list.push({ id: "library", label: t("app.rail.library"), icon: GalleryVerticalEnd, open: onLibrary });
    }
    return list;
  });
  return (
    <nav
      class="window-rail"
      aria-label={t("app.rail.label")}
      hidden={props.hidden}
      ref={(element) => {
        rail = element;
      }}
    >
      <Show when={props.logo}>{(logo) => <RailLogo variant={logo().variant} href={logo().href} />}</Show>
      <div
        class="window-rail-group"
        ref={(element) => {
          pageGroup = element;
        }}
      >
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
      <div
        class="window-rail-end"
        ref={(element) => {
          railEnd = element;
        }}
      >
        <div
          class="window-rail-group"
          ref={(element) => {
            endGroup = element;
          }}
        >
          {/* A status update builds new rows. The key keeps each ring, and its open hover card, mounted. */}
          <For each={ringLayout().shown} keyed={(ring) => accountUsageRowKey(ring.row)}>
            {(ring) => <UsageRings row={ring().row} shared={ring().shared} onOpen={props.onUsage} />}
          </For>
          <Show when={ringLayout().more.length > 0}>
            <MoreUsageRings rings={ringLayout().more} onOpen={props.onUsage} />
          </Show>
          <For each={props.customAgentUsage ?? []} keyed={(row) => row.id}>
            {(row) => <CustomAgentUsageButton row={row()} onOpen={props.onUsage} />}
          </For>
          <For each={props.mediaCredits ?? []} keyed={(row) => row.provider}>
            {(row) => <MediaCreditsButton row={row()} onOpen={() => props.onMediaCredits?.(row().provider)} />}
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
        {/* The slot shows no line while it is empty. */}
        <div class="window-rail-server-slot">{props.server}</div>
      </div>
    </nav>
  );
}
