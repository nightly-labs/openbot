import {
  type InstalledSkill,
  type MarketplaceSkillSort,
  type MarketplaceSkillSummary,
  SKILL_CATEGORIES,
  type SkillCategory,
} from "@openbot/contracts/ipc";
import type { AppTextKey } from "@openbot/i18n";
import {
  Button,
  buttonVariants,
  ChevronDown,
  ChevronRight,
  DropdownMenu,
  Heading,
  IconButton,
  Input,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  SlidingTabs,
  Text,
} from "@openbot/ui";
import { SkillGradient } from "@openbot/ui/skill-gradient";
import { useText } from "@openbot/ui/text";
import type { JSX } from "@solidjs/web";
import { createEffect, createMemo, createStore, For, onCleanup, Show, untrack } from "solid-js";
import { DialogAgents, type DialogSkill } from "./MarketplaceAgentsDialog";
import { useInstalls } from "./MarketplaceCards";
import { ListingPanel, MenuCheck, SkillMark } from "./MarketplaceParts";
import { CATEGORY_LABELS, createMarketplaceListing } from "./marketplace-listing";
import type { MarketplaceModel } from "./marketplace-model";
import { moveView } from "./marketplace-motion";
import {
  agentsWith,
  bySort,
  matches,
  outdated,
  type SortKey,
  userSkills,
  useSkillWords,
} from "./marketplace-skill-state";
import {
  type MarketplaceNavigation,
  type MarketplaceScope,
  type SkillGroup,
  type SkillSource,
  sourceVerified,
} from "./marketplace-view";

/** A group on the Skills tab shows this many skills. "See all" opens the group on its own page. */
const GROUP_LIMIT = 6;
/** "Your skills" on its own page shows this many, and Load more adds this many. */
const PAGE_SIZE = 24;
/** A catalog group page starts with this many cards. */
const FEATURED_LIMIT = 3;

const SORTS: readonly MarketplaceSkillSort[] = ["installs", "updated", "name"];
const SORT_LABEL = {
  installs: "marketplace.skills.sort.installs",
  updated: "marketplace.skills.sort.updated",
  name: "marketplace.skills.sort.name",
} as const satisfies Record<MarketplaceSkillSort, AppTextKey>;

const SOURCES: readonly SkillSource[] = ["verified", "public"];
const SOURCE_LABEL = {
  verified: "marketplace.skills.source.verified",
  public: "marketplace.skills.source.public",
} as const satisfies Record<SkillSource, AppTextKey>;

function sourceOfValue(value: string): SkillSource | null {
  return SOURCES.find((source) => source === value) ?? null;
}

function groupLabel(group: SkillGroup): AppTextKey {
  return group === "yours" ? "marketplace.skills.yours" : CATEGORY_LABELS[group];
}

/**
 * The rows of the Skills tab and of a group page. "Your skills": the skills that the agents have, by
 * name. The catalog: the skills of `items` that no agent has, by category. A source shows only the
 * catalog skills of that source; a skill made on this computer then does not show.
 */
function createSkillRows(scope: MarketplaceScope, items: () => readonly MarketplaceSkillSummary[]) {
  const model = () => scope.model;
  const state = () => scope.nav.state;
  /* Each listing that a list brought, so a row of the user's keeps its icon and its source after a search. */
  const seen = new Map<string, MarketplaceSkillSummary>();
  /* The listings of the user's skills that no page brought: a page holds only the first skills of the catalog. */
  const [read, setRead] = createStore<{ listings: Record<string, MarketplaceSkillSummary> }>({ listings: {} });
  const listings = createMemo(() => {
    for (const listing of Object.values(read.listings)) seen.set(listing.id, listing);
    for (const listing of scope.skills.items()) seen.set(listing.id, listing);
    for (const listing of items()) seen.set(listing.id, listing);
    return new Map(seen);
  });
  const listingOf = (skillId: string) => listings().get(skillId);
  const fromSource = (skillId: string) => {
    const source = state().skillSource;
    if (source === null) return true;
    const listing = listingOf(skillId);
    return listing !== undefined && (listing.verified === true) === (source === "verified");
  };
  const owned = (skillId: string) => agentsWith(model(), skillId).length > 0;
  /** Each skill of the user's, with no source and no search. */
  const all = createMemo(() => userSkills(model(), scope.skills.items()));
  /* A skill made on this computer has no catalog source, so it needs no listing. Each skill is read once. */
  const asked = new Set<string>();
  createEffect(
    () => all().filter((skill) => skill.origin !== "local" && !asked.has(skill.skillId) && !listingOf(skill.skillId)),
    (missing) => {
      for (const skill of missing) {
        asked.add(skill.skillId);
        void model()
          .skillListing(skill.skillId)
          .then((listing) => {
            if (!listing) return;
            setRead((draft) => {
              draft.listings[listing.id] = listing;
            });
          });
      }
    },
  );
  const mine = createMemo(() =>
    all().filter(
      (skill) => fromSource(skill.skillId) && matches(state().query, `${skill.name} ${skill.description ?? ""}`),
    ),
  );
  /* The listing already holds only the source and the search. */
  const available = createMemo(() => items().filter((skill) => !owned(skill.id)));
  const byCategory = createMemo(() => {
    const groups = new Map<SkillCategory, MarketplaceSkillSummary[]>();
    for (const skill of available()) {
      const list = groups.get(skill.category);
      if (list) list.push(skill);
      else groups.set(skill.category, [skill]);
    }
    return SKILL_CATEGORIES.flatMap((category) => {
      const skills = groups.get(category);
      return skills ? [{ category, skills }] : [];
    });
  });
  const sortKey = (skill: InstalledSkill): SortKey => {
    const listing = listingOf(skill.skillId);
    return { name: skill.name, installs: listing?.installs ?? 0, updatedAt: listing?.updatedAt ?? "" };
  };
  /** A catalog skill opens its page. A skill with no loaded listing opens the page of the installed skill. */
  const open = (skillId: string) => {
    const listing = listingOf(skillId);
    // `go`, so that a skill opened from a group page goes back to it.
    scope.nav.go(listing ? { kind: "skill", listing } : { kind: "localSkill", skillId });
  };
  return { listingOf, all, mine, available, byCategory, sortKey, open };
}
type SkillRows = ReturnType<typeof createSkillRows>;

/** Update on each of the agents that has an older version. An icon: the row line already says "Update available". */
function UpdateButton(props: { model: MarketplaceModel; skill: DialogSkill; version: number | undefined }) {
  const { t } = useText();
  const old = () =>
    agentsWith(props.model, props.skill.id).filter((agent) =>
      outdated(props.model.installedSkill(agent.id, props.skill.id), props.version),
    );
  return (
    <Show when={old().length > 0}>
      <IconButton
        type="button"
        variant="outline"
        label={t("skill.updateName", { name: props.skill.name })}
        disabled={props.model.skillBusy(props.skill.id)}
        onClick={() =>
          void props.model.updateSkill(
            props.skill,
            old().map((agent) => agent.id),
          )
        }
      >
        <RefreshCw aria-hidden="true" />
      </IconButton>
    </Show>
  );
}

/** The shield after a verified skill's name. */
function VerifiedMark(props: { on: boolean }) {
  const { t } = useText();
  return (
    <Show when={props.on}>
      <ShieldCheck class="marketplace-skill-verified" aria-hidden="true" />
      <span class="marketplace-visually-hidden">{t("marketplace.skills.source.verified")}</span>
    </Show>
  );
}

/** One skill as an app row. The hit area opens the skill page; the actions go at the end. */
function LibraryRow(props: {
  name: string;
  iconUrl: string | null | undefined;
  verified: boolean;
  /** A state that asks the user to act. It replaces the resting line. */
  line: string | undefined;
  fallback: string;
  onOpen: () => void;
  children: JSX.Element;
}) {
  const { t } = useText();
  const mark = () => ({ iconUrl: props.iconUrl ?? null });
  return (
    <li class="marketplace-app-row marketplace-skill-row">
      <Button
        type="button"
        variant="ghost"
        class="marketplace-app-row-hit"
        aria-label={t("marketplace.open", { name: props.name })}
        onClick={props.onOpen}
      />
      <SkillMark skill={mark()} size="md" />
      <span class="marketplace-app-row-copy">
        <span class="marketplace-skill-name">
          <span class="marketplace-app-row-name">{props.name}</span>
          <VerifiedMark on={props.verified} />
        </span>
        <span class={{ "marketplace-app-row-tagline": true, "marketplace-skill-attention": props.line !== undefined }}>
          {props.line ?? props.fallback}
        </span>
      </span>
      <span class="marketplace-app-row-status marketplace-skill-row-actions">{props.children}</span>
    </li>
  );
}

function OwnRows(props: { scope: MarketplaceScope; rows: SkillRows; skills: readonly InstalledSkill[] }) {
  const words = useSkillWords(() => props.scope.model);
  const version = (skillId: string) => props.rows.listingOf(skillId)?.version;
  return (
    <ul class="marketplace-app-list marketplace-skill-list">
      <For each={props.skills} keyed={(skill) => skill.skillId}>
        {(skill) => (
          <LibraryRow
            name={skill().name}
            iconUrl={props.rows.listingOf(skill().skillId)?.iconUrl}
            verified={props.rows.listingOf(skill().skillId)?.verified === true}
            line={words.stateOn(skill().skillId, version(skill().skillId))}
            fallback={words.restingLine(skill())}
            onOpen={() => props.rows.open(skill().skillId)}
          >
            <UpdateButton
              model={props.scope.model}
              skill={{ id: skill().skillId, name: skill().name }}
              version={version(skill().skillId)}
            />
            <DialogAgents
              model={props.scope.model}
              skill={{
                id: skill().skillId,
                name: skill().name,
                iconUrl: props.rows.listingOf(skill().skillId)?.iconUrl,
              }}
            />
          </LibraryRow>
        )}
      </For>
    </ul>
  );
}

function CatalogRows(props: { scope: MarketplaceScope; rows: SkillRows; skills: readonly MarketplaceSkillSummary[] }) {
  return (
    <ul class="marketplace-app-list marketplace-skill-list">
      <For each={props.skills} keyed={(skill) => skill.id}>
        {(skill) => (
          <LibraryRow
            name={skill().name}
            iconUrl={skill().iconUrl}
            verified={skill().verified === true}
            line={undefined}
            fallback={skill().description}
            onOpen={() => props.rows.open(skill().id)}
          >
            <DialogAgents model={props.scope.model} skill={skill()} />
          </LibraryRow>
        )}
      </For>
    </ul>
  );
}

/** All, Verified or Public, at the top right of the Skills tab and of each group page. */
function SourceSwitch(props: { nav: MarketplaceNavigation }) {
  const { t } = useText();
  const value = () => props.nav.state.skillSource ?? "all";
  return (
    <SlidingTabs.Root
      value={value()}
      onChange={(value: string) =>
        moveView("swap", () =>
          props.nav.set((draft) => {
            draft.skillSource = sourceOfValue(value);
          }),
        )
      }
    >
      <SlidingTabs.List class="marketplace-skill-source" aria-label={t("marketplace.skills.sourceLabel")}>
        <SlidingTabs.Trigger value="all">{t("marketplace.skills.source.all")}</SlidingTabs.Trigger>
        <For each={SOURCES}>
          {(source) => (
            <SlidingTabs.Trigger value={source}>
              <Show when={source === "verified"}>
                <ShieldCheck aria-hidden="true" />
              </Show>
              {t(SOURCE_LABEL[source])}
            </SlidingTabs.Trigger>
          )}
        </For>
      </SlidingTabs.List>
    </SlidingTabs.Root>
  );
}

/** The search of the Marketplace. The Skills tab and its group pages share it. */
function SkillSearch(props: { nav: MarketplaceNavigation; label?: string | undefined }) {
  const { t } = useText();
  const label = () => props.label ?? t("marketplace.search.label");
  const placeholder = () => props.label ?? t("marketplace.search.placeholder");
  return (
    <label class="search-field marketplace-search">
      <Search aria-hidden="true" />
      <Input
        type="search"
        aria-label={label()}
        placeholder={placeholder()}
        value={props.nav.state.query}
        onInput={(event) => {
          const value = event.currentTarget.value;
          props.nav.set((draft) => {
            draft.query = value;
          });
        }}
      />
    </label>
  );
}

/** The head of a group: its name, the count of "Your skills", and "See all" when the group has more than it shows. */
function GroupHead(props: {
  id: string;
  label: string;
  count?: number | undefined;
  more: boolean;
  onSeeAll: () => void;
}) {
  const { t, format } = useText();
  return (
    <div class="marketplace-skill-group-head">
      <h4 id={props.id} class="marketplace-app-group-title">
        {props.label}
        <Show when={props.count}>
          {(count) => <span class="marketplace-app-group-count">{format.number(count())}</span>}
        </Show>
      </h4>
      <Show when={props.more}>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-label={t("marketplace.skills.seeAllName", { name: props.label })}
          onClick={props.onSeeAll}
        >
          {t("marketplace.skills.seeAll")}
          <ChevronRight aria-hidden="true" />
        </Button>
      </Show>
    </div>
  );
}

/** "Your skills" when the agents have none: what a skill is, and where to get one. */
function NoSkills() {
  const { t } = useText();
  return (
    <div class="marketplace-skill-empty">
      <SkillMark skill={{ iconUrl: null }} size="md" />
      <div>
        <Text as="p" variant="body">
          {t("marketplace.skills.none")}
        </Text>
        <Text as="p" variant="body-sm" tone="muted">
          {t("marketplace.skills.noneHint")}
        </Text>
      </div>
    </div>
  );
}

/** "Create skill": a chat in the open agent asks what the skill must do. */
function CreateSkill(props: { model: MarketplaceModel }) {
  const { t } = useText();
  const create = () => (props.model.agents().length > 0 ? props.model.createSkill : undefined);
  return (
    <Show when={create()}>
      {(create) => (
        <Button type="button" size="sm" variant="outline" onClick={() => create()(props.model.activeAgentId())}>
          <Plus aria-hidden="true" />
          {t("skill.toolbar.create")}
        </Button>
      )}
    </Show>
  );
}

/**
 * The Skills tab: "Your skills" first, with their actions in each row; then the catalog skills that no
 * agent has, by category. Each group shows its first 6 skills, also during a search; "See all" opens
 * the group page.
 */
export function SkillLibrary(props: { scope: MarketplaceScope; noMatch: JSX.Element }) {
  const { t } = useText();
  const nav = () => props.scope.nav;
  const model = () => props.scope.model;
  const rows = createSkillRows(props.scope, () => props.scope.skills.items());
  const searching = () => nav().state.query.trim() !== "";
  /* The empty state shows only to a user who can add skills and has none at all. */
  const showYours = () =>
    model().agents().length > 0 && (rows.mine().length > 0 || (!searching() && rows.all().length === 0));
  const seeAll = (group: SkillGroup) => nav().go({ kind: "skillGroup", group });
  /* The server can hold more skills of a category than the overview brought. */
  const more = (skills: readonly MarketplaceSkillSummary[]) =>
    skills.length > GROUP_LIMIT || props.scope.skills.hasMore();
  const shown = () => (showYours() ? rows.mine().length : 0) + rows.available().length;

  return (
    <div class="marketplace-view marketplace-browse">
      <header class="marketplace-browse-head">
        <div class="marketplace-skill-head-row">
          <div class="marketplace-browse-copy">
            <Heading as="h3" size="lg" class="marketplace-browse-title">
              {t("marketplace.tab.skills")}
            </Heading>
            <Text as="p" variant="body" tone="muted">
              {t("marketplace.description.skills")}
            </Text>
          </div>
          <SourceSwitch nav={nav()} />
        </div>
        <div class="marketplace-toolbar">
          <SkillSearch nav={nav()} />
          <CreateSkill model={model()} />
        </div>
      </header>
      <div class="marketplace-stack">
        <Show when={showYours()}>
          <section class="marketplace-app-group" aria-labelledby="marketplace-skills-yours">
            <GroupHead
              id="marketplace-skills-yours"
              label={t("marketplace.skills.yours")}
              count={rows.mine().length}
              more={rows.mine().length > GROUP_LIMIT}
              onSeeAll={() => seeAll("yours")}
            />
            <Show when={rows.mine().length > 0} fallback={<NoSkills />}>
              <OwnRows scope={props.scope} rows={rows} skills={rows.mine().slice(0, GROUP_LIMIT)} />
            </Show>
          </section>
        </Show>
        <ListingPanel
          listing={props.scope.skills}
          loadingLabel={t("marketplace.loading.skills")}
          count={shown()}
          paged={false}
          empty={props.noMatch}
        >
          <For each={rows.byCategory()} keyed={(group) => group.category}>
            {(group) => (
              <section class="marketplace-app-group" aria-labelledby={`marketplace-skills-${group().category}`}>
                <GroupHead
                  id={`marketplace-skills-${group().category}`}
                  label={t(CATEGORY_LABELS[group().category])}
                  more={more(group().skills)}
                  onSeeAll={() => seeAll(group().category)}
                />
                <CatalogRows scope={props.scope} rows={rows} skills={group().skills.slice(0, GROUP_LIMIT)} />
              </section>
            )}
          </For>
        </ListingPanel>
      </div>
    </div>
  );
}

/** "Most used ▾": one choice, as a menu beside the search. */
function SortMenu(props: { value: MarketplaceSkillSort; onChange: (value: MarketplaceSkillSort) => void }) {
  const { t } = useText();
  return (
    <DropdownMenu.Root placement="bottom-end" gutter={4}>
      <DropdownMenu.Trigger
        class={buttonVariants({ variant: "ghost", size: "sm" })}
        aria-label={t("marketplace.skills.sortName", { name: t(SORT_LABEL[props.value]) })}
      >
        {t(SORT_LABEL[props.value])}
        <ChevronDown aria-hidden="true" />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content class="marketplace-menu">
          <DropdownMenu.RadioGroup
            aria-label={t("marketplace.skills.sortLabel")}
            value={props.value}
            onChange={(value: string) => {
              const sort = SORTS.find((one) => one === value);
              if (sort) props.onChange(sort);
            }}
          >
            <For each={SORTS}>
              {(sort) => (
                <DropdownMenu.RadioItem value={sort} closeOnSelect>
                  <MenuCheck on={props.value === sort} />
                  {t(SORT_LABEL[sort])}
                </DropdownMenu.RadioItem>
              )}
            </For>
          </DropdownMenu.RadioGroup>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

/** The highlights of a group, as cards over their artwork. Each card opens the skill page. */
function FeaturedSkills(props: {
  scope: MarketplaceScope;
  rows: SkillRows;
  skills: readonly MarketplaceSkillSummary[];
}) {
  const { t } = useText();
  const installs = useInstalls();
  return (
    <section class="marketplace-skill-featured" aria-labelledby="marketplace-skills-featured">
      <h4 id="marketplace-skills-featured" class="marketplace-app-group-title">
        {t("marketplace.skills.featured")}
      </h4>
      <div class="marketplace-skill-featured-grid">
        <For each={props.skills} keyed={(skill) => skill.id}>
          {(skill) => (
            <article
              class="marketplace-card marketplace-skill-feature"
              aria-labelledby={`marketplace-skill-feature-${skill().id}`}
            >
              <Button
                type="button"
                variant="ghost"
                class="marketplace-hitarea"
                aria-label={t("marketplace.open", { name: skill().name })}
                onClick={() => props.rows.open(skill().id)}
              />
              <div class="marketplace-skill-feature-art">
                <SkillGradient name={skill().name} />
                <SkillMark skill={skill()} size="md" />
              </div>
              <div class="marketplace-card-head">
                <Heading as="h5" size="sm" class="marketplace-card-name" id={`marketplace-skill-feature-${skill().id}`}>
                  {skill().name}
                  <VerifiedMark on={skill().verified === true} />
                </Heading>
                <div class="marketplace-card-action">
                  <DialogAgents model={props.scope.model} skill={skill()} />
                </div>
              </div>
              <Text as="p" variant="body-sm" class="marketplace-card-body">
                {skill().description}
              </Text>
              <div class="marketplace-card-foot">
                <Text as="span" variant="caption" tone="muted">
                  {`${skill().creatorName} · ${installs(skill().installs)}`}
                </Text>
              </div>
            </article>
          )}
        </For>
      </div>
    </section>
  );
}

/**
 * The featured skills of one category: the catalog's own picks with the most uses. A category with no
 * pick, or a failed read, shows the loaded skills with the most uses. No agent has a skill that shows.
 */
function createFeatured(
  scope: MarketplaceScope,
  category: SkillCategory,
  available: () => readonly MarketplaceSkillSummary[],
) {
  const [state, setState] = createStore<{ picks: MarketplaceSkillSummary[] }>({ picks: [] });
  let version = 0;
  onCleanup(() => {
    version++;
  });
  createEffect(
    () => sourceVerified(scope.nav.state.skillSource),
    (verified) => {
      const current = ++version;
      void untrack(() =>
        scope.model.listSkills({
          featured: true,
          category,
          ...(verified === undefined ? {} : { verified }),
          sort: "installs",
          limit: FEATURED_LIMIT,
        }),
      ).then(
        (page) => {
          if (current === version)
            setState((draft) => {
              draft.picks = page.items;
            });
        },
        () => {
          if (current === version)
            setState((draft) => {
              draft.picks = [];
            });
        },
      );
    },
  );
  return createMemo(() => {
    const owned = (skillId: string) => agentsWith(scope.model, skillId).length > 0;
    const picks = state.picks.filter((skill) => !owned(skill.id));
    if (picks.length > 0) return picks.slice(0, FEATURED_LIMIT);
    return [...available()].sort(bySort("installs")).slice(0, FEATURED_LIMIT);
  });
}

/** The catalog skills of one category on its own page, from the server in pages. */
function CategoryPage(props: { scope: MarketplaceScope; category: SkillCategory }) {
  const { t } = useText();
  const category = untrack(() => props.category);
  const nav = () => props.scope.nav;
  const listing = createMarketplaceListing({
    list: (query) => props.scope.model.listSkills(query),
    query: () => nav().state.query,
    category: () => category,
    sort: () => nav().state.skillSort,
    verified: () => sourceVerified(nav().state.skillSource),
  });
  const rows = createSkillRows(props.scope, () => listing.items());
  const pickedFeatured = createFeatured(props.scope, category, rows.available);
  const featured = () => (nav().state.query.trim() === "" ? pickedFeatured() : []);
  const listed = createMemo(() => {
    const above = new Set(featured().map((skill) => skill.id));
    return rows.available().filter((skill) => !above.has(skill.id));
  });
  return (
    <ListingPanel
      listing={listing}
      loadingLabel={t("marketplace.loading.skills")}
      count={rows.available().length}
      empty={
        <Text as="p" variant="body" tone="muted">
          {t("marketplace.noMatch.skills")}
        </Text>
      }
    >
      <Show when={featured().length > 0}>
        <FeaturedSkills scope={props.scope} rows={rows} skills={featured()} />
      </Show>
      <Show when={listed().length > 0}>
        <section class="marketplace-skill-group-list" aria-label={t(CATEGORY_LABELS[category])}>
          <Show when={featured().length > 0}>
            <h4 class="marketplace-app-group-title">{t("marketplace.skills.all")}</h4>
          </Show>
          <CatalogRows scope={props.scope} rows={rows} skills={listed()} />
        </section>
      </Show>
    </ListingPanel>
  );
}

/** Each skill of the user's on one page, in the chosen order, 24 more at a time. */
function YoursPage(props: { scope: MarketplaceScope; rows: SkillRows }) {
  const { t } = useText();
  const rows = untrack(() => props.rows);
  const [page, setPage] = createStore({ shown: PAGE_SIZE });
  const sorted = createMemo(() => {
    const order = bySort(props.scope.nav.state.skillSort);
    return rows
      .mine()
      .map((skill) => ({ skill, key: rows.sortKey(skill) }))
      .sort((left, right) => order(left.key, right.key))
      .map((one) => one.skill);
  });
  return (
    <Show
      when={sorted().length > 0}
      fallback={
        <Text as="p" variant="body" tone="muted">
          {t("marketplace.noMatch.skills")}
        </Text>
      }
    >
      <section class="marketplace-skill-group-list" aria-label={t("marketplace.skills.yours")}>
        <OwnRows scope={props.scope} rows={rows} skills={sorted().slice(0, page.shown)} />
        <Show when={sorted().length > page.shown}>
          <Button
            type="button"
            variant="outline"
            class="marketplace-load-more"
            data-cuelume-tap="navigate"
            onClick={() =>
              setPage((draft) => {
                draft.shown += PAGE_SIZE;
              })
            }
          >
            {t("marketplace.loadMore")}
          </Button>
        </Show>
      </section>
    </Show>
  );
}

/**
 * One group on its own page, for a catalog of thousands. A category starts with three featured cards,
 * so the page does not start as a flat list; a search hides them. Then the rest in two columns, as on
 * the Skills tab. The search and the sort stay at the top while the list scrolls.
 */
export function SkillGroupPage(props: { scope: MarketplaceScope; group: SkillGroup }) {
  const { t } = useText();
  const group = untrack(() => props.group);
  const nav = () => props.scope.nav;
  const label = () => t(groupLabel(group));
  const category = (): SkillCategory | undefined => (group === "yours" ? undefined : group);
  const yours = createSkillRows(props.scope, () => props.scope.skills.items());
  const sortBy = (sort: MarketplaceSkillSort) =>
    moveView("swap", () =>
      nav().set((draft) => {
        draft.skillSort = sort;
      }),
    );
  // An effect, not `onSettled`: the read goes through the owner's props, which `onSettled` refuses.
  createEffect(
    () => props.group,
    () => props.scope.model.readSkills(),
  );

  return (
    <div class="marketplace-view marketplace-browse marketplace-skill-group-page">
      <header class="marketplace-skill-head-row">
        <div class="marketplace-browse-copy">
          <Heading as="h3" size="lg" class="marketplace-browse-title">
            {label()}
          </Heading>
          {/* A catalog group has no total: the server sends pages. */}
          <Show when={group === "yours"}>
            <Text as="p" variant="body" tone="muted">
              {t("marketplace.skills.count", { count: yours.mine().length })}
            </Text>
          </Show>
        </div>
        <SourceSwitch nav={nav()} />
      </header>
      <div class="marketplace-toolbar marketplace-skill-group-bar">
        <SkillSearch nav={nav()} label={t("marketplace.skills.searchIn", { name: label() })} />
        <SortMenu value={nav().state.skillSort} onChange={sortBy} />
      </div>
      <Show when={category()} keyed fallback={<YoursPage scope={props.scope} rows={yours} />}>
        {(chosen) => <CategoryPage scope={props.scope} category={chosen} />}
      </Show>
    </div>
  );
}
