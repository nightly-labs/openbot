import type { CreditActivityEntry, CreditsState } from "@openbot/contracts/credits";
import {
  ArrowDown,
  ArrowUp,
  Badge,
  Button,
  CreditCard,
  Gift,
  Hourglass,
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
  RotateCcw,
  SettingsSection,
  SlidingTabs,
  Text,
} from "@openbot/ui";
import type { JSX } from "@solidjs/web";
import { createMemo, createSignal, For, Match, Show, Switch } from "solid-js";
import { useText } from "../../text";
import { CreditIcon } from "./CreditIcon";
import type { CreditsStore } from "./credits-store";
import { creditModelMakerNamed, MakerLogo } from "./MakerLogo";

type ActivityFilter = "all" | "used" | "added";

const FILTERS: readonly string[] = ["all", "used", "added"];
const RECENT_LIMIT = 6;

function isActivityFilter(value: string): value is ActivityFilter {
  return FILTERS.includes(value);
}

function matchesFilter(entry: CreditActivityEntry, filter: ActivityFilter): boolean {
  if (filter === "used") return entry.kind === "generation" || entry.credits < 0;
  if (filter === "added") return entry.credits > 0;
  return true;
}

function sameDay(left: number, right: number): boolean {
  return new Date(left).toDateString() === new Date(right).toDateString();
}

function ActivityIcon(props: { entry: CreditActivityEntry }): JSX.Element {
  const maker = () => (props.entry.maker ? creditModelMakerNamed(props.entry.maker) : undefined);
  return (
    <span class="credit-activity-icon" aria-hidden="true">
      <Switch fallback={<CreditIcon />}>
        <Match when={props.entry.kind === "generation" && maker()}>
          {(found) => <MakerLogo maker={found()} mono />}
        </Match>
        <Match when={props.entry.kind === "purchase"}>
          <CreditCard />
        </Match>
        <Match when={props.entry.kind === "move" && props.entry.credits < 0}>
          <ArrowUp />
        </Match>
        <Match when={props.entry.kind === "move"}>
          <ArrowDown />
        </Match>
        <Match when={props.entry.kind === "free"}>
          <Gift />
        </Match>
        <Match when={props.entry.kind === "expired"}>
          <Hourglass />
        </Match>
        <Match when={props.entry.kind === "refund"}>
          <RotateCcw />
        </Match>
      </Switch>
    </span>
  );
}

function StatusBadge(props: { entry: CreditActivityEntry }): JSX.Element {
  const { t } = useText();
  return (
    <Switch>
      <Match when={props.entry.status === "running"}>
        <Badge variant="info-light">{t("billing.credits.activity.running")}</Badge>
      </Match>
      <Match when={props.entry.status === "failed"}>
        <Badge variant="warning-light">{t("billing.credits.activity.failed")}</Badge>
      </Match>
      <Match when={props.entry.status === "canceled"}>
        <Badge variant="warning-light">{t("billing.credits.activity.canceled")}</Badge>
      </Match>
    </Switch>
  );
}

function ActivityAmount(props: { entry: CreditActivityEntry }): JSX.Element {
  const { t, format } = useText();
  const text = () => {
    const amount = format.number(Math.abs(props.entry.credits));
    if (props.entry.credits > 0) return t("billing.credits.activity.plus", { amount });
    if (props.entry.credits < 0) return t("billing.credits.activity.minus", { amount });
    return amount;
  };
  return (
    <span
      class="credit-activity-amount"
      data-positive={props.entry.credits > 0 ? "" : undefined}
      data-pending={props.entry.status === "running" ? "" : undefined}
    >
      {text()}
    </span>
  );
}

function ActivityRow(props: { entry: CreditActivityEntry; credits: CreditsState; now: number }): JSX.Element {
  const { t, format } = useText();
  const serverName = (serverId: string) =>
    props.credits.servers.find((server) => server.serverId === serverId)?.name ??
    t("billing.credits.activity.someServer");
  const counterpart = () => {
    if (props.entry.otherServerId) return serverName(props.entry.otherServerId);
    return props.entry.actor === "you"
      ? t("billing.credits.activity.yourCredits")
      : t("billing.credits.activity.ownerCredits");
  };
  const title = () => {
    const entry = props.entry;
    switch (entry.kind) {
      case "generation":
        return entry.modelName ?? t("billing.credits.activity.generation");
      case "purchase":
        return t("billing.credits.activity.bought");
      case "free":
        return t("billing.credits.activity.free");
      case "expired":
        return t("billing.credits.activity.expired");
      case "refund":
        return t("billing.credits.activity.refund");
      case "move":
        return entry.credits < 0
          ? t("billing.credits.activity.movedTo", { name: counterpart() })
          : t("billing.credits.activity.movedFrom", { name: counterpart() });
    }
  };
  const actor = () => {
    const entry = props.entry;
    if (entry.actor === "you") return t("billing.credits.you");
    if (entry.actor === "openbot") return t("billing.credits.activity.openbot");
    return entry.actorName ?? t("billing.credits.activity.member");
  };
  const wallet = () => (props.entry.serverId ? serverName(props.entry.serverId) : t("billing.credits.yours"));
  const when = () =>
    sameDay(props.entry.at, props.now)
      ? format.date(props.entry.at, { hour: "numeric", minute: "2-digit" })
      : format.date(props.entry.at, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  return (
    <Item size="compact" role="listitem">
      <ItemMedia>
        <ActivityIcon entry={props.entry} />
      </ItemMedia>
      <ItemContent>
        <ItemTitle class="credit-activity-title">
          {title()}
          <StatusBadge entry={props.entry} />
        </ItemTitle>
        <ItemDescription>
          {t("billing.credits.activity.line", { actor: actor(), wallet: wallet(), time: when() })}
        </ItemDescription>
      </ItemContent>
      <ItemActions>
        <ActivityAmount entry={props.entry} />
      </ItemActions>
    </Item>
  );
}

export function CreditActivitySection(props: { store: CreditsStore }): JSX.Element {
  const { t } = useText();
  const [filter, setFilter] = createSignal<ActivityFilter>("all");
  const [expanded, setExpanded] = createSignal(false);
  const credits = () => {
    const state = props.store.state.credits;
    return state?.available ? state : null;
  };
  const rows = createMemo(() =>
    (props.store.state.activity?.entries ?? []).filter((entry) => matchesFilter(entry, filter())),
  );
  const shown = () => (expanded() ? rows() : rows().slice(0, RECENT_LIMIT));
  const visible = () => props.store.state.activity !== null || props.store.state.activityFailed;
  const now = Date.now();

  return (
    <Show when={visible() && credits()}>
      {(state) => (
        <SettingsSection
          title={t("billing.credits.activity.title")}
          actions={
            <SlidingTabs.Root value={filter()} onChange={(value) => isActivityFilter(value) && setFilter(value)}>
              <SlidingTabs.List aria-label={t("billing.credits.activity.filterLabel")}>
                <SlidingTabs.Trigger value="all">{t("billing.credits.activity.all")}</SlidingTabs.Trigger>
                <SlidingTabs.Trigger value="used">{t("billing.credits.activity.used")}</SlidingTabs.Trigger>
                <SlidingTabs.Trigger value="added">{t("billing.credits.activity.added")}</SlidingTabs.Trigger>
              </SlidingTabs.List>
            </SlidingTabs.Root>
          }
        >
          <Switch>
            <Match when={props.store.state.activity === null}>
              <Text variant="caption" tone="muted">
                {t("billing.credits.activity.loadFailed")}
              </Text>
            </Match>
            <Match when={rows().length === 0}>
              <Text variant="caption" tone="muted">
                {t("billing.credits.activity.empty")}
              </Text>
            </Match>
            <Match when={rows().length > 0}>
              <ItemGroup class="settings-modal-card" role="list">
                <For each={shown()} keyed={(entry) => entry.id}>
                  {(entry) => <ActivityRow entry={entry()} credits={state()} now={now} />}
                </For>
              </ItemGroup>
              <Show when={rows().length > RECENT_LIMIT}>
                <Button variant="ghost" size="sm" class="credit-activity-more" onClick={() => setExpanded(!expanded())}>
                  {expanded()
                    ? t("billing.credits.activity.less")
                    : t("billing.credits.activity.more", { count: rows().length - RECENT_LIMIT })}
                </Button>
              </Show>
            </Match>
          </Switch>
        </SettingsSection>
      )}
    </Show>
  );
}
