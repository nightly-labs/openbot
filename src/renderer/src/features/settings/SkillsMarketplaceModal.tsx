import type {
  AddedAgent,
  AgentPublicationPreview,
  AgentSubmission,
  AgentSummary,
  AvatarImageInput,
  InstalledSkill,
  MarketplaceAgentDetail,
  MarketplaceAgentSummary,
  MarketplaceSkillDetail,
  MarketplaceSkillQuery,
  MarketplaceSkillSummary,
  McpServerConfig,
  SkillCategory,
  SkillPackagePreview,
  SkillReviewStatus,
  SkillSubmission,
} from "@openbot/contracts/ipc";
import { isSkillCategory, mcpConfigErrors, SKILL_CATEGORIES } from "@openbot/contracts/ipc";
import { createPluginShareUrl } from "@openbot/contracts/plugin-links";
import type { AppTextKey } from "@openbot/i18n";
import {
  Button,
  Check,
  ChevronDown,
  ChevronRight,
  Dialog,
  DropdownMenu,
  Ellipsis,
  IconButton,
  Input,
  NativeSelect,
  Plus,
  Puzzle,
  RefreshCw,
  Search,
  Skeleton,
  SlidingTabs,
  Upload,
  X,
} from "@openbot/ui";
import { normalizeAvatarFile } from "@openbot/ui/avatar-image";
import { createScrollFades } from "@openbot/ui/components/createScrollFades";
import { SkillPreview } from "@openbot/ui/components/SkillPreview";
import { AgentAvatar } from "@openbot/ui/features/agents/AgentAvatar";
import { safeBrowserUrl } from "@openbot/ui/features/conversation/RichMessageText";
import { routineScheduleSummary } from "@openbot/ui/features/conversation/routine-schedule-ui";
import { AgentSelect } from "@openbot/ui/features/settings/AgentSelect";
import {
  CATEGORY_LABELS,
  MarketplaceCatalog,
  MarketplaceHomeCache,
} from "@openbot/ui/features/settings/MarketplaceCatalog";
import { MarketplaceDetail } from "@openbot/ui/features/settings/MarketplaceDetail";
import { MarketplacePluginDetail, PluginIcon } from "@openbot/ui/features/settings/MarketplacePluginDetail";
import type { McpConnectSubject } from "@openbot/ui/features/settings/McpConnectShell";
import { McpKeyDialog } from "@openbot/ui/features/settings/McpKeyDialog";
import { McpSignInDialog } from "@openbot/ui/features/settings/McpSignInDialog";
import type {
  MarketplacePluginApp,
  MarketplacePluginPrompt,
  MarketplacePluginDetail as PluginDetail,
} from "@openbot/ui/features/settings/marketplace-plugins";
import { isPluginAppConfig } from "@openbot/ui/features/settings/marketplace-plugins";
import type { McpConnectFlow } from "@openbot/ui/features/settings/mcp-connect-auth";
import { currentText, useText } from "@openbot/ui/text";
import type { JSX } from "@solidjs/web";
import {
  createEffect,
  createMemo,
  createSignal,
  createStore,
  For,
  Match,
  onSettled,
  Show,
  Switch,
  snapshot,
  untrack,
} from "solid-js";
import { desktopAnalytics } from "../../analytics";
import { writeClipboardText } from "../../clipboard";
import { createAsyncPanel } from "../../components/createAsyncPanel";
import { desktopMarketplaceCalls, type MarketplaceCalls } from "./marketplace-calls";
import { createPluginAppConfig } from "./marketplace-plugin-catalog";
import type { PluginUninstallPlan } from "./PluginUninstallDialog";
import { PluginUninstallDialog } from "./PluginUninstallDialog";

/** Pending install connect; settle(null) on dismiss. */
interface PendingConnect {
  subject: McpConnectSubject;
  flow: McpConnectFlow;
  settle: (config: McpServerConfig | null) => void;
}

interface SkillsMarketplaceModalProps {
  open: boolean;
  agents: Array<Pick<AgentSummary, "id" | "name" | "marketplaceSource">>;
  activeAgentId: string;
  onOpenChange: (open: boolean) => void;
  onTrySkill?: ((agentId: string, skill: MarketplaceSkillDetail) => void) | undefined;
  /** `serverId` is the joined server the agent was added to, or absent for this computer. */
  onAgentInstalled?: (agent: AddedAgent, serverId?: string) => void | Promise<void>;
  /** Optional plugin listings; absent = not served yet. */
  plugins?: PluginDetail[];
  /** Host server id for plugin app installs. */
  pluginServerId?: string | undefined;
  /** The joined server that keeps a plugin's credential. Absent when this computer keeps it. */
  pluginHostName?: string | undefined;
  /**
   * The joined server whose agents `agents` lists, when this account is its owner or admin. Skills
   * then install on that host, which downloads them with its own account. Absent: this computer.
   */
  hostServerId?: string | undefined;
  /**
   * The joined server a marketplace agent is added to, when this account is its owner or admin and
   * the host serves `agent-install-v1`. Absent: this computer.
   */
  agentServerId?: string | undefined;
  /**
   * The joined server in `hostServerId` when its host also updates an agent from its listing
   * (`agent-update-v1`). Absent with a `hostServerId`: its agents offer no update.
   */
  agentUpdateServerId?: string | undefined;
  /** Insert a listing's example question into the chosen agent's composer. */
  onRunPluginPrompt?: ((agentId: string, prompt: MarketplacePluginPrompt) => void) | undefined;
  /**
   * The listing an `openbot://plugins/<slug>` link asked for. It selects the tab and opens the page;
   * it never installs, so what a link can do is show a user a listing they then decide about.
   */
  initialPluginSlug?: string;
  /**
   * Runs after the modal consumes `initialPluginSlug`. The owner clears the pending slug there, so
   * a second link to the same listing reads as a new request instead of no change.
   */
  onInitialPluginSlugConsumed?: () => void;
  /** What the dialog calls. Absent: this computer's bridge, as in the desktop app. */
  calls?: MarketplaceCalls | undefined;
}

type Tab = "discover" | "mine";
type MarketplaceKind = "agents" | "plugins" | "skills";

/*
 * The overview caches outlive the dialog, so opening it again does not ask again. Each one belongs to
 * one list function, so a story or a test that replaces the API never reads another one's answer.
 */
const skillHomeCaches = new WeakMap<
  MarketplaceCalls["skills"]["list"],
  MarketplaceHomeCache<MarketplaceSkillSummary>
>();
const agentHomeCaches = new WeakMap<
  MarketplaceCalls["agents"]["list"],
  MarketplaceHomeCache<MarketplaceAgentSummary>
>();

function homeCacheFor<K extends WeakKey, C>(caches: WeakMap<K, C>, key: K, create: () => C): C {
  const cached = caches.get(key);
  if (cached) return cached;
  const created = create();
  caches.set(key, created);
  return created;
}

const skillHomeCache = (calls: MarketplaceCalls) =>
  homeCacheFor(skillHomeCaches, calls.skills.list, () => new MarketplaceHomeCache<MarketplaceSkillSummary>());
const agentHomeCache = (calls: MarketplaceCalls) =>
  homeCacheFor(agentHomeCaches, calls.agents.list, () => new MarketplaceHomeCache<MarketplaceAgentSummary>());

/** The account's own submissions, which only the desktop app reads and sends. */
function publishingCalls(calls: MarketplaceCalls) {
  if (!calls.publishing) throw new Error(currentText().t("marketplace.error.publishDesktopOnly"));
  return calls.publishing;
}

function isMarketplaceKind(value: string): value is MarketplaceKind {
  return value === "agents" || value === "plugins" || value === "skills";
}

/** What the search field says it searches, since "agents" is not the word inside the sentence. */
const SEARCH_PLACEHOLDER = {
  agents: "marketplace.searchPlaceholder.agents",
  plugins: "marketplace.searchPlaceholder.plugins",
  skills: "marketplace.searchPlaceholder.skills",
} as const satisfies Record<MarketplaceKind, AppTextKey>;

const SEARCH_LABEL = {
  agents: "marketplace.search.agents",
  plugins: "marketplace.search.plugins",
  skills: "marketplace.search.skills",
} as const satisfies Record<MarketplaceKind, AppTextKey>;

const REVIEW_STATUS_LABEL = {
  pending: "marketplace.status.pending",
  approved: "marketplace.status.approved",
  rejected: "marketplace.status.rejected",
} as const satisfies Record<SkillReviewStatus, AppTextKey>;

/** The server sends this English text when a skill name is taken. It is a released contract. */
const SKILL_NAME_TAKEN = "A skill with this name already exists.";

/** The SKILL.md example. It shows the file syntax, so it stays in English. */
const SKILL_MD_EXAMPLE = `---
name: Release Notes
description: Turn merged work into clear, consistent release notes.
---`;

/** Shows each file name of `names` in `text` as code. */
function withCode(text: string, names: readonly string[]): JSX.Element {
  const escaped = names.map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const pattern = new RegExp(`(${escaped.join("|")})`);
  return text.split(pattern).map((part, index) => (index % 2 === 1 ? <code>{part}</code> : part));
}

/** Single detail selection; replaces a prior three-signal chain. */
type SkillDetail =
  | { kind: "none" }
  | { kind: "loading" }
  | { kind: "skill"; skill: MarketplaceSkillDetail }
  | { kind: "submission"; submission: SkillSubmission };

/** Which listing is on screen and what narrows it: every field a tab switch resets together. */
interface SkillsBrowse {
  kind: MarketplaceKind;
  tab: Tab;
  targetAgentId: string;
}

/** The publish form. Meaningful only while `preview` holds a chosen package, and cleared with it. */
interface SkillPublication {
  category: SkillCategory;
  icon: AvatarImageInput | null;
  iconPreviewUrl: string | null;
  preview: SkillPackagePreview | null;
  skillId: string | undefined;
}

/** Everything the skills half of the marketplace shows, grouped by the surface that owns it. */
interface SkillsMarketplace {
  browse: SkillsBrowse;
  detail: SkillDetail;
  installed: InstalledSkill[];
  installedForAgentId: string;
  /**
   * How the installed list got to its current contents. An empty list means "this agent has no
   * skills" only when it is `loaded`; without this, a refused or failed read tells the user to
   * install a skill that is already installed.
   */
  installedLoad: "idle" | "loading" | "loaded" | "failed";
  publication: SkillPublication;
  submissions: SkillSubmission[];
}

export function SkillsMarketplaceModal(props: SkillsMarketplaceModalProps) {
  const { t, format } = useText();
  const calls = () => props.calls ?? desktopMarketplaceCalls();
  const [market, setMarket] = createStore<SkillsMarketplace>({
    browse: { kind: "agents", tab: "discover", targetAgentId: "" },
    detail: { kind: "none" },
    installed: [],
    installedForAgentId: "",
    installedLoad: "idle",
    publication: {
      category: "other",
      icon: null,
      iconPreviewUrl: null,
      preview: null,
      skillId: undefined,
    },
    submissions: [],
  });
  /** Pulse counters for agent panel refresh/add. */
  const [agentRefreshVersion, setAgentRefreshVersion] = createSignal(0);
  const [agentAddVersion, setAgentAddVersion] = createSignal(0);
  const { panel, run, setBusy, setError, setLoading } = createAsyncPanel(marketplaceErrorMessage);
  let marketplaceBody: HTMLDivElement | undefined;
  const bodyFades = createScrollFades();
  onSettled(() => bodyFades.stop);
  /** Re-measure fades after programmatic scroll. */
  function scrollBodyTo(top: number) {
    if (marketplaceBody) marketplaceBody.scrollTop = top;
    bodyFades.remeasure();
  }
  let listScrollTop = 0;
  const [skillRefreshVersion, setSkillRefreshVersion] = createSignal(0);
  /** Search text in header chrome. */
  const [searchQuery, setSearchQuery] = createSignal("");
  /** The page open over the listing. */
  const [detail, setDetail] = createSignal<{ name: string; close: () => void } | null>(null);
  const detailActive = () => detail() !== null;
  let detailTrigger: HTMLElement | null = null;
  let detailRequest = 0;

  /** Filtered plugin rows; each row keeps its source listing. */
  function listPlugins(query: MarketplaceSkillQuery) {
    const text = query.query?.trim().toLowerCase() ?? "";
    return (props.plugins ?? [])
      .filter((plugin) => !query.category || plugin.category === query.category)
      .filter(
        (plugin) =>
          !text ||
          plugin.name.toLowerCase().includes(text) ||
          plugin.tagline.toLowerCase().includes(text) ||
          plugin.creatorName.toLowerCase().includes(text),
      )
      .slice(0, query.limit ?? 50)
      .map((plugin) => ({
        id: plugin.id,
        name: plugin.name,
        description: plugin.tagline,
        creatorName: plugin.creatorName,
        creatorAvatarUrl: plugin.creatorAvatarUrl,
        category: plugin.category,
        plugin,
      }));
  }

  /** Open plugin page; the agent half holds its own detail. */
  const [openPlugin, setOpenPlugin] = createSignal<PluginDetail | null>(null);
  /** The listing the user asked to uninstall, held while the confirmation is on screen. */
  const [uninstalling, setUninstalling] = createSignal<PluginDetail | null>(null);
  function showPlugin(plugin: PluginDetail) {
    enterDetails(plugin.name, closePlugin);
    setOpenPlugin(plugin);
  }
  function closePlugin() {
    // The confirmation asks about the page behind it, so leaving that page is the same as cancelling.
    setUninstalling(null);
    setOpenPlugin(null);
    leaveDetails();
  }

  /**
   * A slug a link named that this catalog does not hold - an older build, or a listing that was
   * withdrawn. It is the slug and not a plugin, because there is nothing to show but the name.
   */
  const [missingPluginSlug, setMissingPluginSlug] = createSignal<string | null>(null);
  createEffect(
    () => (props.open ? props.initialPluginSlug : undefined),
    (slug) => {
      if (!slug) return;
      // A link replaces the page on screen: without this, an unknown slug leaves the previous
      // plugin set, and leaving its notice returns to that page with the header already gone.
      setOpenPlugin(null);
      selectKind("plugins");
      const plugin = (props.plugins ?? []).find((candidate) => candidate.slug === slug);
      setMissingPluginSlug(plugin ? null : slug);
      if (plugin) showPlugin(plugin);
      // The page holds this listing now, so the owner forgets the link: the same slug arriving
      // again changes the signal from nothing, and this effect runs for it.
      props.onInitialPluginSlugConsumed?.();
    },
  );

  /* `openbot.run/plugins/<slug>` is served now, so the page offers Copy link. The address is built
     from the slug rather than read from `shareUrl`, so what is copied is what the route answers. */
  function openPluginUrl(url: string) {
    const safe = safeBrowserUrl(url);
    if (!safe) return;
    void calls()
      .openUrl(safe)
      .catch(() => setError(t("marketplace.error.openLink")));
  }

  function copyPluginLink(slug: string) {
    void Promise.resolve()
      .then(() => writeClipboardText(createPluginShareUrl(slug)))
      .catch(() => setError(t("marketplace.error.copyLink")));
  }

  /**
   * The MCP servers the host holds, whole rather than by name: an uninstall removes a row by id, and
   * a name alone cannot say which row an app's name belongs to.
   */
  const [hostMcpServers, setHostMcpServers] = createSignal<readonly McpServerConfig[]>([]);
  /** The row this app installed as, or nothing: a name on its own is not enough to claim a row. */
  const heldApp = (app: MarketplacePluginApp) => hostMcpServers().find((held) => isPluginAppConfig(held, app));
  /** A plugin reads as installed iff all its apps and skills are present. */
  const pluginInstalled = (plugin: PluginDetail) =>
    (plugin.apps.length > 0 || plugin.skills.length > 0) &&
    plugin.apps.every((app) => Boolean(heldApp(app))) &&
    plugin.skills.every((skill) => installedById().has(skill.id));
  /**
   * Whether anything of this plugin is still here. A half-installed plugin - one app saved before a
   * later one failed, or one removal that failed while the rest went - is not installed, but it is
   * still removable, and the page must keep offering the way out of what is left.
   */
  const pluginRemovable = (plugin: PluginDetail) =>
    plugin.apps.some((app) => Boolean(heldApp(app))) || plugin.skills.some((skill) => installedById().has(skill.id));

  async function loadHostMcpServers(serverId: string) {
    const configs = await run(() => calls().mcp.listMcpServers(serverId));
    if (configs) setHostMcpServers(configs);
  }

  /** Pre-save connect check, settled by the dialog promise. */
  const [connecting, setConnecting] = createSignal<PendingConnect | null>(null);

  function connectApp(app: MarketplacePluginApp, config: McpServerConfig): Promise<McpServerConfig | null> {
    const flow = (app.server.auth ?? [])[0];
    if (!flow) return Promise.resolve(config);
    return new Promise((resolve) => {
      setConnecting({
        subject: { name: app.name, iconUrl: app.iconUrl, config },
        flow,
        settle: (answer) => {
          setConnecting(null);
          resolve(answer);
        },
      });
    });
  }

  /** Test connects with the dialog-built config; nothing is saved by asking. */
  async function testPluginApp(config: McpServerConfig) {
    const serverId = props.pluginServerId;
    if (!serverId) throw new Error(t("marketplace.error.connectNoServer"));
    return calls().mcp.testMcpServer({ config }, serverId);
  }

  /**
   * One install, both halves: the plugin's skills go to the selected agent, and its apps become MCP
   * servers on this host. The two land in different places because that is what they are - a skill
   * is one agent's instructions, and an MCP server is held by the host that runs the agents.
   *
   * The skills go first, so a failure never leaves a server standing that nothing knows how to
   * drive. If a later step fails, the skills this attempt installed are removed again; a skill the
   * agent already had is left alone, because the user put it there and this attempt did not.
   */
  async function installPlugin(plugin: PluginDetail) {
    const serverId = props.pluginServerId;
    if (!serverId) {
      setError(t("marketplace.error.installNoServer"));
      return;
    }
    const agentId = market.browse.targetAgentId;
    if (plugin.skills.length > 0 && !agentId) {
      setError(t("marketplace.error.installNoAgent"));
      return;
    }
    /* A browser sign-in saves its grant on the computer that finishes it, so an app that asks for
       one is installed on the host itself. */
    if (props.hostServerId && plugin.apps.some((app) => app.server.auth?.[0]?.kind === "link")) {
      setError(t("marketplace.error.installOnHost", { name: plugin.name }));
      return;
    }
    setBusy(`plugin:${plugin.id}`);
    const installed = await run(async () => {
      const added: string[] = [];
      try {
        for (const skill of plugin.skills) {
          const held = installedById().has(skill.id);
          await calls()
            .agentSkills(props.hostServerId)
            .install({ agentId, skillId: skill.id, versionId: skill.versionId });
          if (!held) added.push(skill.id);
        }
        for (const app of plugin.apps) {
          const config = createPluginAppConfig(app);
          const invalid = Object.values(mcpConfigErrors(config))[0];
          if (invalid) throw new Error(t("marketplace.error.appInvalid", { name: app.name, reason: invalid }));
          /* What is saved is the configuration that connected, not the one the listing describes:
             the credential the user typed, or the grant the sign-in returned, is part of it. */
          const connected = await connectApp(app, config);
          if (!connected) {
            // Closing the connect dialog is a decision, not a failure: it stops without a sentence.
            await undoSkills(agentId, added);
            return false;
          }
          setHostMcpServers(await calls().mcp.saveMcpServer({ config: connected }, serverId));
        }
      } catch (error) {
        await undoSkills(agentId, added);
        throw error;
      }
      return true;
    });
    /* Only on success: reading the list again starts by clearing the panel, which would take the
       failure off the screen before the reader saw it. */
    if (installed && plugin.skills.length > 0) await loadInstalled(agentId);
    setBusy(null);
  }

  /** Takes back only what this attempt installed. A skill the agent already had is the user's. */
  async function undoSkills(agentId: string, skillIds: readonly string[]) {
    for (const skillId of skillIds)
      await calls()
        .agentSkills(props.hostServerId)
        .uninstall({ agentId, skillId })
        .catch(() => undefined);
  }

  /**
   * What an uninstall of this listing would really take, read from this computer rather than from
   * the listing. A plugin can name two apps while the host holds one, and the skills belong to the
   * agent the page is pointed at: the plan is what is there now, for that agent.
   */
  function uninstallPlan(plugin: PluginDetail): PluginUninstallPlan {
    const held = installedById();
    return {
      pluginName: plugin.name,
      appNames: plugin.apps.map((app) => heldApp(app)?.name).filter((name): name is string => Boolean(name)),
      skillSlugs: plugin.skills.filter((skill) => held.has(skill.id)).map((skill) => skill.slug),
      agentName:
        props.agents.find((agent) => agent.id === market.browse.targetAgentId)?.name ?? t("marketplace.thisAgent"),
    };
  }

  /**
   * The install, undone. The apps go first and the skills after, the reverse of the order an install
   * lands in: the server stops answering before the instructions that drive it are taken away, so
   * there is never a moment where an agent holds a skill for a server it can still reach but no
   * longer has a description of.
   *
   * Every step is attempted, even after one fails. Stopping at the first failure would leave the
   * rest of the plugin behind with nothing on screen naming it, and the user would have to guess
   * which half is still there; instead each failure is collected and reported by name, and what
   * could be removed is removed. The lists are read again afterwards either way, so what the page
   * says is installed is what the host and the agent really hold.
   */
  async function uninstallPlugin(plugin: PluginDetail) {
    const serverId = props.pluginServerId;
    if (!serverId) {
      setError(t("marketplace.error.uninstallNoServer"));
      setUninstalling(null);
      return;
    }
    const agentId = market.browse.targetAgentId;
    setBusy(`plugin-uninstall:${plugin.id}`);
    setError(null);
    const failures: string[] = [];
    for (const app of plugin.apps) {
      const config = heldApp(app);
      if (!config) continue;
      try {
        setHostMcpServers(await calls().mcp.removeMcpServer({ mcpServerId: config.id }, serverId));
      } catch (cause) {
        failures.push(`${app.name}: ${marketplaceErrorMessage(cause)}`);
      }
    }
    if (agentId) {
      for (const skill of plugin.skills) {
        if (!installedById().has(skill.id)) continue;
        try {
          await calls().agentSkills(props.hostServerId).uninstall({ agentId, skillId: skill.id });
        } catch (cause) {
          failures.push(`${skill.slug}: ${marketplaceErrorMessage(cause)}`);
        }
      }
    }
    setUninstalling(null);
    /* Read back before the failure is written: the reads clear the panel, and a message set first
       would be taken off screen by the refresh that follows it. */
    await loadHostMcpServers(serverId);
    if (agentId && plugin.skills.length > 0) await loadInstalled(agentId);
    if (failures.length > 0)
      setError(t("marketplace.error.uninstallPartial", { name: plugin.name, failures: failures.join(" ") }));
    setBusy(null);
  }

  let installedRequest = 0;
  const installedById = createMemo(
    () =>
      new Map(
        (market.installedForAgentId === market.browse.targetAgentId ? market.installed : []).map((item) => [
          item.skillId,
          item,
        ]),
      ),
  );
  // The arms of the detail union, so the JSX narrows here once instead of at every read.
  const detailOpen = () => market.detail.kind !== "none";
  const detailLoading = () => market.detail.kind === "loading";
  const skillDetail = () => (market.detail.kind === "skill" ? market.detail.skill : null);
  const submissionDetail = () => (market.detail.kind === "submission" ? market.detail.submission : null);

  createEffect(
    () => props.open,
    (open) => {
      if (!open) {
        closeDetail();
        /* The connect dialog is a sibling of the marketplace, so closing the marketplace would
           otherwise leave it on screen over nothing, with the install still waiting behind it.
           Closing the page the install was started from is the same decision as closing the
           dialog: it stops. */
        connecting()?.settle(null);
        setUninstalling(null);
        return;
      }
      untrack(() =>
        setMarket((state) => {
          state.browse.targetAgentId = state.browse.targetAgentId || props.activeAgentId || props.agents[0]?.id || "";
        }),
      );
      void loadSkills();
    },
  );

  /* Read when the Plugins tab is on screen, not when the dialog opens: most visits never reach it,
     and the answer is only needed to say which listings are already installed. */
  createEffect(
    () => (props.open && market.browse.kind === "plugins" ? props.pluginServerId : undefined),
    (serverId) => {
      if (serverId) void loadHostMcpServers(serverId);
      else setHostMcpServers([]);
    },
  );

  createEffect(
    () => [props.open, market.browse.targetAgentId] as const,
    ([open, agentId]) => {
      if (open && agentId) void untrack(() => loadInstalled(agentId));
      else {
        setMarket((state) => {
          state.installed = [];
          state.installedLoad = "idle";
        });
      }
    },
  );

  /**
   * The load state of the list shown for the selected agent. A list read for another agent is not
   * an answer about this one, and a failed refresh keeps the failure: the rows on screen are then
   * older than the agent, and Try must not run on them.
   */
  const installedLoadForTarget = (): "idle" | "loading" | "loaded" | "failed" =>
    market.installedLoad === "loaded" && market.installedForAgentId !== market.browse.targetAgentId
      ? "idle"
      : market.installedLoad;

  function closeDetail(): void {
    /*
     * A detail page that is still loading must not come back after the reader left it. The counter
     * moves on here, so a late answer for the closed page is dropped instead of applied.
     */
    detailRequest += 1;
    setDetail(null);
    setMarket((state) => {
      state.detail = { kind: "none" };
    });
  }

  function loadSkills() {
    setSkillRefreshVersion((version) => version + 1);
  }

  async function loadInstalled(agentId = market.browse.targetAgentId) {
    if (agentId !== market.browse.targetAgentId) return;
    const request = ++installedRequest;
    if (!agentId) {
      setMarket((state) => {
        state.installed = [];
        state.installedLoad = "idle";
      });
      return;
    }
    setMarket((state) => {
      state.installedLoad = "loading";
    });
    const values = await run(() => calls().agentSkills(props.hostServerId).listInstalled(agentId));
    if (request !== installedRequest || !props.open || market.browse.targetAgentId !== agentId) return;
    if (!values) {
      setMarket((state) => {
        state.installedLoad = "failed";
      });
      return;
    }
    setMarket((state) => {
      state.installedForAgentId = agentId;
      state.installed = values;
      state.installedLoad = "loaded";
    });
  }

  async function loadMine() {
    setLoading(true);
    const values = await run(() => publishingCalls(calls()).skills.listMine());
    if (values) {
      setMarket((state) => {
        state.submissions = values;
      });
    }
    setLoading(false);
  }

  function refresh(next: Tab = market.browse.tab) {
    if (next === "discover") void loadSkills();
    if (next === "mine") void loadMine();
  }

  function selectTab(next: Tab) {
    closeDetail();
    const marketplaceKind = market.browse.kind;
    setSearchQuery("");
    scrollBodyTo(0);
    setMarket((state) => {
      state.browse.tab = next;
      state.publication.preview = null;
      state.publication.icon = null;
      state.publication.iconPreviewUrl = null;
    });
    setError(null);
    if (marketplaceKind === "skills") refresh(next);
  }

  function selectKind(next: MarketplaceKind) {
    closeDetail();
    setSearchQuery("");
    scrollBodyTo(0);
    setMarket((state) => {
      state.browse.kind = next;
      state.browse.tab = "discover";
      state.publication.preview = null;
    });
    setError(null);
    if (next === "skills") void loadSkills();
  }

  function enterDetails(name: string, close: () => void) {
    detailTrigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setDetail({ name, close });
    if (!detailOpen()) {
      listScrollTop = marketplaceBody?.scrollTop ?? 0;
    }
    scrollBodyTo(0);
  }

  /*
   * The management menu is reachable from a detail page, and a tab change or a refresh does not
   * always reach the panel that owns that page. Closing the open detail through its own handler
   * first leaves the crumb and the panel on the listing together.
   */
  function leaveActiveDetail(): void {
    const open = detail();
    if (!open) return;
    // The menu goes to a fresh listing, so the offset saved for the old one is dropped.
    listScrollTop = 0;
    open.close();
  }

  function leaveDetails() {
    closeDetail();
    queueMicrotask(() => {
      scrollBodyTo(listScrollTop);
      if (detailTrigger?.isConnected) detailTrigger.focus();
    });
  }

  async function openDetails(skill: MarketplaceSkillSummary) {
    const analytics = desktopAnalytics.scope();
    enterDetails(skill.name, leaveDetails);
    const request = ++detailRequest;
    setMarket((state) => {
      state.detail = { kind: "loading" };
    });
    const value = await run(() => calls().skills.get(skill.id));
    analytics.track("marketplace_action", {
      entity: "skill",
      action: "view",
      result: value ? "succeeded" : "failed",
      ...(value ? {} : { failure_code: "load_failed" }),
    });
    // The reader left this page while it loaded, so neither its content nor its exit applies now.
    if (request !== detailRequest) return;
    if (!value) {
      leaveDetails();
      return;
    }
    setMarket((state) => {
      state.detail = { kind: "skill", skill: value };
    });
  }

  async function openDetailsById(skillId: string, name: string) {
    enterDetails(name, leaveDetails);
    const request = ++detailRequest;
    const analytics = desktopAnalytics.scope();
    setMarket((state) => {
      state.detail = { kind: "loading" };
    });
    const value = await run(() => calls().skills.get(skillId));
    analytics.track("marketplace_action", {
      entity: "skill",
      action: "view",
      result: value ? "succeeded" : "failed",
      ...(value ? {} : { failure_code: "load_failed" }),
    });
    if (request !== detailRequest) return;
    if (!value) {
      leaveDetails();
      return;
    }
    setMarket((state) => {
      state.detail = { kind: "skill", skill: value };
    });
  }

  function openSubmissionDetails(submission: SkillSubmission) {
    if (submission.status === "approved") {
      void openDetailsById(submission.skillId, submission.name);
      return;
    }
    enterDetails(submission.name, leaveDetails);
    setMarket((state) => {
      state.detail = { kind: "submission", submission };
    });
  }

  async function install(
    skill: MarketplaceSkillSummary,
    replaceModified = false,
    action: "install" | "update" = "install",
  ) {
    const agentId = market.browse.targetAgentId;
    if (!agentId) {
      setError(t("marketplace.error.skillsNeedLocal"));
      return;
    }
    const analytics = desktopAnalytics.scope();
    setBusy(skill.id);
    const result = await run(() =>
      calls().agentSkills(props.hostServerId).install({ agentId, skillId: skill.id, replaceModified }),
    );
    analytics.track("marketplace_action", {
      entity: "skill",
      action,
      result: result ? "succeeded" : "failed",
      ...(result ? {} : { failure_code: action === "update" ? "update_failed" : "install_failed" }),
    });
    if (result) await loadInstalled(agentId);
    setBusy(null);
  }

  async function choosePackage(skillId?: string) {
    const value = await run(() => publishingCalls(calls()).skills.choosePackage());
    if (!value) return;
    const category = skillId
      ? (market.submissions.find((item) => item.skillId === skillId)?.category ?? "other")
      : "other";
    setMarket((state) => {
      state.publication = {
        category,
        icon: null,
        iconPreviewUrl: null,
        preview: value,
        skillId,
      };
    });
  }

  async function submit() {
    const value = market.publication.preview;
    if (!value) return;
    const analytics = desktopAnalytics.scope();
    const { category, skillId } = market.publication;
    // The icon crosses to IPC, which structured-clones it, so it goes as a snapshot rather than as
    // whatever the store hands back.
    const icon = snapshot(market.publication.icon);
    setBusy("publish");
    const created = await run(() =>
      publishingCalls(calls()).skills.submit({
        draftId: value.draftId,
        showCreatorAvatar: true,
        category,
        icon,
        ...(skillId ? { skillId } : {}),
      }),
    );
    analytics.track("marketplace_action", {
      entity: "skill",
      action: "publish",
      result: created ? "succeeded" : "failed",
      ...(created ? {} : { failure_code: "publish_failed" }),
    });
    if (created) {
      discardPublication();
      await loadMine();
    }
    setBusy(null);
  }

  async function chooseIcon(file: File | undefined) {
    if (!file) return;
    const icon = await run(() => normalizeAvatarFile(file));
    if (!icon) return;
    const iconPreviewUrl = avatarImageDataUrl(icon);
    setMarket((state) => {
      state.publication.icon = icon;
      state.publication.iconPreviewUrl = iconPreviewUrl;
    });
  }

  /** Drops the chosen package and the icon picked for it: neither outlives the other. */
  function discardPublication(): void {
    setMarket((state) => {
      state.publication.preview = null;
      state.publication.icon = null;
      state.publication.iconPreviewUrl = null;
    });
  }

  return (
    <>
      <Dialog.Root open={props.open} onOpenChange={props.onOpenChange}>
        <Dialog.Portal>
          <Dialog.Overlay class="skills-marketplace-backdrop">
            <Dialog.Content class="skills-marketplace" onOpenAutoFocus={(event) => event.preventDefault()}>
              <header class="skills-marketplace-topbar" data-detail={detailActive() ? "" : undefined}>
                <div class="marketplace-crumbs">
                  <Show
                    when={detail()}
                    fallback={<Dialog.Title class="marketplace-title">{t("marketplace.title")}</Dialog.Title>}
                  >
                    {(open) => (
                      <>
                        <Button
                          type="button"
                          variant="ghost"
                          class="marketplace-crumb-parent"
                          onClick={() => open().close()}
                        >
                          {t("marketplace.title")}
                        </Button>
                        <ChevronRight class="marketplace-crumb-separator" aria-hidden="true" />
                        <Dialog.Title class="marketplace-title">{open().name}</Dialog.Title>
                      </>
                    )}
                  </Show>
                </div>
                <div class="skills-marketplace-topbar-actions">
                  <DropdownMenu.Root>
                    <DropdownMenu.Trigger class="marketplace-management" aria-label={t("marketplace.menu")}>
                      <Ellipsis />
                    </DropdownMenu.Trigger>
                    <DropdownMenu.Portal>
                      <DropdownMenu.Content class="marketplace-menu">
                        <DropdownMenu.Item
                          onSelect={() => {
                            leaveActiveDetail();
                            selectTab("discover");
                          }}
                        >
                          {t("marketplace.menu.discover")}
                        </DropdownMenu.Item>
                        <Show when={calls().publishing}>
                          <DropdownMenu.Item
                            onSelect={() => {
                              leaveActiveDetail();
                              selectTab("mine");
                            }}
                          >
                            {t("marketplace.mySubmissions")}
                          </DropdownMenu.Item>
                          <DropdownMenu.Separator />
                          <DropdownMenu.Item
                            onSelect={() => {
                              leaveActiveDetail();
                              selectTab("mine");
                              if (market.browse.kind === "agents") setAgentAddVersion((version) => version + 1);
                            }}
                          >
                            <Plus />{" "}
                            {market.browse.kind === "agents" ? t("marketplace.addAgent") : t("marketplace.addSkill")}
                          </DropdownMenu.Item>
                        </Show>
                        <DropdownMenu.Item
                          onSelect={() => {
                            leaveActiveDetail();
                            if (market.browse.kind === "skills") skillHomeCache(calls()).forget();
                            if (market.browse.kind === "agents") agentHomeCache(calls()).forget();
                            if (market.browse.kind === "skills") refresh();
                            else setAgentRefreshVersion((version) => version + 1);
                          }}
                        >
                          <RefreshCw /> {t("marketplace.menu.refresh")}
                        </DropdownMenu.Item>
                      </DropdownMenu.Content>
                    </DropdownMenu.Portal>
                  </DropdownMenu.Root>
                  <IconButton label={t("marketplace.close")} variant="ghost" onClick={() => props.onOpenChange(false)}>
                    <X />
                  </IconButton>
                </div>
              </header>

              <div
                class={["skills-marketplace-body", bodyFades.classes()]}
                data-detail-open={detailOpen() ? "" : undefined}
                onScroll={bodyFades.measure}
                ref={(element) => {
                  marketplaceBody = element;
                  bodyFades.bind(element);
                }}
              >
                <SlidingTabs.Root
                  value={market.browse.kind}
                  onChange={(value) => {
                    if (isMarketplaceKind(value)) selectKind(value);
                  }}
                >
                  <div class="skills-marketplace-toolbar" hidden={detailActive()}>
                    <SlidingTabs.List aria-label={t("marketplace.kinds")}>
                      <SlidingTabs.Trigger value="agents">{t("marketplace.tab.agents")}</SlidingTabs.Trigger>
                      <SlidingTabs.Trigger value="plugins">{t("marketplace.tab.plugins")}</SlidingTabs.Trigger>
                      <SlidingTabs.Trigger value="skills">{t("marketplace.tab.skills")}</SlidingTabs.Trigger>
                    </SlidingTabs.List>
                    <Show when={market.browse.kind === "plugins" || market.browse.tab === "discover"}>
                      <label class="search-field skills-marketplace-search">
                        <span class="sr-only">{t(SEARCH_LABEL[market.browse.kind])}</span>
                        <Search aria-hidden="true" />
                        <Input
                          type="search"
                          aria-label={t(SEARCH_LABEL[market.browse.kind])}
                          placeholder={t(SEARCH_PLACEHOLDER[market.browse.kind])}
                          value={searchQuery()}
                          onValueChange={setSearchQuery}
                        />
                      </label>
                    </Show>
                  </div>
                  <Show when={market.browse.kind === "skills"}>
                    <Show when={market.browse.tab === "discover"}>
                      <div class="skills-marketplace-discover" hidden={detailOpen()} inert={detailOpen()}>
                        <MarketplaceCatalog
                          kind="skills"
                          query={searchQuery()}
                          refreshVersion={skillRefreshVersion()}
                          homeCache={skillHomeCache(calls())}
                          list={async (query) => {
                            const page = await calls().skills.list(query);
                            return { items: page.skills, nextCursor: page.nextCursor };
                          }}
                          icon={(skill) => <PluginIcon iconUrl={skill.iconUrl} />}
                          onOpen={openDetails}
                        />
                      </div>
                    </Show>

                    <Show when={market.browse.tab === "mine"}>
                      <section class="skills-marketplace-panel">
                        <div class="skills-marketplace-heading">
                          <div>
                            <h1>{t("marketplace.mySubmissions")}</h1>
                            <p>{t("marketplace.mine.description")}</p>
                          </div>
                          <Button onClick={() => void choosePackage()}>
                            <Upload /> {t("marketplace.mine.choosePackage")}
                          </Button>
                        </div>
                        <section class="skills-submission-guide" aria-labelledby="skills-submission-guide-title">
                          <div class="skills-submission-guide-heading">
                            <h2 id="skills-submission-guide-title">{t("marketplace.guide.title")}</h2>
                            <p>{t("marketplace.guide.description")}</p>
                          </div>
                          <div class="skills-submission-guide-grid">
                            <div>
                              <h3>{t("marketplace.guide.package")}</h3>
                              <ul>
                                <li>
                                  <Check />
                                  <span>
                                    {withCode(t("marketplace.guide.root", { file: "SKILL.md" }), ["SKILL.md"])}
                                  </span>
                                </li>
                                <li>
                                  <Check />
                                  <span>{t("marketplace.guide.size")}</span>
                                </li>
                                <li>
                                  <Check />
                                  <span>{t("marketplace.guide.contents")}</span>
                                </li>
                              </ul>
                            </div>
                            <div>
                              <h3>{t("marketplace.guide.safety")}</h3>
                              <ul>
                                <li>
                                  <Check />
                                  <span>{t("marketplace.guide.explain")}</span>
                                </li>
                                <li>
                                  <Check />
                                  <span>{withCode(t("marketplace.guide.secrets", { env: ".env" }), [".env"])}</span>
                                </li>
                                <li>
                                  <Check />
                                  <span>
                                    {withCode(
                                      t("marketplace.guide.exclude", { git: ".git", modules: "node_modules" }),
                                      [".git", "node_modules"],
                                    )}
                                  </span>
                                </li>
                              </ul>
                            </div>
                          </div>
                          <div class="skills-submission-example">
                            <div>
                              <h3>{t("marketplace.guide.metadata", { file: "SKILL.md" })}</h3>
                              <p>{t("marketplace.guide.metadataLimits")}</p>
                            </div>
                            <pre>{SKILL_MD_EXAMPLE}</pre>
                          </div>
                          <p class="skills-submission-limit">{t("marketplace.guide.limits")}</p>
                        </section>
                        <Show when={market.publication.preview}>
                          {(value) => (
                            <div class="skills-publish-card">
                              <div class="skills-publish-summary">
                                <Show
                                  when={market.publication.iconPreviewUrl}
                                  fallback={
                                    <span class="skills-marketplace-default-icon">
                                      <Puzzle />
                                    </span>
                                  }
                                  keyed
                                >
                                  {(url) => (
                                    <span class="skills-marketplace-icon">
                                      <img src={url} alt={t("marketplace.publish.iconPreview")} />
                                    </span>
                                  )}
                                </Show>
                                <div>
                                  <h2>{value().name}</h2>
                                  <p>{value().description}</p>
                                  <small>
                                    {t("marketplace.publish.packageSize", {
                                      files: value().files.length,
                                      size: format.number(value().size / 1024, {
                                        minimumFractionDigits: 1,
                                        maximumFractionDigits: 1,
                                        useGrouping: false,
                                      }),
                                    })}
                                  </small>
                                </div>
                              </div>
                              <div class="skills-publish-fields">
                                <label class="skills-publish-category">
                                  {t("marketplace.publish.category")}
                                  <NativeSelect
                                    value={market.publication.category}
                                    onChange={(event) => {
                                      const category = event.currentTarget.value;
                                      if (isSkillCategory(category)) {
                                        setMarket((state) => {
                                          state.publication.category = category;
                                        });
                                      }
                                    }}
                                  >
                                    <For each={SKILL_CATEGORIES}>
                                      {(item) => <option value={item}>{t(CATEGORY_LABELS[item])}</option>}
                                    </For>
                                  </NativeSelect>
                                  <ChevronDown aria-hidden="true" />
                                </label>
                                <label>
                                  {t("marketplace.publish.icon")}
                                  <Input
                                    type="file"
                                    accept="image/png,image/jpeg,image/webp"
                                    onChange={(event) => void chooseIcon(event.currentTarget.files?.[0])}
                                  />
                                </label>
                              </div>
                              <div class="skills-publish-actions">
                                <Button variant="ghost" onClick={discardPublication}>
                                  {t("common.cancel")}
                                </Button>
                                <Button
                                  variant="default"
                                  loading={panel.busy === "publish"}
                                  loadingLabel={t("marketplace.publish.submitting")}
                                  onClick={() => void submit()}
                                >
                                  {t("marketplace.publish.submit")}
                                </Button>
                              </div>
                            </div>
                          )}
                        </Show>
                        <Show when={!market.publication.preview}>
                          <Show
                            when={market.submissions.length}
                            fallback={<div class="skills-marketplace-state">{t("marketplace.mine.empty")}</div>}
                          >
                            <div class="skills-submission-list">
                              <For each={market.submissions}>
                                {(item) => (
                                  <article class="skills-submission-row">
                                    <Button
                                      variant="ghost"
                                      type="button"
                                      class="skills-marketplace-row-hitarea"
                                      aria-label={t("marketplace.submission.viewDetails", { name: item.name })}
                                      onClick={() => openSubmissionDetails(item)}
                                    />
                                    <PluginIcon iconUrl={item.iconUrl} />
                                    <div>
                                      <h3>{item.name}</h3>
                                      <p>
                                        {t("marketplace.submission.meta", {
                                          category: t(CATEGORY_LABELS[item.category]),
                                          version: item.version,
                                        })}
                                      </p>
                                      <Show when={item.rejectionNote}>
                                        <small>{item.rejectionNote}</small>
                                      </Show>
                                    </div>
                                    <span class="skills-submission-status" data-status={item.status}>
                                      {t(REVIEW_STATUS_LABEL[item.status])}
                                    </span>
                                    <Show when={item.status === "approved" || item.status === "rejected"}>
                                      <Button size="sm" onClick={() => void choosePackage(item.skillId)}>
                                        <Plus /> {t("marketplace.submission.newVersion")}
                                      </Button>
                                    </Show>
                                  </article>
                                )}
                              </For>
                            </div>
                          </Show>
                        </Show>
                      </section>
                    </Show>
                    <Show when={detailOpen()}>
                      <div class="skills-marketplace-detail-layer">
                        <Show when={!detailLoading()} fallback={<SkillDetailSkeleton />}>
                          <Show when={skillDetail()} keyed>
                            {(skill) => (
                              <SkillDetailView
                                skill={skill}
                                installed={installedById().get(skill.id)}
                                installedLoad={installedLoadForTarget()}
                                busy={panel.busy === skill.id}
                                onTrySkill={props.onTrySkill}
                                onOpenUrl={(url) => calls().openUrl(url)}
                                onInstall={install}
                                agents={props.agents}
                                targetAgentId={market.browse.targetAgentId}
                                onTargetChange={(id) =>
                                  setMarket((state) => {
                                    state.browse.targetAgentId = id;
                                  })
                                }
                              />
                            )}
                          </Show>
                          <Show when={submissionDetail()} keyed>
                            {(submission) => <SkillSubmissionDetailView submission={submission} />}
                          </Show>
                        </Show>
                      </div>
                    </Show>
                    <Show when={panel.error}>
                      {(message) => (
                        <div class="skills-marketplace-error" role="alert">
                          {message()}
                        </div>
                      )}
                    </Show>
                  </Show>
                  <Show when={market.browse.kind === "plugins"}>
                    <div class="skills-marketplace-panel">
                      {/* The panel keeps its own copy of the message: a failed install on the plugin
                        page is reported where the page is, not on the skills panel. */}
                      <Show when={panel.error}>
                        {(message) => (
                          <div class="skills-marketplace-error" role="alert">
                            {message()}
                          </div>
                        )}
                      </Show>
                      <Show
                        when={!missingPluginSlug()}
                        fallback={
                          <div class="skills-marketplace-state" role="status">
                            {t("marketplace.plugins.missing")}
                            <Button variant="outline" onClick={() => setMissingPluginSlug(null)}>
                              {t("marketplace.plugins.browse")}
                            </Button>
                          </div>
                        }
                      >
                        <Show
                          when={props.plugins?.length}
                          fallback={
                            <div class="skills-marketplace-state" role="status">
                              {t("marketplace.plugins.empty")}
                            </div>
                          }
                        >
                          {/* The listing and its page, arranged as the agent half arranges them: the
                            rows stay mounted and inert under the page, so leaving it keeps scroll. */}
                          <div hidden={Boolean(openPlugin())} inert={Boolean(openPlugin())}>
                            <MarketplaceCatalog
                              kind="plugins"
                              query={searchQuery()}
                              refreshVersion={0}
                              list={async (query) => ({ items: listPlugins(query), nextCursor: null })}
                              icon={(row) => <PluginIcon iconUrl={row.plugin.iconUrl} />}
                              onOpen={(row) => showPlugin(row.plugin)}
                            />
                          </div>
                          <Show when={openPlugin()} keyed>
                            {(plugin) => (
                              <MarketplacePluginDetail
                                plugin={plugin}
                                agents={props.agents}
                                targetAgentId={market.browse.targetAgentId}
                                onTargetChange={(id) =>
                                  setMarket((state) => {
                                    state.browse.targetAgentId = id;
                                  })
                                }
                                installed={pluginInstalled(plugin)}
                                removable={pluginRemovable(plugin)}
                                busy={
                                  panel.busy === `plugin:${plugin.id}` || panel.busy === `plugin-uninstall:${plugin.id}`
                                }
                                onInstall={() => installPlugin(plugin)}
                                onUninstall={() => {
                                  setUninstalling(plugin);
                                }}
                                onRunPrompt={
                                  props.onRunPluginPrompt && market.browse.targetAgentId
                                    ? (prompt) => props.onRunPluginPrompt?.(market.browse.targetAgentId, prompt)
                                    : undefined
                                }
                                onCopyLink={() => copyPluginLink(plugin.slug)}
                                onOpenUrl={openPluginUrl}
                              />
                            )}
                          </Show>
                        </Show>
                      </Show>
                    </div>
                  </Show>
                  <Show when={market.browse.kind === "agents"}>
                    <AgentMarketplacePanel
                      /* Publishing reads this computer's agents, so a joined server's agents are only
                         checked for an update, and only when their host can update them. */
                      agents={props.hostServerId ? [] : props.agents}
                      installedAgents={
                        !props.hostServerId || props.agentUpdateServerId === props.hostServerId ? props.agents : []
                      }
                      serverId={props.agentServerId}
                      updateServerId={props.hostServerId ? props.agentUpdateServerId : undefined}
                      calls={calls()}
                      view={market.browse.tab}
                      query={searchQuery()}
                      refreshVersion={agentRefreshVersion()}
                      addVersion={agentAddVersion()}
                      onInstalled={props.onAgentInstalled}
                      onEnterDetail={enterDetails}
                      onLeaveDetail={leaveDetails}
                    />
                  </Show>
                </SlidingTabs.Root>
              </div>
            </Dialog.Content>
          </Dialog.Overlay>
        </Dialog.Portal>
      </Dialog.Root>

      {/* The connect step, beside the marketplace rather than inside its content: it is a dialog of
          its own over the same surface, not a part of the page it was started from. One dialog per
          way in, opened by an install and closed by it, each handing back what connected. */}
      {/* The confirmation, beside the marketplace for the same reason the connect dialogs are: it is
          one decision over the page it was started from, not a part of that page. */}
      <Show when={uninstalling()} keyed>
        {(plugin) => (
          <PluginUninstallDialog
            open={true}
            plan={uninstallPlan(plugin)}
            busy={panel.busy === `plugin-uninstall:${plugin.id}`}
            onConfirm={() => void uninstallPlugin(plugin)}
            onCancel={() => setUninstalling(null)}
          />
        )}
      </Show>

      <Show when={connecting()} keyed>
        {(pending) => (
          <Switch>
            <Match when={pending.flow.kind === "link"}>
              <McpSignInDialog
                open={true}
                subject={pending.subject}
                onTest={testPluginApp}
                onConnected={(config) => pending.settle(config)}
                onCancel={() => pending.settle(null)}
              />
            </Match>
            <Match when={pending.flow.kind === "key" ? pending.flow : null} keyed>
              {(flow) => (
                <McpKeyDialog
                  open={true}
                  subject={pending.subject}
                  flow={flow}
                  onTest={testPluginApp}
                  onConnected={(config) => pending.settle(config)}
                  onCancel={() => pending.settle(null)}
                  onOpenUrl={openPluginUrl}
                  hostName={props.pluginHostName}
                />
              )}
            </Match>
          </Switch>
        )}
      </Show>
    </>
  );
}

/** The agent half's listing, its detail layer, and the one publication being prepared. */
interface AgentsMarketplace {
  detail: MarketplaceAgentDetail | null;
  publication: {
    category: SkillCategory;
    /** The marketplace listing a new version is for, or `undefined` for a first submission. */
    listingId: string | undefined;
    preview: AgentPublicationPreview | null;
    sourceAgentId: string;
  };
  submissions: AgentSubmission[];
}

function AgentMarketplacePanel(props: {
  /** This computer's agents, which can be published. */
  agents: Array<Pick<AgentSummary, "id" | "name" | "marketplaceSource">>;
  /** The agents whose listing offers an update; they live on `updateServerId`. */
  installedAgents: Array<Pick<AgentSummary, "id" | "name" | "marketplaceSource">>;
  view: Tab;
  query: string;
  refreshVersion: number;
  addVersion: number;
  serverId: string | undefined;
  updateServerId: string | undefined;
  calls: MarketplaceCalls;
  onInstalled?: (agent: AddedAgent, serverId?: string) => void | Promise<void>;
  onEnterDetail: (name: string, close: () => void) => void;
  onLeaveDetail: () => void;
}) {
  const { t } = useText();
  const [market, setMarket] = createStore<AgentsMarketplace>({
    detail: null,
    publication: {
      category: "other",
      listingId: undefined,
      preview: null,
      sourceAgentId: untrack(() => props.agents[0]?.id ?? ""),
    },
    submissions: [],
  });
  const { panel, run, setBusy, setError, setLoading } = createAsyncPanel(marketplaceErrorMessage);
  const [catalogRefresh, setCatalogRefresh] = createSignal(0);
  let initialized = false;
  let handledAddVersion = 0;
  let openingAgent = false;
  let publicationRequest = 0;
  let detailRequest = 0;

  createEffect(
    () => [props.view, props.refreshVersion] as const,
    ([view]) => {
      publicationRequest += 1;
      // A detail answer that arrives after the panel moved on belongs to a page that is gone.
      detailRequest += 1;
      setBusy(null);
      setMarket((state) => {
        state.detail = null;
        state.publication.preview = null;
      });
      setError(null);
      if (view === "discover") void loadAgents();
      if (view === "mine") void loadMine();
      initialized = true;
    },
  );

  createEffect(
    () => props.addVersion,
    (version) => {
      if (!initialized || version === handledAddVersion) return;
      handledAddVersion = version;
      void preparePublication();
    },
  );

  function loadAgents() {
    setCatalogRefresh((version) => version + 1);
  }

  async function loadMine() {
    setLoading(true);
    const values = await run(() => publishingCalls(props.calls).agents.listMine());
    if (values) {
      setMarket((state) => {
        state.submissions = values;
      });
    }
    setLoading(false);
  }

  async function openAgent(agent: MarketplaceAgentSummary) {
    if (openingAgent) return;
    openingAgent = true;
    const analytics = desktopAnalytics.scope();
    props.onEnterDetail(agent.name, closeAgent);
    const request = ++detailRequest;
    setLoading(true);
    const value = await run(() => props.calls.agents.get(agent.id));
    analytics.track("marketplace_action", {
      entity: "agent",
      action: "view",
      result: value ? "succeeded" : "failed",
      ...(value ? {} : { failure_code: "load_failed" }),
    });
    openingAgent = false;
    setLoading(false);
    if (request !== detailRequest) return;
    if (value) {
      setMarket((state) => {
        state.detail = value;
      });
    } else props.onLeaveDetail();
  }

  function closeAgent() {
    detailRequest += 1;
    setMarket((state) => {
      state.detail = null;
    });
    props.onLeaveDetail();
  }

  async function installAgent(agent: MarketplaceAgentDetail, update = false) {
    const installation = update ? installedAgent(agent) : undefined;
    if (installation?.marketplaceSource?.versionId === agent.versionId) return;
    const updating = Boolean(installation);
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const analytics = desktopAnalytics.scope();
    setBusy(updating ? `update:${agent.id}` : agent.id);
    const serverId = updating ? props.updateServerId : props.serverId;
    const input = {
      listingId: agent.id,
      ...(installation ? { agentId: installation.id } : {}),
      timezone,
      receiptId: crypto.randomUUID(),
    };
    const value = await run(() => props.calls.addAgent(input, serverId));
    analytics.track("marketplace_action", {
      entity: "agent",
      action: updating ? "update" : "install",
      result: value ? "succeeded" : "failed",
      ...(value ? {} : { failure_code: updating ? "update_failed" : "install_failed" }),
    });
    if (value) await props.onInstalled?.(value, serverId);
    setBusy(null);
  }

  function installedAgent(agent: MarketplaceAgentSummary) {
    const installations = props.installedAgents.filter(
      (installed) => installed.marketplaceSource?.listingId === agent.id,
    );
    return (
      installations.find((installed) => (installed.marketplaceSource?.version ?? 0) < agent.version) ?? installations[0]
    );
  }

  function agentAction(agent: MarketplaceAgentSummary): "Install" | "Update" | "Installed" {
    const installed = installedAgent(agent);
    if (!installed) return "Install";
    return installed.marketplaceSource?.versionId === ("versionId" in agent ? agent.versionId : undefined) ||
      (installed.marketplaceSource?.version ?? 0) >= agent.version
      ? "Installed"
      : "Update";
  }

  async function preparePublication(listingId?: string) {
    const agentId = market.publication.sourceAgentId || props.agents[0]?.id;
    if (!agentId) {
      setError(t("marketplace.error.publishNeedsLocal"));
      return;
    }
    setMarket((state) => {
      state.publication.listingId = listingId;
      const previous = state.submissions.find((item) => item.listingId === listingId);
      state.publication.category = previous?.category ?? "other";
    });
    await refreshPublicationPreview(agentId);
  }

  async function refreshPublicationPreview(agentId: string) {
    const request = ++publicationRequest;
    setBusy("publish");
    const value = await run(() => publishingCalls(props.calls).agents.preview(agentId));
    if (request !== publicationRequest) return;
    setMarket((state) => {
      state.publication.preview = value ?? null;
    });
    setBusy(null);
  }

  /** Drops the previewed publication and the agent it was going to update. */
  function discardPublication(): void {
    publicationRequest += 1;
    setBusy(null);
    setMarket((state) => {
      state.publication.preview = null;
      state.publication.listingId = undefined;
    });
  }

  async function submitPublication() {
    const value = market.publication.preview;
    if (!value || panel.busy !== null) return;
    const analytics = desktopAnalytics.scope();
    const listingId = market.publication.listingId;
    setBusy("submit");
    const result = await run(() =>
      publishingCalls(props.calls).agents.submit({
        agentId: value.agentId,
        category: market.publication.category,
        showCreatorAvatar: true,
        ...(listingId ? { listingId } : {}),
      }),
    );
    analytics.track("marketplace_action", {
      entity: "agent",
      action: "publish",
      result: result ? "succeeded" : "failed",
      ...(result ? {} : { failure_code: "publish_failed" }),
    });
    if (result) {
      discardPublication();
      await loadMine();
    }
    setBusy(null);
  }

  return (
    <section
      class="skills-marketplace-panel agent-marketplace-panel"
      aria-label={t("marketplace.agents.label")}
      data-preview-loading={panel.busy === "publish" ? "" : undefined}
    >
      <Show when={props.view === "discover"}>
        <div hidden={Boolean(market.detail) || panel.loading} inert={Boolean(market.detail) || panel.loading}>
          <MarketplaceCatalog
            kind="agents"
            query={props.query}
            refreshVersion={catalogRefresh()}
            homeCache={agentHomeCache(props.calls)}
            list={async (query) => {
              const page = await props.calls.agents.list(query);
              return { items: page.agents, nextCursor: page.nextCursor };
            }}
            icon={(agent) => (
              <AgentAvatar seed={agent.avatarSeed} hue={agent.avatarHue} url={agent.avatarUrl} motion="hover" />
            )}
            onOpen={openAgent}
          />
        </div>
        <Show when={panel.loading}>
          <div class="skills-marketplace-state" role="status">
            {t("marketplace.agents.loadingDetail")}
          </div>
        </Show>
        <Show when={market.detail} keyed>
          {(agent) => (
            <MarketplaceDetail
              name={agent.name}
              /* The heading carries the one-line title; the long text is the instructions below. */
              description={agent.title}
              creatorName={agent.creatorName}
              creatorAvatarUrl={agent.creatorAvatarUrl}
              icon={<AgentAvatar seed={agent.avatarSeed} hue={agent.avatarHue} url={agent.avatarUrl} motion="hover" />}
              action={
                <>
                  <Show when={agentAction(agent) === "Update"}>
                    <Button
                      disabled={panel.busy !== null}
                      loading={panel.busy === `update:${agent.id}`}
                      loadingLabel={t("marketplace.agents.updating")}
                      onClick={() => void installAgent(agent, true)}
                    >
                      {t("marketplace.agents.update")}
                    </Button>
                  </Show>
                  <Button
                    disabled={panel.busy !== null}
                    loading={panel.busy === agent.id}
                    loadingLabel={t("marketplace.agents.installing")}
                    onClick={() => void installAgent(agent)}
                  >
                    {t("marketplace.agents.install")}
                  </Button>
                </>
              }
              /* A section is offered only when it carries data, so an agent without routines does
                 not open an empty panel. */
              sections={[
                {
                  title: t("marketplace.agents.instructions"),
                  subtitle: t("marketplace.agents.instructionsHint"),
                  content: () => <p>{agent.description}</p>,
                },
                ...(agent.skills.length
                  ? [
                      {
                        title: t("marketplace.agents.skills"),
                        subtitle: t("marketplace.agents.skillsHint"),
                        content: () => (
                          <ul class="agent-marketplace-dependency-list">
                            <For each={agent.skills}>
                              {(skill) => (
                                <li>
                                  <span>{skill.name}</span>
                                  <small>{t("marketplace.version", { version: skill.version })}</small>
                                </li>
                              )}
                            </For>
                          </ul>
                        ),
                      },
                    ]
                  : []),
                ...(agent.routines.length
                  ? [
                      {
                        title: t("marketplace.agents.routines"),
                        subtitle: t("marketplace.agents.routinesHint"),
                        content: () => (
                          <ul class="agent-marketplace-routine-list">
                            <For each={agent.routines}>
                              {(routine) => (
                                <li>
                                  <span>{routine.name}</span>
                                  <p>{routine.instruction}</p>
                                  <small>
                                    {routineScheduleSummary(routine.schedule)} ·{" "}
                                    {routine.active
                                      ? t("marketplace.agents.routineActive")
                                      : t("marketplace.agents.routineInactive")}
                                  </small>
                                </li>
                              )}
                            </For>
                          </ul>
                        ),
                      },
                    ]
                  : []),
              ]}
            />
          )}
        </Show>
      </Show>

      <Show when={props.view === "mine"}>
        <div class="skills-marketplace-heading">
          <div>
            <h1>{t("marketplace.agents.mine")}</h1>
            <p>{t("marketplace.agents.mineDescription")}</p>
          </div>
          <div class="agent-marketplace-publish-picker">
            <span class="skills-agent-select-control">
              <NativeSelect
                aria-label={t("marketplace.agents.source")}
                value={market.publication.sourceAgentId}
                onChange={(event) => {
                  const agentId = event.currentTarget.value;
                  setMarket((state) => {
                    state.publication.sourceAgentId = agentId;
                  });
                  void refreshPublicationPreview(agentId);
                }}
                disabled={!props.agents.length}
              >
                <Show when={props.agents.length} fallback={<option value="">{t("marketplace.agents.noLocal")}</option>}>
                  <For each={props.agents}>{(agent) => <option value={agent.id}>{agent.name}</option>}</For>
                </Show>
              </NativeSelect>
              <ChevronDown aria-hidden="true" />
            </span>
            <Button disabled={panel.busy !== null} onClick={() => void preparePublication()}>
              <Plus /> {t("marketplace.addAgent")}
            </Button>
          </div>
        </div>
        <Show when={market.publication.preview}>
          <div class="skills-publish-card agent-publish-card" aria-busy={panel.busy === "publish" ? "true" : "false"}>
            <Show when={market.publication.preview} keyed>
              {(value) => (
                <div class="skills-publish-summary">
                  <AgentAvatar seed={value.avatarSeed} hue={value.avatarHue} url={value.avatarUrl} motion="hover" />
                  <div>
                    <h2>{value.name}</h2>
                    <p>{value.description}</p>
                    <small>
                      {t("marketplace.agents.counts", { skills: value.skills.length, routines: value.routines.length })}
                    </small>
                  </div>
                </div>
              )}
            </Show>
            <p>{t("marketplace.agents.excluded")}</p>
            <label class="marketplace-publication-category">
              {t("marketplace.publish.category")}
              <NativeSelect
                aria-label={t("marketplace.agents.category")}
                value={market.publication.category}
                onChange={(event) => {
                  const category = event.currentTarget.value;
                  if (isSkillCategory(category))
                    setMarket((state) => {
                      state.publication.category = category;
                    });
                }}
              >
                <For each={SKILL_CATEGORIES}>
                  {(category) => <option value={category}>{t(CATEGORY_LABELS[category])}</option>}
                </For>
              </NativeSelect>
            </label>
            <div class="skills-publish-actions">
              <Button variant="ghost" onClick={discardPublication}>
                {t("common.cancel")}
              </Button>
              <Button
                loading={panel.busy === "submit"}
                disabled={panel.busy !== null}
                loadingLabel={t("marketplace.publish.submitting")}
                onClick={() => void submitPublication()}
              >
                {t("marketplace.publish.submit")}
              </Button>
            </div>
          </div>
        </Show>
        <Show when={!market.publication.preview}>
          <Show
            when={!panel.loading}
            fallback={<div class="skills-marketplace-state">{t("marketplace.agents.loadingSubmissions")}</div>}
          >
            <Show
              when={market.submissions.length}
              fallback={<div class="skills-marketplace-state">{t("marketplace.agents.empty")}</div>}
            >
              <div class="skills-submission-list">
                <For each={market.submissions}>
                  {(item) => (
                    <article class="skills-submission-row agent-submission-row">
                      <AgentAvatar seed={item.avatarSeed} hue={item.avatarHue} url={item.avatarUrl} motion="hover" />
                      <div>
                        <h3>{item.name}</h3>
                        <p>
                          {t("marketplace.agents.submissionMeta", {
                            version: item.version,
                            skills: item.skillCount,
                            routines: item.routineCount,
                          })}
                        </p>
                        <Show when={item.rejectionNote}>
                          <small>{item.rejectionNote}</small>
                        </Show>
                      </div>
                      <span class="skills-submission-status" data-status={item.status}>
                        {t(REVIEW_STATUS_LABEL[item.status])}
                      </span>
                      <Show when={item.status === "approved" || item.status === "rejected"}>
                        <Button size="sm" onClick={() => void preparePublication(item.listingId)}>
                          <Plus /> {t("marketplace.submission.newVersion")}
                        </Button>
                      </Show>
                    </article>
                  )}
                </For>
              </div>
            </Show>
          </Show>
        </Show>
      </Show>
      <Show when={panel.error}>
        {(message) => (
          <div class="skills-marketplace-error" role="alert">
            {message()}
          </div>
        )}
      </Show>
    </section>
  );
}

function SkillDetailSkeleton() {
  const { t } = useText();
  return (
    <section
      class="skills-marketplace-detail skills-marketplace-detail-skeleton"
      role="status"
      aria-label={t("marketplace.skill.loading")}
    >
      <Skeleton class="skills-marketplace-detail-skeleton-back" />
      <div class="skills-marketplace-detail-hero">
        <Skeleton class="skills-marketplace-detail-skeleton-icon" />
        <div>
          <Skeleton class="skills-marketplace-detail-skeleton-category" />
          <Skeleton class="skills-marketplace-detail-skeleton-title" />
          <Skeleton class="skills-marketplace-detail-skeleton-description" />
          <div class="skills-marketplace-detail-meta">
            <Skeleton />
            <Skeleton />
            <Skeleton />
          </div>
        </div>
        <Skeleton class="skills-marketplace-detail-skeleton-action" />
      </div>
      <div class="skills-marketplace-detail-content">
        <div class="skills-marketplace-detail-instructions">
          <Skeleton class="skills-marketplace-detail-skeleton-heading" />
          <div class="skills-marketplace-detail-skeleton-copy">
            <Skeleton />
            <Skeleton />
            <Skeleton />
            <Skeleton />
          </div>
        </div>
        <aside class="skills-marketplace-detail-package">
          <Skeleton class="skills-marketplace-detail-skeleton-package-heading" />
          <Skeleton class="skills-marketplace-detail-skeleton-package-count" />
          <div class="skills-marketplace-detail-skeleton-files">
            <Skeleton />
            <Skeleton />
            <Skeleton />
            <Skeleton />
          </div>
        </aside>
      </div>
    </section>
  );
}

function SkillDetailView(props: {
  skill: MarketplaceSkillDetail;
  installed: InstalledSkill | undefined;
  installedLoad: "idle" | "loading" | "loaded" | "failed";
  busy: boolean;
  onInstall: (skill: MarketplaceSkillSummary) => Promise<void>;
  agents: Array<Pick<AgentSummary, "id" | "name">>;
  targetAgentId: string;
  onTargetChange: (id: string) => void;
  onTrySkill?: (agentId: string, skill: MarketplaceSkillDetail) => void;
  onOpenUrl: (url: string) => Promise<void>;
}) {
  const { t } = useText();
  const current = () =>
    props.installed?.state === "installed" && props.installed.installedVersion >= props.skill.version;
  const canTry = () =>
    props.onTrySkill &&
    props.targetAgentId &&
    props.installedLoad === "loaded" &&
    props.installed &&
    props.installed.enabled !== false &&
    props.installed.installedVersion === props.skill.version &&
    props.installed.state !== "needs-repair" &&
    !props.busy;
  /**
   * Why Try is off, in the order the reasons actually apply. The install state is the last thing
   * asked about: an unread or failed skills list looks exactly like an empty one, and reporting a
   * missing skill for it sends the user to install what the agent already has.
   */
  const unavailableReason = () => {
    if (!props.onTrySkill) return t("marketplace.try.openFromChat");
    if (!props.targetAgentId) return t("marketplace.try.chooseAgent");
    if (props.busy) return t("marketplace.try.waitInstall");
    if (props.installedLoad === "failed") return t("marketplace.try.readFailed");
    if (props.installedLoad !== "loaded") return t("marketplace.try.reading");
    if (!props.installed) return t("marketplace.try.install");
    if (props.installed.enabled === false) return t("marketplace.try.enable");
    if (props.installed.state === "needs-repair") return t("marketplace.try.repair");
    if (props.installed.installedVersion !== props.skill.version) return t("marketplace.try.update");
    return t("marketplace.try.composerUnavailable");
  };
  return (
    <section
      class="skills-marketplace-detail marketplace-detail-page"
      aria-label={t("marketplace.detail.label", { name: props.skill.name })}
    >
      <SkillPreview
        skill={props.skill}
        creatorName={props.skill.creatorName}
        /* The target and the install share one control, so the page states where a skill goes
           and sends it there in the same place. */
        action={
          <div class="marketplace-install-control">
            <AgentSelect agents={props.agents} value={props.targetAgentId} onChange={props.onTargetChange} />
            <Button
              loading={props.busy}
              disabled={!props.targetAgentId || current()}
              onClick={() => void props.onInstall(props.skill)}
            >
              {current()
                ? t("marketplace.skill.installed")
                : props.installed
                  ? t("marketplace.skill.update")
                  : t("marketplace.skill.install")}
            </Button>
          </div>
        }
        onTry={canTry() ? () => props.onTrySkill?.(props.targetAgentId, props.skill) : undefined}
        unavailableReason={unavailableReason()}
        onOpenUrl={props.onOpenUrl}
      />
    </section>
  );
}

function SkillSubmissionDetailView(props: { submission: SkillSubmission }) {
  const { t, format } = useText();
  return (
    <section
      class="skills-marketplace-detail"
      aria-label={t("marketplace.submission.detailsLabel", { name: props.submission.name })}
    >
      <div class="skills-marketplace-detail-hero skills-submission-detail-hero">
        <PluginIcon iconUrl={props.submission.iconUrl} />
        <div>
          <p class="skills-marketplace-detail-category">{t(CATEGORY_LABELS[props.submission.category])}</p>
          <h1>{props.submission.name}</h1>
          <p>{props.submission.description}</p>
          <div class="skills-marketplace-detail-meta">
            <span>{t("marketplace.submission.byYou")}</span>
            <span>{t("marketplace.version", { version: props.submission.version })}</span>
            <span>{format.date(new Date(props.submission.createdAt))}</span>
          </div>
        </div>
      </div>
      <div class="skills-marketplace-detail-content">
        <div class="skills-marketplace-detail-instructions">
          <h2>{t("marketplace.submission.whatItDoes")}</h2>
          <div>{props.submission.description}</div>
        </div>
        <aside class="skills-marketplace-detail-package skills-submission-detail-review">
          <h2>{t("marketplace.submission.reviewStatus")}</h2>
          <span class="skills-submission-status" data-status={props.submission.status}>
            {t(REVIEW_STATUS_LABEL[props.submission.status])}
          </span>
          <Show when={props.submission.rejectionNote}>
            {(note) => <p class="skills-submission-detail-note">{note()}</p>}
          </Show>
        </aside>
      </div>
    </section>
  );
}

function avatarImageDataUrl(image: AvatarImageInput): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < image.bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...image.bytes.subarray(offset, offset + chunkSize));
  }
  return `data:${image.mimeType};base64,${btoa(binary)}`;
}

function marketplaceErrorMessage(cause: unknown): string {
  const text = currentText();
  const message = text.errorMessage(cause, text.t("marketplace.error.actionFailed"));
  if (message === SKILL_NAME_TAKEN) return text.t("marketplace.error.skillNameTaken");
  return message;
}
