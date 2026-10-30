import {
  type MarketplaceAgentSummary,
  type MarketplaceSkillSort,
  type MarketplaceSkillSummary,
  type McpServerConfig,
  SKILL_CATEGORIES,
  type SkillCategory,
} from "@openbot/contracts/ipc";
import { errorReference } from "@openbot/user-errors";
import { createStore, onCleanup, onSettled, untrack } from "solid-js";
import type { MarketplaceListing } from "./marketplace-listing";
import type { MarketplaceApp, MarketplaceModel } from "./marketplace-model";

export type MarketplaceView =
  | { kind: "browse" }
  | { kind: "agent"; listing: MarketplaceAgentSummary }
  | { kind: "skill"; listing: MarketplaceSkillSummary }
  | { kind: "app"; id: string }
  /** "Your skills" or one catalog category, on its own page. */
  | { kind: "skillGroup"; group: SkillGroup }
  /** A skill made on this computer. It has no catalog listing. */
  | { kind: "localSkill"; skillId: string };

/** "Your skills", or a catalog category. */
export type SkillGroup = "yours" | SkillCategory;

/** Which catalog skills the Skills tab shows. No source shows all of them. */
export type SkillSource = "verified" | "public";

export type MarketplaceTab = "apps" | "agents" | "skills";

/** The kinds, in the order of the side panel. */
export const MARKETPLACE_TABS: readonly MarketplaceTab[] = ["apps", "agents", "skills"];

/** The name of each tab. The header names the browse view after its tab. */
export const MARKETPLACE_TAB_LABEL = {
  agents: "marketplace.tab.agents",
  apps: "marketplace.tab.apps",
  skills: "marketplace.tab.skills",
} as const satisfies Record<MarketplaceTab, string>;

/** "yes": only what the user has. "no": only what the user does not have. */
export type OwnedFilter = "yes" | "no";

export interface MarketplaceNavigationState {
  /** The views the user went through. The first is always the browse view. */
  stack: MarketplaceView[];
  tab: MarketplaceTab;
  query: string;
  agentCategory: SkillCategory | null;
  agentsOwned: OwnedFilter | null;
  /** The order of a skill group page. */
  skillSort: MarketplaceSkillSort;
  skillSource: SkillSource | null;
  /** The slug of a link that names no app of this catalog. */
  missingApp: string | null;
}

/** The `verified` value of a catalog query for a source. */
export function sourceVerified(source: SkillSource | null): boolean | undefined {
  if (source === null) return undefined;
  return source === "verified";
}

export interface MarketplaceNavigation {
  state: MarketplaceNavigationState;
  set: (change: (draft: MarketplaceNavigationState) => void) => void;
  go: (view: MarketplaceView) => void;
  back: () => void;
  /** Goes back to the view at `index` of the stack. */
  backTo: (index: number) => void;
  /** The list of a kind, or a page on top of it. The search stays. */
  show: (tab: MarketplaceTab, view?: MarketplaceView) => void;
  /** The browse view on its first tab, with no search and no filter. */
  reset: () => void;
}

function initialState(): MarketplaceNavigationState {
  return {
    stack: [{ kind: "browse" }],
    tab: "apps",
    query: "",
    agentCategory: null,
    agentsOwned: null,
    skillSort: "installs",
    skillSource: null,
    missingApp: null,
  };
}

/** What each part of the window reads: the data and actions, where the user is, and the two listings. */
export interface MarketplaceScope {
  model: MarketplaceModel;
  nav: MarketplaceNavigation;
  agents: MarketplaceListing<MarketplaceAgentSummary>;
  skills: MarketplaceListing<MarketplaceSkillSummary>;
}

export function createMarketplaceNavigation(): MarketplaceNavigation {
  const [state, set] = createStore<MarketplaceNavigationState>(initialState());
  return {
    state,
    set,
    go: (view) =>
      set((draft) => {
        draft.stack = [...draft.stack, view];
        draft.missingApp = null;
      }),
    back: () =>
      set((draft) => {
        if (draft.stack.length > 1) draft.stack = draft.stack.slice(0, -1);
      }),
    backTo: (index) =>
      set((draft) => {
        draft.stack = draft.stack.slice(0, Math.max(1, index + 1));
      }),
    show: (tab, view) =>
      set((draft) => {
        draft.tab = tab;
        draft.missingApp = null;
        // The list stays the same element, so it keeps its place.
        if (view) draft.stack = [draft.stack[0] ?? { kind: "browse" }, view];
        else draft.stack = draft.stack.slice(0, 1);
      }),
    reset: () => set((draft) => Object.assign(draft, initialState())),
  };
}

export function isMarketplaceTab(value: string): value is MarketplaceTab {
  return value === "apps" || value === "agents" || value === "skills";
}

/**
 * Where the server answers, with no secret: the command without its arguments, or the address
 * without its query. Arguments, headers, query and environment can hold keys.
 */
export function serverAddress(server: McpServerConfig): string {
  if (server.transport === "stdio") return server.command;
  try {
    const url = new URL(server.url);
    return `${url.origin}${url.pathname}`;
  } catch {
    return "";
  }
}

/** Whether an app matches the search. */
export function matchesApp(app: MarketplaceApp, query: string): boolean {
  const text = query.trim().toLowerCase();
  return !text || app.name.toLowerCase().includes(text) || app.tagline.toLowerCase().includes(text);
}

/** The apps of each category, in the catalog order. A server that the user added is in Other. */
export function appCategories(apps: readonly MarketplaceApp[]): { category: SkillCategory; apps: MarketplaceApp[] }[] {
  const categoryOf = (app: MarketplaceApp): SkillCategory => (app.kind === "custom" ? "other" : app.category);
  return SKILL_CATEGORIES.map((category) => ({
    category,
    apps: apps.filter((app) => categoryOf(app) === category),
  })).filter((group) => group.apps.length > 0);
}

/** The apps that the user connected, and the ones that need attention. */
export function ownedApps(apps: readonly MarketplaceApp[]): MarketplaceApp[] {
  return apps.filter((app) => app.status === "connected" || app.status === "attention");
}

/**
 * The full listing of a page. `load` reports its own failure and then gives undefined. A page that
 * closes before the answer drops it.
 */
export function createDetail<T>(load: () => Promise<T | undefined>) {
  const [state, setState] = createStore<{
    value: T | undefined;
    status: "loading" | "loaded" | "failed";
    reference: string | null;
  }>({
    value: undefined,
    status: "loading",
    reference: null,
  });
  let alive = true;
  onCleanup(() => {
    alive = false;
  });
  const run = () => {
    setState((draft) => {
      draft.status = "loading";
      draft.reference = null;
    });
    // A page belongs to one listing, so a later change of the props does not load again.
    void untrack(load).then(
      (value) => {
        if (!alive) return;
        setState((draft) => {
          draft.value = value;
          draft.status = value ? "loaded" : "failed";
        });
      },
      (error) => {
        if (alive)
          setState((draft) => {
            draft.status = "failed";
            draft.reference = errorReference(error);
          });
      },
    );
  };
  // `load` can write the owner's state, such as an error, and a component body refuses writes.
  onSettled(() => run());
  return { value: () => state.value, status: () => state.status, reference: () => state.reference, retry: run };
}
