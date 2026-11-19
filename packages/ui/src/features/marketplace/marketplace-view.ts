import {
  type MarketplaceAgentDetail,
  type MarketplaceAgentSummary,
  type MarketplaceSkillSort,
  type MarketplaceSkillSummary,
  type McpServerConfig,
  SKILL_CATEGORIES,
  type SkillCategory,
} from "@openbot/contracts/ipc";
import type { MarketplaceListingKind } from "@openbot/contracts/marketplace-links";
import { errorReference } from "@openbot/user-errors";
import { createStore, onCleanup, onSettled, untrack } from "solid-js";
import type { MarketplaceListing } from "./marketplace-listing";
import type { MarketplaceApp, MarketplaceModel } from "./marketplace-model";

export type MarketplaceView =
  | { kind: "browse" }
  | { kind: "agent"; listing: MarketplaceAgentSummary; detail?: MarketplaceAgentDetail | undefined }
  | { kind: "agentGroup"; category: SkillCategory }
  | { kind: "skill"; listing: MarketplaceSkillSummary }
  | { kind: "app"; id: string }
  | { kind: "appGroup"; category: SkillCategory }
  | { kind: "skillGroup"; group: SkillGroup }
  | { kind: "localSkill"; skillId: string }
  | { kind: "server"; id: string | null };

export type SkillGroup = "yours" | SkillCategory;

export type SkillSource = "verified" | "public";

export type MarketplaceTab = "apps" | "agents" | "skills";

export const MARKETPLACE_TABS: readonly MarketplaceTab[] = ["apps", "agents", "skills"];

export const MARKETPLACE_TAB_LABEL = {
  agents: "marketplace.tab.agents",
  apps: "marketplace.tab.apps",
  skills: "marketplace.tab.skills",
} as const satisfies Record<MarketplaceTab, string>;

export interface MarketplaceNavigationState {
  stack: MarketplaceView[];
  tab: MarketplaceTab;
  query: string;
  agentSource: SkillSource | null;
  skillSort: MarketplaceSkillSort;
  skillSource: SkillSource | null;
  missingApp: string | null;
  missingListing: MarketplaceListingKind | null;
  appGroup: SkillCategory | null;
}

export function sourceVerified(source: SkillSource | null): boolean | undefined {
  if (source === null) return undefined;
  return source === "verified";
}

export interface MarketplaceNavigation {
  state: MarketplaceNavigationState;
  set: (change: (draft: MarketplaceNavigationState) => void) => void;
  go: (view: MarketplaceView) => void;
  back: () => void;
  backTo: (index: number) => void;
  show: (tab: MarketplaceTab, view?: MarketplaceView) => void;
  reset: () => void;
}

function initialState(): MarketplaceNavigationState {
  return {
    stack: [{ kind: "browse" }],
    tab: "apps",
    query: "",
    agentSource: null,
    skillSort: "installs",
    skillSource: null,
    missingApp: null,
    missingListing: null,
    appGroup: null,
  };
}

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
        draft.missingListing = null;
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
        draft.missingListing = null;
        if (view) draft.stack = [draft.stack[0] ?? { kind: "browse" }, view];
        else draft.stack = draft.stack.slice(0, 1);
      }),
    reset: () => set((draft) => Object.assign(draft, initialState())),
  };
}

export function isMarketplaceTab(value: string): value is MarketplaceTab {
  return value === "apps" || value === "agents" || value === "skills";
}

export function serverAddress(server: McpServerConfig): string {
  if (server.transport === "stdio") return server.command;
  try {
    const url = new URL(server.url);
    return `${url.origin}${url.pathname}`;
  } catch {
    return "";
  }
}

export function matchesApp(app: MarketplaceApp, query: string): boolean {
  const text = query.trim().toLowerCase();
  return !text || app.name.toLowerCase().includes(text) || app.tagline.toLowerCase().includes(text);
}

export function appCategories(apps: readonly MarketplaceApp[]): { category: SkillCategory; apps: MarketplaceApp[] }[] {
  const categoryOf = (app: MarketplaceApp): SkillCategory => (app.kind === "custom" ? "other" : app.category);
  return SKILL_CATEGORIES.map((category) => ({
    category,
    apps: apps.filter((app) => categoryOf(app) === category),
  })).filter((group) => group.apps.length > 0);
}

export function ownedApps(apps: readonly MarketplaceApp[]): MarketplaceApp[] {
  return apps.filter((app) => app.status === "connected" || app.status === "attention");
}

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
  onSettled(() => run());
  return { value: () => state.value, status: () => state.status, reference: () => state.reference, retry: run };
}
