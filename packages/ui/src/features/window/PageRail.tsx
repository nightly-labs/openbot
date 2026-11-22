import { AppLogo, type AppLogoVariant, ProviderLogo } from "@openbot/brand";
import { usageTone } from "@openbot/team-client/plan-limits";
import {
  Bot,
  BriefcaseBusiness,
  Button,
  buttonVariants,
  CalendarClock,
  ChartArea,
  ContextMenu,
  DropdownMenu,
  Ellipsis,
  GalleryVerticalEnd,
  ListChecks,
  MotionTooltip,
  Pin,
  PinOff,
  Plug,
  Settings,
  Sparkles,
  Store,
  Waypoints,
} from "@openbot/ui";
import { AccountUsageDetails, AccountUsageWindowList } from "@openbot/ui/features/account/AccountUsageDetails";
import { type AccountUsageProviderRow, accountUsageRowKey } from "@openbot/ui/features/account/account-usage-view";
import { useText } from "@openbot/ui/text";
import { Dynamic, type JSX } from "@solidjs/web";
import { createMemo, createSignal, For, onSettled, Show } from "solid-js";

interface RailMenuItem {
  label: string;
  icon: typeof Bot;
  open: (button: HTMLElement) => void;
}

function RailContextMenu(props: {
  label: string;
  items: readonly RailMenuItem[];
  button: () => HTMLElement | undefined;
}) {
  return (
    <ContextMenu.Portal>
      <ContextMenu.Content class="agent-context-menu" aria-label={props.label}>
        <For each={props.items}>
          {(item) => (
            <ContextMenu.Item
              onSelectAfterClose={() => {
                const button = props.button();
                if (button) item.open(button);
              }}
            >
              <Dynamic component={item.icon} class="agent-context-icon size-4" aria-hidden="true" />
              <span>{item.label}</span>
            </ContextMenu.Item>
          )}
        </For>
      </ContextMenu.Content>
    </ContextMenu.Portal>
  );
}

function RailButton(props: {
  label: string;
  card?: () => JSX.Element;
  current?: boolean;
  class?: string;
  menu?: readonly RailMenuItem[] | undefined;
  onClick: (button: HTMLElement) => void;
  onPreload?: (() => void) | undefined;
  children: JSX.Element;
}) {
  const [menuOpen, setMenuOpen] = createSignal(false);
  const plain = () => (
    <Button
      variant="ghost"
      type="button"
      class={props.class ? `window-rail-button ${props.class}` : "window-rail-button"}
      aria-label={props.label}
      aria-current={props.current ? "page" : undefined}
      onPointerEnter={() => props.onPreload?.()}
      onFocus={() => props.onPreload?.()}
      onClick={(event) => props.onClick(event.currentTarget)}
    >
      {props.children}
    </Button>
  );
  const button = () => (
    <Show when={props.menu} fallback={plain()}>
      {(items) => {
        let element: HTMLElement | undefined;
        return (
          <ContextMenu.Root modal={false} onOpenChange={setMenuOpen}>
            <ContextMenu.Trigger
              as="button"
              type="button"
              ref={(trigger: HTMLElement) => {
                element = trigger;
              }}
              class={`${buttonVariants({ variant: "ghost" })} window-rail-button`}
              aria-label={props.label}
              aria-current={props.current ? "page" : undefined}
              onPointerEnter={() => props.onPreload?.()}
              onFocus={() => props.onPreload?.()}
              onClick={(event: MouseEvent) => {
                if (event.currentTarget instanceof HTMLElement) props.onClick(event.currentTarget);
              }}
            >
              {props.children}
            </ContextMenu.Trigger>
            <RailContextMenu label={props.label} items={items()} button={() => element} />
          </ContextMenu.Root>
        );
      }}
    </Show>
  );
  return (
    <Show
      when={props.card}
      fallback={
        <MotionTooltip content={props.label} suppressed={menuOpen()}>
          {button()}
        </MotionTooltip>
      }
    >
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

const RING = { size: 34, stroke: 2.25, spacing: 4.5 };

function UsageRings(props: {
  row: AccountUsageProviderRow;
  shared: readonly AccountUsageProviderRow[];
  onOpen: (button: HTMLElement) => void;
}) {
  const { t, format } = useText();
  const rows = () => [props.row, ...props.shared];
  const label = () =>
    unavailable()
      ? t("app.rail.usageUnavailable", { name: format.list(rows().map((row) => row.name)) })
      : t("app.rail.usageRings", {
          name: format.list(rows().map((row) => row.name)),
          windows: rows()
            .flatMap((row) => row.windows)
            .map((window) => t("account.usage.row.window", { window: window.label, percent: window.remainingPercent }))
            .join(", "),
        });
  const ringRow = () =>
    rows().reduce((lowest, row) => ((row.remainingPercent ?? 100) < (lowest.remainingPercent ?? 100) ? row : lowest));
  const windows = () => [...ringRow().ringWindows].reverse().slice(0, 2);
  const unavailable = () => props.row.readFailed && windows().length === 0;
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
        <Show when={unavailable()}>
          <circle
            class="window-rail-usage-track"
            cx={RING.size / 2}
            cy={RING.size / 2}
            r={outerRadius}
            stroke-width={RING.stroke}
            pathLength={100}
            stroke-dasharray="4 6"
          />
        </Show>
      </svg>
      <ProviderLogo provider={props.row.provider} class="window-rail-usage-logo" />
    </RailButton>
  );
}

interface UsageRing {
  row: AccountUsageProviderRow;
  shared: AccountUsageProviderRow[];
}

function ringLeft(ring: UsageRing): number {
  return Math.min(...[ring.row, ...ring.shared].map((row) => row.remainingPercent ?? 100));
}

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

const START_RING_PLACES = 5;
const RAIL_MIN_FREE = 12;

export interface CustomAgentUsageRailRow {
  id: string;
  name: string;
  text: string;
}

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

export interface MediaCreditsRailRow {
  key: string;
  provider: "sunra" | "higgsfield";
  name: string;
  available: number;
  quota: number | null;
  number?: number | undefined;
}

function mediaCreditsPercent(row: MediaCreditsRailRow): number {
  const quota = row.quota ?? 0;
  return quota > 0 ? Math.min(100, Math.round((row.available / quota) * 100)) : 0;
}

function mediaCreditsTone(row: MediaCreditsRailRow) {
  if (row.quota !== null) return usageTone(mediaCreditsPercent(row));
  return row.available > 0 ? "neutral" : "critical";
}

function MediaCreditsButton(props: { row: MediaCreditsRailRow; onOpen: (button: HTMLElement) => void }) {
  const { t, format } = useText();
  const percent = () => mediaCreditsPercent(props.row);
  const label = () => {
    const credits = format.number(props.row.available);
    const quota = props.row.quota;
    return quota !== null
      ? t("app.rail.mediaCreditsQuota", { name: props.row.name, credits, quota: format.number(quota) })
      : t("app.rail.mediaCredits", { name: props.row.name, credits });
  };
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
                    durationMins: null,
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
      class="window-rail-credits"
      onClick={props.onOpen}
    >
      <ProviderLogo provider={props.row.provider} class="window-rail-credits-logo" />
      <span class="window-rail-credits-count" data-usage-tone={mediaCreditsTone(props.row)} aria-hidden="true">
        {format.compact(props.row.available)}
      </span>
      <Show when={props.row.number}>
        {(number) => (
          <span class="window-rail-credits-badge" aria-hidden="true">
            {number()}
          </span>
        )}
      </Show>
    </RailButton>
  );
}

export type PageRailPage =
  | "agents"
  | "workflows"
  | "tasks"
  | "schedule"
  | "usage"
  | "library"
  | "providers"
  | "crm"
  | "marketplace"
  | "settings";

export const PAGE_RAIL_PINNABLE_PAGES = [
  "workflows",
  "tasks",
  "schedule",
  "usage",
  "library",
  "providers",
  "crm",
] as const satisfies readonly PageRailPage[];
export type PageRailPinnablePage = (typeof PAGE_RAIL_PINNABLE_PAGES)[number];

export interface PageRailProps {
  hidden: boolean;
  current: PageRailPage | null;
  pinned: readonly PageRailPinnablePage[];
  onPinChange: (page: PageRailPinnablePage, pinned: boolean) => void;
  usageRows: readonly AccountUsageProviderRow[];
  customAgentUsage?: readonly CustomAgentUsageRailRow[] | undefined;
  mediaCredits?: readonly MediaCreditsRailRow[] | undefined;
  onMediaCredits?: ((provider: MediaCreditsRailRow["provider"]) => void) | undefined;
  onAgents: () => void;
  onWorkflows?: (() => void) | undefined;
  onPreloadWorkflows?: (() => void) | undefined;
  onTasks?: ((button: HTMLElement) => void) | undefined;
  onSchedule?: ((button: HTMLElement) => void) | undefined;
  onUsage: (button: HTMLElement) => void;
  onLibrary?: ((button: HTMLElement) => void) | undefined;
  onProviders?: ((button: HTMLElement) => void) | undefined;
  onCrm?: ((button: HTMLElement) => void) | undefined;
  onCrmConnectors?: ((button: HTMLElement) => void) | undefined;
  onMarketplace?: (() => void) | undefined;
  onSettings: (button: HTMLElement) => void;
  settingsNotice?: string | undefined;
  help: JSX.Element;
  server?: JSX.Element;
  logo?: { variant: AppLogoVariant; href?: string | undefined } | undefined;
}

interface RailPage {
  id: PageRailPinnablePage;
  label: string;
  icon: typeof Bot;
  open: (button: HTMLElement) => void;
  preload?: (() => void) | undefined;
  menu?: readonly RailMenuItem[] | undefined;
}

function RailMoreMenu(props: {
  pages: readonly RailPage[];
  current: PageRailPage | null;
  pinned: readonly PageRailPinnablePage[];
  onPinChange: (page: PageRailPinnablePage, pinned: boolean) => void;
}) {
  const { t } = useText();
  const [open, setOpen] = createSignal(false);
  let trigger: HTMLElement | undefined;
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
              <div role="none" class="window-rail-more-row" data-pinned={pinned(page().id) ? "" : undefined}>
                <DropdownMenu.Item
                  onPointerEnter={() => page().preload?.()}
                  onFocus={() => page().preload?.()}
                  onSelectAfterClose={() => trigger && page().open(trigger)}
                >
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

export function PageRail(props: PageRailProps) {
  const { t } = useText();
  const rings = createMemo((): UsageRing[] => {
    const rows = props.usageRows.filter((row) => row.reportsUsage && (row.windows.length > 0 || row.readFailed));
    const owner = (row: AccountUsageProviderRow) =>
      rows.find((other) => other.accountId === null && other.provider === row.sharedQuotaWith);
    return rows
      .filter((row) => !owner(row))
      .map((row) => ({ row, shared: rows.filter((other) => owner(other) === row) }));
  });
  const [ringSlots, setRingSlots] = createSignal(START_RING_PLACES);
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
      setRingSlots(Math.max(1, Math.floor(free / slot)));
    };
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
  const pages = createMemo((): RailPage[] => {
    const list: RailPage[] = [];
    const { onWorkflows, onTasks, onSchedule } = props;
    if (onWorkflows) {
      list.push({
        id: "workflows",
        label: t("app.rail.workflows"),
        icon: Waypoints,
        open: () => onWorkflows(),
        preload: props.onPreloadWorkflows,
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
    const onProviders = props.onProviders;
    if (onProviders) {
      list.push({ id: "providers", label: t("app.rail.providers"), icon: Sparkles, open: onProviders });
    }
    const onCrm = props.onCrm;
    if (onCrm) {
      const onConnectors = props.onCrmConnectors;
      list.push({
        id: "crm",
        label: t("app.rail.crm"),
        icon: BriefcaseBusiness,
        open: onCrm,
        menu: onConnectors && [{ label: t("crm.connectors.title"), icon: Plug, open: onConnectors }],
      });
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
            <RailButton
              label={page().label}
              current={props.current === page().id}
              menu={[
                ...(page().menu ?? []),
                { label: t("sidebar.unpin"), icon: PinOff, open: () => props.onPinChange(page().id, false) },
              ]}
              onClick={page().open}
              onPreload={page().preload}
            >
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
          <For each={ringLayout().shown} keyed={(ring) => accountUsageRowKey(ring.row)}>
            {(ring) => <UsageRings row={ring().row} shared={ring().shared} onOpen={props.onUsage} />}
          </For>
          <Show when={ringLayout().more.length > 0}>
            <MoreUsageRings rings={ringLayout().more} onOpen={props.onUsage} />
          </Show>
          <For each={props.customAgentUsage ?? []} keyed={(row) => row.id}>
            {(row) => <CustomAgentUsageButton row={row()} onOpen={props.onUsage} />}
          </For>
          <For each={props.mediaCredits ?? []} keyed={(row) => row.key}>
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
        <div class="window-rail-server-slot">{props.server}</div>
      </div>
    </nav>
  );
}
