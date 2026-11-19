import {
  REFERRAL_FILTERS,
  REFERRAL_PAGE_SIZE,
  REFERRAL_SHARE_PERCENT,
  type ReferralFilter,
  type ReferralFriend,
  type ReferralFriendStatus,
  type ReferralMoney,
  type ReferralState,
} from "@openbot/contracts/referral";
import type { AppTextKey } from "@openbot/i18n";
import {
  Alert,
  AlertActions,
  AlertContent,
  AlertDescription,
  AlertIcon,
  Badge,
  Button,
  ChevronLeft,
  ChevronRight,
  Copy,
  Gift,
  IconButton,
  Input,
  Item,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
  PlushLoader,
  Progress,
  SettingsSection,
  SlidingTabs,
  Spinner,
  Text,
  TriangleAlert,
  toast,
  UserRound,
} from "@openbot/ui";
import { PlushMascot } from "@openbot/ui/plush-loader";
import type { JSX } from "@solidjs/web";
import { For, Match, Show, Switch } from "solid-js";
import { useText } from "../../text";
import { formatMinorMoney } from "../billing/money";
import type { ReferralStore } from "./referral-store";

const FILTER_LABEL = {
  all: "billing.referral.filter.all",
  paying: "billing.referral.filter.paying",
  "no-plan": "billing.referral.filter.noPlan",
  stopped: "billing.referral.filter.stopped",
} as const satisfies Record<ReferralFilter, AppTextKey>;

const FILTER_EMPTY = {
  all: "billing.referral.empty.all",
  paying: "billing.referral.empty.paying",
  "no-plan": "billing.referral.empty.noPlan",
  stopped: "billing.referral.empty.stopped",
} as const satisfies Record<ReferralFilter, AppTextKey>;

const STATUS_BADGE = {
  paying: "success-light",
  "no-plan": "secondary",
  stopped: "warning-light",
} as const satisfies Record<ReferralFriendStatus, string>;

export interface ReferralPanelProps {
  store: ReferralStore;
  /** False when this surface has no invite calls. */
  available: boolean;
}

/**
 * The Invite friends content of the desktop Settings tab and the web dialog: the split of each payment,
 * the invite link, the credit, and the friends who joined, 20 on each page. It shows no plan or amount
 * of a friend: only the status and the total credit of the reader.
 */
export function ReferralPanel(props: ReferralPanelProps): JSX.Element {
  const { t } = useText();
  const referral = () => props.store.state.referral;
  const unavailable = () => !props.available || referral()?.available === false;

  return (
    <div class="referral-panel" aria-busy={props.store.state.loading ? "true" : undefined}>
      <Switch>
        <Match when={unavailable()}>
          <Text tone="muted">{t("billing.referral.unavailable")}</Text>
        </Match>
        <Match when={referral()}>
          {(state) => (
            <>
              <ReferralSplit />
              <Show when={props.store.state.error}>
                {(message) => <ReferralError message={message()} store={props.store} />}
              </Show>
              <LinkAndCredit state={state()} />
              <FriendList state={state()} store={props.store} />
            </>
          )}
        </Match>
        <Match when={props.store.state.error}>
          {(message) => <ReferralError message={message()} store={props.store} />}
        </Match>
        <Match when>
          <div class="billing-loading">
            <PlushLoader size={48} label={t("billing.referral.loading")} />
          </div>
        </Match>
      </Switch>
    </div>
  );
}

/**
 * The split, on the right of the page title and "Your link": the plush, a fork, and one chip on each row.
 * It plays once when the panel opens.
 */
function ReferralSplit(): JSX.Element {
  const { t, format } = useText();
  const percent = () => format.percent(REFERRAL_SHARE_PERCENT / 100);
  return (
    <div class="referral-split">
      <span class="referral-fork" role="img" aria-label={t("billing.referral.split", { percent: percent() })}>
        <PlushMascot face="happy" />
        <span class="referral-fork-stem" />
        <span class="referral-fork-branches">
          <span data-side="friend" />
          <span data-side="you" />
        </span>
        <span class="referral-fork-rows">
          <span class="referral-chip" data-side="friend">
            <UserRound />
            <span>{t("billing.referral.split.friend", { percent: percent() })}</span>
          </span>
          <span class="referral-chip" data-side="you">
            <Gift />
            <span>{t("billing.referral.split.you", { percent: percent() })}</span>
          </span>
        </span>
      </span>
    </div>
  );
}

function moneyList(format: ReturnType<typeof useText>["format"], items: readonly ReferralMoney[]): string {
  return format.list(items.map((item) => formatMinorMoney(format, item.amountMinor, item.currency)));
}

function LinkAndCredit(props: { state: ReferralState }): JSX.Element {
  const { t, format } = useText();
  const credit = () => props.state.credit.filter((item) => item.amountMinor > 0);
  const earned = () => props.state.earned.filter((item) => item.amountMinor > 0);
  const pending = () => props.state.pending.filter((item) => item.amountMinor > 0);
  /** The waiting credit and the part of it that collects to the minimum, for each currency. */
  const waiting = () => {
    const rows = new Map<ReferralMoney["currency"], { total: number; ready: number }>();
    for (const item of pending()) rows.set(item.currency, { total: item.amountMinor, ready: 0 });
    for (const item of props.state.ready) {
      if (item.amountMinor <= 0) continue;
      const row = rows.get(item.currency) ?? { total: 0, ready: 0 };
      rows.set(item.currency, { total: row.total + item.amountMinor, ready: item.amountMinor });
    }
    return [...rows].map(([currency, row]) => ({
      currency,
      ...row,
      minimum: props.state.minimum.find((item) => item.currency === currency)?.amountMinor ?? 0,
    }));
  };

  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(props.state.link);
      toast.success(t("billing.referral.link.copied"));
    } catch {
      toast.error(t("billing.referral.link.copyFailed"));
    }
  }

  return (
    <SettingsSection title={t("billing.referral.link.title")}>
      <div class="billing-license">
        <div class="referral-link">
          <Input
            readonly
            value={props.state.link}
            aria-label={t("billing.referral.link.label")}
            onFocus={(event) => event.currentTarget.select()}
          />
          <Button type="button" variant="outline" onClick={() => void copy()}>
            <Copy aria-hidden="true" />
            {t("billing.referral.link.copy")}
          </Button>
        </div>
        <ItemGroup>
          <dl class="referral-credit">
            <div>
              <dt>{t("billing.referral.credit.title")}</dt>
              <dd class="referral-credit-amount">
                {credit().length > 0 ? moneyList(format, credit()) : t("billing.referral.credit.none")}
              </dd>
              <dd>
                {credit().length > 0 || pending().length > 0
                  ? t("billing.referral.credit.next")
                  : t("billing.referral.credit.empty")}
              </dd>
            </div>
            <Show when={waiting().length > 0}>
              <div>
                <dt>{t("billing.referral.credit.pendingTitle")}</dt>
                <dd class="referral-credit-amount">
                  {moneyList(
                    format,
                    waiting().map((item) => ({ currency: item.currency, amountMinor: item.total })),
                  )}
                </dd>
                <For each={waiting().filter((item) => item.minimum > 0)}>
                  {(item) => {
                    const money = (amountMinor: number) => formatMinorMoney(format, amountMinor, item.currency);
                    const text = () =>
                      t("billing.referral.credit.progress", {
                        ready: money(item.ready),
                        minimum: money(item.minimum),
                      });
                    return (
                      <dd class="referral-credit-progress">
                        <Progress value={Math.min(100, (item.ready / item.minimum) * 100)} aria-label={text()} />
                        {text()}
                      </dd>
                    );
                  }}
                </For>
                <dd>{t("billing.referral.credit.pending")}</dd>
              </div>
            </Show>
            <div>
              <dt>{t("billing.referral.credit.earnedTitle")}</dt>
              <dd class="referral-credit-amount">
                {earned().length > 0 ? moneyList(format, earned()) : t("billing.referral.credit.none")}
              </dd>
            </div>
          </dl>
        </ItemGroup>
      </div>
    </SettingsSection>
  );
}

function FriendsTitle(props: { count: number }): JSX.Element {
  const { t, format } = useText();
  return (
    <span class="referral-friends-title">
      {t("billing.referral.friends.title")}
      <Badge variant="secondary">{format.number(props.count)}</Badge>
    </span>
  );
}

function EmptyRow(props: { text: string }): JSX.Element {
  return (
    <Item class="referral-empty-row">
      <ItemContent>
        <ItemDescription>{props.text}</ItemDescription>
      </ItemContent>
    </Item>
  );
}

function FriendRow(props: { friend: ReferralFriend }): JSX.Element {
  const { t, format } = useText();
  const date = (value: number) => format.date(value, { dateStyle: "medium" });
  const detail = () => {
    const friend = props.friend;
    if (friend.status === "paying" && friend.paidSince !== null) {
      return t("billing.referral.friend.paying", { date: date(friend.joinedAt), since: date(friend.paidSince) });
    }
    if (friend.status === "stopped" && friend.stoppedAt !== null) {
      return t("billing.referral.friend.stopped", { date: date(friend.joinedAt), stopped: date(friend.stoppedAt) });
    }
    return t("billing.referral.friend.joined", { date: date(friend.joinedAt) });
  };
  return (
    <Item>
      <ItemContent>
        <ItemTitle>{props.friend.name || t("billing.referral.friend.unnamed")}</ItemTitle>
        <ItemDescription>{detail()}</ItemDescription>
      </ItemContent>
      <FriendCredit friend={props.friend} />
      <Badge variant={STATUS_BADGE[props.friend.status]}>{t(FILTER_LABEL[props.friend.status])}</Badge>
    </Item>
  );
}

/** The credit from one friend: what went to the account, and what waits for the friend's next payment. */
function FriendCredit(props: { friend: ReferralFriend }): JSX.Element {
  const { t, format } = useText();
  const earned = () => props.friend.earned.filter((item) => item.amountMinor > 0);
  const pending = () => props.friend.pending.filter((item) => item.amountMinor > 0);
  return (
    <Show when={earned().length > 0 || pending().length > 0}>
      <span class="referral-friend-credit">
        <Show when={earned().length > 0}>
          <span class="referral-friend-earned">
            {t("billing.referral.friend.earned", { amount: moneyList(format, earned()) })}
          </span>
        </Show>
        <Show when={pending().length > 0}>
          <span>{t("billing.referral.friend.pending", { amount: moneyList(format, pending()) })}</span>
        </Show>
      </span>
    </Show>
  );
}

/**
 * Previous and next page, and which friends the page shows. Only when the list has more than one page.
 * The buttons stay active during a load: a window-focus reload must not lock them, and the store drops the
 * result of a page that the reader left.
 */
function PageControls(props: {
  page: number;
  total: number;
  onPage: (page: number, from: HTMLElement) => void;
}): JSX.Element {
  const { t, format } = useText();
  const pages = () => Math.ceil(props.total / REFERRAL_PAGE_SIZE);
  const first = () => props.page * REFERRAL_PAGE_SIZE + 1;
  const last = () => Math.min((props.page + 1) * REFERRAL_PAGE_SIZE, props.total);
  return (
    <Show when={pages() > 1}>
      <nav class="referral-pages" aria-label={t("billing.referral.pages.label")}>
        <Text as="span" variant="label" tone="secondary" aria-live="polite">
          {t("billing.referral.pages.range", {
            first: format.number(first()),
            last: format.number(last()),
            total: format.number(props.total),
          })}
        </Text>
        <div class="referral-pages-buttons">
          <IconButton
            variant="outline"
            label={t("billing.referral.pages.previous")}
            disabled={props.page === 0}
            onClick={(event) => props.onPage(props.page - 1, event.currentTarget)}
          >
            <ChevronLeft aria-hidden="true" />
          </IconButton>
          <IconButton
            variant="outline"
            label={t("billing.referral.pages.next")}
            disabled={props.page >= pages() - 1}
            onClick={(event) => props.onPage(props.page + 1, event.currentTarget)}
          >
            <ChevronRight aria-hidden="true" />
          </IconButton>
        </div>
      </nav>
    </Show>
  );
}

/**
 * One list of friends, newest first. A filter above it shows all friends or one status. The account
 * server sends one page of 20; a new filter starts again at the first page.
 */
function FriendList(props: { state: ReferralState; store: ReferralStore }): JSX.Element {
  const { t } = useText();
  const request = () => props.store.state.request;
  // The rows of the chosen filter and page. While they load, the list shows a spinner, not the rows of another filter.
  const loaded = (filter: ReferralFilter) =>
    props.state.filter === filter && props.state.page === request().page && request().filter === filter;
  const turnPage = (page: number, from: HTMLElement) => {
    props.store.turnPage(page);
    // The new page starts at the top of the list, with the filter in view, not where the old page ended.
    from.closest(".ui-settings-section")?.scrollIntoView({ block: "start" });
  };

  return (
    <Show
      when={props.state.counts.all > 0}
      fallback={
        <SettingsSection title={<FriendsTitle count={0} />}>
          <ItemGroup class="settings-modal-card referral-list-card">
            <EmptyRow text={t("billing.referral.empty.all")} />
          </ItemGroup>
        </SettingsSection>
      }
    >
      <SlidingTabs.Root
        value={request().filter}
        onChange={(value) => {
          const filter = REFERRAL_FILTERS.find((item) => item === value);
          if (filter) props.store.choose(filter);
        }}
      >
        <SettingsSection
          title={<FriendsTitle count={props.state.counts.all} />}
          actions={
            <SlidingTabs.List aria-label={t("billing.referral.filter.label")}>
              <For each={REFERRAL_FILTERS}>
                {(filter) => <SlidingTabs.Trigger value={filter}>{t(FILTER_LABEL[filter])}</SlidingTabs.Trigger>}
              </For>
            </SlidingTabs.List>
          }
        >
          <SlidingTabs.ContentSlot>
            <For each={REFERRAL_FILTERS}>
              {(filter) => (
                <SlidingTabs.Content value={filter}>
                  <div class="referral-list">
                    <ItemGroup class="settings-modal-card referral-list-card">
                      <Show
                        when={loaded(filter)}
                        fallback={
                          <Item class="referral-empty-row">
                            <ItemContent>
                              <Spinner size="sm" label={t("billing.referral.loading")} />
                            </ItemContent>
                          </Item>
                        }
                      >
                        <Show
                          when={props.state.friends.length > 0}
                          fallback={<EmptyRow text={t(FILTER_EMPTY[filter])} />}
                        >
                          <For each={props.state.friends}>{(friend) => <FriendRow friend={friend} />}</For>
                        </Show>
                      </Show>
                    </ItemGroup>
                    <PageControls page={request().page} total={props.state.counts[filter]} onPage={turnPage} />
                  </div>
                </SlidingTabs.Content>
              )}
            </For>
          </SlidingTabs.ContentSlot>
        </SettingsSection>
      </SlidingTabs.Root>
    </Show>
  );
}

function ReferralError(props: { message: string; store: ReferralStore }): JSX.Element {
  const { t } = useText();
  return (
    <Alert tone="danger" role="alert">
      <AlertIcon>
        <TriangleAlert aria-hidden="true" />
      </AlertIcon>
      <AlertContent>
        <AlertDescription>{props.message}</AlertDescription>
      </AlertContent>
      <AlertActions>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={props.store.state.loading}
          onClick={() => void props.store.load()}
        >
          {t("common.retry")}
        </Button>
      </AlertActions>
    </Alert>
  );
}
