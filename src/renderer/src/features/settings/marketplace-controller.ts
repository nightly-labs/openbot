import type {
  AddedAgent,
  AgentSummary,
  InstalledSkill,
  MarketplaceAgentDetail,
  MarketplaceAgentSummary,
  MarketplaceSkillDetail,
  MarketplaceSkillSummary,
  McpServerConfig,
} from "@openbot/contracts/ipc";
import { mcpConfigErrors } from "@openbot/contracts/ipc";
import { createPluginShareUrl } from "@openbot/contracts/plugin-links";
import { safeBrowserUrl } from "@openbot/ui/features/conversation/RichMessageText";
import type {
  AgentListingState,
  MarketplaceApp,
  MarketplaceAppStatus,
  MarketplaceModel,
  SkillRead,
} from "@openbot/ui/features/marketplace/marketplace-model";
import { serverAddress } from "@openbot/ui/features/marketplace/marketplace-view";
import type { BitwardenConnectorPanelProps } from "@openbot/ui/features/settings/BitwardenConnectorPanel";
import type { McpConnectSubject } from "@openbot/ui/features/settings/McpConnectShell";
import {
  isPluginAppConfig,
  type MarketplacePluginApp,
  type MarketplacePluginDetail,
  type MarketplacePluginPrompt,
} from "@openbot/ui/features/settings/marketplace-plugins";
import type { McpConnectFlow } from "@openbot/ui/features/settings/mcp-connect-auth";
import type { PluginUninstallPlan } from "@openbot/ui/features/settings/PluginUninstallDialog";
import { useText } from "@openbot/ui/text";
import { createEffect, createMemo, createSignal, createStore, onCleanup, untrack } from "solid-js";
import { desktopAnalytics } from "../../analytics";
import { writeClipboardText } from "../../clipboard";
import { type GitHubConnectorController, githubPanelProps } from "../connectors/github-connector";
import { type OnePasswordConnectorController, onePasswordPanelProps } from "../connectors/onepassword-connector";
import { desktopMarketplaceCalls, type MarketplaceCalls } from "./marketplace-calls";
import { createPluginAppConfig } from "./marketplace-plugin-catalog";
import { agentHomeCache, marketplaceErrorMessage, skillHomeCache } from "./marketplace-shared";

/** An agent of the server that the Marketplace is for. */
export type MarketplaceAgentRow = Pick<
  AgentSummary,
  "id" | "name" | "marketplaceSource" | "avatarSeed" | "avatarHue" | "avatarUrl"
>;

export interface MarketplaceControllerProps {
  open: boolean;
  /** The agents that a skill can go to. Empty for a member, who browses and installs nothing. */
  agents: readonly MarketplaceAgentRow[];
  activeAgentId: string;
  onOpenChange: (open: boolean) => void;
  onTrySkill?: ((agentId: string, skill: MarketplaceSkillDetail) => void) | undefined;
  /** Opens an agent that the Marketplace added. `serverId` is the joined server, or absent for this computer. */
  onAgentInstalled?: ((agent: AddedAgent, serverId?: string) => void | Promise<void>) | undefined;
  plugins?: readonly MarketplacePluginDetail[] | undefined;
  /** The server that holds the MCP servers of an app. Absent: apps show, but do not connect. */
  pluginServerId?: string | undefined;
  /** The joined server that keeps an app's credential. Absent when this computer keeps it. */
  pluginHostName?: string | undefined;
  /** The joined server whose agents `agents` lists, when this account manages it. Absent: this computer. */
  hostServerId?: string | undefined;
  /** The joined server that a marketplace agent is added to. Absent: this computer. */
  agentServerId?: string | undefined;
  /** The joined server in `hostServerId` when its host also updates an agent. */
  agentUpdateServerId?: string | undefined;
  onRunPluginPrompt?: ((agentId: string, prompt: MarketplacePluginPrompt) => void) | undefined;
  /** This computer's GitHub connection, when it can have one. */
  githubConnector?: GitHubConnectorController | undefined;
  /** This computer's 1Password connection. Absent on a joined server. */
  onePasswordConnector?: OnePasswordConnectorController | undefined;
  bitwardenConnector?: BitwardenConnectorPanelProps | undefined;
  /** What the Marketplace calls. Absent: this computer's bridge. */
  calls?: MarketplaceCalls | undefined;
}

/** The connect step of one app. `settle(null)` is a closed dialog. */
export interface PendingConnect {
  subject: McpConnectSubject;
  flow: McpConnectFlow;
  settle: (config: McpServerConfig | null) => void;
}

/** An agent that the Marketplace added or updated while it was open. "Open chat" opens it. */
interface AddedRecord {
  agent: AddedAgent;
  serverId: string | undefined;
}

/**
 * The Marketplace model on the real IPC, and the dialogs that the window shows over itself. The
 * install, connect and uninstall flows are the flows of the previous Marketplace, with their
 * analytics.
 */
export function createMarketplaceController(props: MarketplaceControllerProps) {
  const { t, format } = useText();
  const calls = () => props.calls ?? desktopMarketplaceCalls();
  const skillCalls = () => calls().agentSkills(props.hostServerId);

  const [error, setError] = createSignal<string | null>(null);
  const [notice, setNotice] = createSignal("");
  /** The actions in flight: `agent:<listing>`, `skill:<skill>` and `app:<app id>`. */
  const [busy, setBusy] = createStore<Record<string, true>>({});
  const mark = (key: string, on: boolean) =>
    setBusy((draft) => {
      if (on) draft[key] = true;
      else delete draft[key];
    });
  /** Awaits `work`. A rejection becomes the error sentence, and the answer is `undefined`. */
  async function run<T>(work: () => Promise<T>): Promise<T | undefined> {
    setError(null);
    try {
      return await work();
    } catch (cause) {
      setError(marketplaceErrorMessage(cause));
      return undefined;
    }
  }

  /* Agents. */

  const [added, setAdded] = createStore<Record<string, AddedRecord>>({});
  /** The user's copy of a listing: the one with an older version first. */
  function installation(listing: MarketplaceAgentSummary) {
    const copies = props.agents.filter((agent) => agent.marketplaceSource?.listingId === listing.id);
    return copies.find((agent) => (agent.marketplaceSource?.version ?? 0) < listing.version) ?? copies[0];
  }
  /* A joined server's agent is updated only when its host serves `agent-update-v1`. */
  const canUpdate = () => !props.hostServerId || props.agentUpdateServerId === props.hostServerId;
  function agentState(listing: MarketplaceAgentSummary): AgentListingState {
    if (added[listing.id]) return "added";
    const copy = installation(listing);
    if (!copy) return "add";
    return canUpdate() && (copy.marketplaceSource?.version ?? 0) < listing.version ? "update" : "added";
  }

  async function addAgent(listing: MarketplaceAgentDetail | MarketplaceAgentSummary, update = false) {
    const copy = update ? installation(listing) : undefined;
    if (copy && "versionId" in listing && copy.marketplaceSource?.versionId === listing.versionId) return true;
    const key = `agent:${listing.id}`;
    if (busy[key]) return false;
    const serverId = copy ? (props.hostServerId ? props.agentUpdateServerId : undefined) : props.agentServerId;
    const analytics = desktopAnalytics.scope();
    mark(key, true);
    const agent = await run(() =>
      calls().addAgent(
        {
          listingId: listing.id,
          ...(copy ? { agentId: copy.id } : {}),
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          receiptId: crypto.randomUUID(),
        },
        serverId,
      ),
    );
    analytics.track("marketplace_action", {
      entity: "agent",
      action: copy ? "update" : "install",
      listing_slug: listing.id,
      result: agent ? "succeeded" : "failed",
      ...(agent ? {} : { failure_code: copy ? "update_failed" : "install_failed" }),
    });
    mark(key, false);
    if (!agent) return false;
    setAdded((draft) => {
      draft[listing.id] = { agent, serverId };
    });
    setNotice(t(copy ? "marketplace.notice.agentUpdated" : "marketplace.notice.agentAdded", { name: agent.name }));
    return true;
  }

  function openChat(listingId: string) {
    const record = added[listingId];
    const copy = props.agents.find((agent) => agent.marketplaceSource?.listingId === listingId);
    const target: AddedRecord | undefined =
      record ?? (copy ? { agent: { id: copy.id, name: copy.name }, serverId: props.hostServerId } : undefined);
    props.onOpenChange(false);
    if (target) void props.onAgentInstalled?.(target.agent, target.serverId);
  }

  async function loadAgent(id: string) {
    const analytics = desktopAnalytics.scope();
    const value = await run(() => calls().agents.get(id));
    analytics.track("marketplace_action", {
      entity: "agent",
      action: "view",
      listing_slug: id,
      result: value ? "succeeded" : "failed",
      ...(value ? {} : { failure_code: "load_failed" }),
    });
    return value;
  }

  /* Skills. Each agent's installed skills are read once, and again when its host reports a change. */

  const [skills, setSkills] = createStore<{
    read: Record<string, SkillRead>;
    installed: Record<string, InstalledSkill[]>;
  }>({ read: {}, installed: {} });
  /** The newest read of each agent, so a slow answer never replaces a newer one. */
  const skillReads = new Map<string, number>();
  const installedSkill = (agentId: string, skillId: string) =>
    skills.installed[agentId]?.find((skill) => skill.skillId === skillId);
  const agentName = (agentId: string) =>
    props.agents.find((agent) => agent.id === agentId)?.name ?? t("marketplace.thisAgent");

  async function readInstalled(agentId: string) {
    const request = (skillReads.get(agentId) ?? 0) + 1;
    skillReads.set(agentId, request);
    setSkills((draft) => {
      draft.read[agentId] = "loading";
    });
    try {
      const list = await skillCalls().listInstalled(agentId);
      if (skillReads.get(agentId) !== request) return;
      setSkills((draft) => {
        draft.installed[agentId] = list;
        draft.read[agentId] = "loaded";
      });
    } catch (cause) {
      if (skillReads.get(agentId) !== request) return;
      // A failed read is not an empty list: Try then names the failure, and install offers nothing.
      setSkills((draft) => {
        draft.read[agentId] = "failed";
      });
      setError(marketplaceErrorMessage(cause));
    }
  }

  function readSkills() {
    untrack(() => {
      for (const agent of props.agents) {
        const state = skills.read[agent.id] ?? "idle";
        if (state === "idle" || state === "failed") void readInstalled(agent.id);
      }
    });
  }

  /* The answers belong to one host. Another host starts again, and each read of the old one is dropped. */
  let skillHost = untrack(() => props.hostServerId);
  createEffect(
    () => [props.open, props.hostServerId, skillCalls()] as const,
    ([open, host, current]) => {
      if (host !== skillHost) {
        skillHost = host;
        for (const agentId of skillReads.keys()) skillReads.set(agentId, (skillReads.get(agentId) ?? 0) + 1);
        setSkills((draft) => {
          draft.read = {};
          draft.installed = {};
        });
      }
      if (!open || !current.onChanged) return;
      return current.onChanged((agentId) => {
        if ((skills.read[agentId] ?? "idle") !== "idle") void readInstalled(agentId);
      });
    },
  );

  /**
   * Installs the skill on each agent, or removes it, one agent at a time. A failure does not stop
   * the loop: each agent gets its try, and one sentence names the agents that did not change.
   */
  async function setSkill(skill: MarketplaceSkillSummary, agentIds: readonly string[], on: boolean) {
    const key = `skill:${skill.id}`;
    if (agentIds.length === 0 || busy[key]) return;
    mark(key, true);
    setError(null);
    const failed: string[] = [];
    let reason = "";
    for (const agentId of agentIds) {
      const action = on ? (installedSkill(agentId, skill.id) ? "update" : "install") : "uninstall";
      const analytics = desktopAnalytics.scope();
      try {
        if (on) await skillCalls().install({ agentId, skillId: skill.id, replaceModified: false });
        else await skillCalls().uninstall({ agentId, skillId: skill.id });
        analytics.track("marketplace_action", {
          entity: "skill",
          action,
          listing_slug: skill.id,
          result: "succeeded",
        });
      } catch (cause) {
        failed.push(agentName(agentId));
        reason = marketplaceErrorMessage(cause);
        analytics.track("marketplace_action", {
          entity: "skill",
          action,
          listing_slug: skill.id,
          result: "failed",
          failure_code: `${action}_failed`,
        });
      }
      await readInstalled(agentId);
    }
    mark(key, false);
    const changed = agentIds.length - failed.length;
    if (changed > 0)
      setNotice(
        t(on ? "marketplace.notice.skillInstalled" : "marketplace.notice.skillRemoved", {
          name: skill.name,
          count: changed,
        }),
      );
    if (failed.length === 1 && agentIds.length === 1) setError(reason);
    else if (failed.length > 0)
      setError(t("marketplace.error.skillPartial", { name: skill.name, agents: format.list(failed), reason }));
  }

  async function loadSkill(id: string) {
    const analytics = desktopAnalytics.scope();
    const value = await run(() => calls().skills.get(id));
    analytics.track("marketplace_action", {
      entity: "skill",
      action: "view",
      listing_slug: id,
      result: value ? "succeeded" : "failed",
      ...(value ? {} : { failure_code: "load_failed" }),
    });
    return value;
  }

  /* Apps. */

  /**
   * The MCP servers the host holds, whole rather than by name: an uninstall removes a row by id, and
   * a name alone cannot say which row an app's name belongs to.
   */
  const [servers, setServers] = createSignal<readonly McpServerConfig[]>([]);
  /** The row this app installed as, or nothing: a name on its own is not enough to claim a row. */
  const heldApp = (app: MarketplacePluginApp) => servers().find((held) => isPluginAppConfig(held, app));
  /** The agent that a plugin's skills go to: the open conversation, else the first agent. */
  const pluginAgentId = () => props.activeAgentId || props.agents[0]?.id || "";
  const pluginSkillHeld = (skillId: string) => Boolean(installedSkill(pluginAgentId(), skillId));
  /** Connected when every app and skill is here. Something left from a partial install needs attention. */
  function pluginStatus(plugin: MarketplacePluginDetail): MarketplaceAppStatus {
    const parts = [
      ...plugin.apps.map((app) => Boolean(heldApp(app))),
      ...plugin.skills.map((skill) => pluginSkillHeld(skill.id)),
    ];
    if (parts.length > 0 && parts.every(Boolean)) return "connected";
    return parts.some(Boolean) ? "attention" : "idle";
  }

  const githubPanel = createMemo(() => {
    const connector = props.githubConnector;
    return connector ? githubPanelProps(connector) : undefined;
  });
  const onePasswordPanel = createMemo(() => {
    const connector = props.onePasswordConnector;
    return connector ? onePasswordPanelProps(connector) : undefined;
  });

  const apps = createMemo((): MarketplaceApp[] => {
    const plugins = props.plugins ?? [];
    const github = props.githubConnector;
    const githubState = github?.status().state;
    return [
      ...(github
        ? [
            {
              kind: "github",
              id: "github",
              name: t("connector.github.title"),
              tagline: t("marketplace.app.githubTagline"),
              category: "coding",
              status: githubState === "connected" ? "connected" : githubState === "expired" ? "attention" : "idle",
            } satisfies MarketplaceApp,
          ]
        : []),
      ...(props.onePasswordConnector
        ? [
            {
              kind: "onepassword",
              id: "onepassword",
              name: t("connector.onePassword.title"),
              tagline: t("marketplace.app.onePasswordTagline"),
              category: "productivity",
              status: props.onePasswordConnector.status().state === "connected" ? "connected" : "idle",
            } satisfies MarketplaceApp,
          ]
        : []),
      ...(props.bitwardenConnector
        ? [
            {
              kind: "bitwarden",
              id: "bitwarden",
              name: t("connector.bitwarden.title"),
              tagline: t("connector.bitwarden.description"),
              category: "productivity",
              status: props.bitwardenConnector.status.connected ? "connected" : "idle",
            } satisfies MarketplaceApp,
          ]
        : []),
      ...plugins.map(
        (plugin): MarketplaceApp => ({
          kind: "plugin",
          id: plugin.slug,
          name: plugin.name,
          tagline: plugin.tagline,
          category: plugin.category,
          status: pluginStatus(plugin),
          plugin,
        }),
      ),
      // A row that no catalog app claims is a server the user added, a token plugin's row among them.
      ...servers()
        .filter((server) => !plugins.some((plugin) => plugin.apps.some((app) => isPluginAppConfig(server, app))))
        .map(
          (server): MarketplaceApp => ({
            kind: "custom",
            id: `custom:${server.id}`,
            name: server.name,
            tagline: serverAddress(server),
            status: server.enabled ? "connected" : "idle",
            server,
          }),
        ),
    ];
  });

  let serversRead = 0;
  /** The server whose MCP servers `servers` holds. Null before the first read ends, and while a new read runs. */
  const [serversReadFor, setServersReadFor] = createSignal<string | null>(null);
  async function readServers(serverId: string) {
    const request = ++serversRead;
    setServersReadFor(null);
    const configs = await run(() => calls().mcp.listMcpServers(serverId));
    if (!configs || request !== serversRead) return;
    setServers(configs);
    setServersReadFor(serverId);
  }
  /**
   * True when each app shows what the host holds: its MCP servers and, for a plugin with skills, the
   * agent's skills. Before that an installed app reads as idle. A failed read stays false.
   */
  const appStatesRead = () => {
    if (props.pluginServerId && serversReadFor() !== props.pluginServerId) return false;
    const agentId = pluginAgentId();
    if (!agentId || !props.plugins?.some((plugin) => plugin.skills.length > 0)) return true;
    return skills.read[agentId] === "loaded";
  };
  /* The apps read the host's MCP servers while the window is open, and again for another host. */
  createEffect(
    () => (props.open ? props.pluginServerId : undefined),
    (serverId) => {
      if (serverId) void readServers(serverId);
    },
  );
  /* A plugin's status also reads the skills of the agent they go to. */
  createEffect(
    () => (props.open && props.plugins?.some((plugin) => plugin.skills.length > 0) ? pluginAgentId() : ""),
    (agentId) => {
      if (agentId && !untrack(() => skills.read[agentId])) void readInstalled(agentId);
    },
  );

  const [connecting, setConnecting] = createSignal<PendingConnect | null>(null);
  /** The listing the user asked to disconnect, held while the confirmation is on screen. */
  const [uninstalling, setUninstalling] = createSignal<MarketplacePluginDetail | null>(null);

  function connectStep(app: MarketplacePluginApp, config: McpServerConfig): Promise<McpServerConfig | null> {
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

  /** Takes back only what this attempt installed. A skill the agent already had is the user's. */
  async function undoSkills(agentId: string, skillIds: readonly string[]) {
    for (const skillId of skillIds)
      await skillCalls()
        .uninstall({ agentId, skillId })
        .catch(() => undefined);
  }

  /**
   * One install, both halves: the plugin's skills go to the agent, and its apps become MCP servers
   * on the host. The skills go first, so a failure never leaves a server standing that nothing
   * knows how to drive. If a later step fails, the skills this attempt installed are removed again.
   * False when nothing was installed, also when the user closed the connect step.
   */
  async function installPlugin(plugin: MarketplacePluginDetail): Promise<boolean> {
    const serverId = props.pluginServerId;
    if (!serverId) {
      setError(t("marketplace.error.installNoServer"));
      return false;
    }
    const agentId = pluginAgentId();
    if (plugin.skills.length > 0 && !agentId) {
      setError(t("marketplace.error.installNoAgent"));
      return false;
    }
    /* A browser sign-in saves its grant on the computer that finishes it, and a local server
       answers only on the computer that runs it, so an app that asks for either is installed on
       the host itself. */
    const hostOnly = plugin.apps.find((app) => ["link", "local"].includes(app.server.auth?.[0]?.kind ?? ""));
    if (props.hostServerId && hostOnly) {
      const key =
        hostOnly.server.auth?.[0]?.kind === "local"
          ? "marketplace.error.installLocalOnHost"
          : "marketplace.error.installOnHost";
      setError(t(key, { name: plugin.name }));
      return false;
    }
    const key = `app:${plugin.slug}`;
    if (busy[key]) return false;
    mark(key, true);
    const analytics = desktopAnalytics.scope();
    const installed = await run(async () => {
      const addedSkills: string[] = [];
      try {
        for (const skill of plugin.skills) {
          const held = pluginSkillHeld(skill.id);
          await skillCalls().install({ agentId, skillId: skill.id, versionId: skill.versionId });
          if (!held) addedSkills.push(skill.id);
        }
        for (const app of plugin.apps) {
          const config = createPluginAppConfig(app);
          const invalid = Object.values(mcpConfigErrors(config))[0];
          if (invalid) throw new Error(t("marketplace.error.appInvalid", { name: app.name, reason: invalid }));
          /* What is saved is the configuration that connected, not the one the listing describes:
             the credential the user typed, or the grant the sign-in returned, is part of it. */
          const connected = await connectStep(app, config);
          if (!connected) {
            // Closing the connect dialog is a decision, not a failure: it stops without a sentence.
            await undoSkills(agentId, addedSkills);
            return false;
          }
          setServers(await calls().mcp.saveMcpServer({ config: connected }, serverId));
        }
      } catch (cause) {
        await undoSkills(agentId, addedSkills);
        throw cause;
      }
      return true;
    });
    // `false` is a closed connect dialog: the user's decision, not an install.
    if (installed !== false) {
      analytics.track("marketplace_action", {
        entity: "plugin",
        action: "install",
        result: installed ? "succeeded" : "failed",
        listing_slug: plugin.slug,
        ...(installed ? {} : { failure_code: "install_failed" }),
      });
    }
    /* Only on success: a read clears the error, which would take the failure off the screen before
       the reader saw it. */
    if (installed && plugin.skills.length > 0) await readInstalled(agentId);
    mark(key, false);
    if (installed) setNotice(t("marketplace.notice.appConnected", { name: plugin.name }));
    return installed === true;
  }

  /**
   * What a disconnect would really take, read from the host rather than from the listing. A plugin
   * can name two apps while the host holds one.
   */
  function uninstallPlan(plugin: MarketplacePluginDetail): PluginUninstallPlan {
    return {
      pluginName: plugin.name,
      appNames: plugin.apps.map((app) => heldApp(app)?.name).filter((name): name is string => Boolean(name)),
      skillSlugs: plugin.skills.filter((skill) => pluginSkillHeld(skill.id)).map((skill) => skill.slug),
      agentName: agentName(pluginAgentId()),
    };
  }

  /**
   * The install, undone: the apps first and the skills after. Every step is attempted, even after
   * one fails, and each failure is reported by name. The lists are read again either way, so the
   * page shows what the host and the agent really hold.
   */
  async function uninstallPlugin(plugin: MarketplacePluginDetail) {
    const serverId = props.pluginServerId;
    if (!serverId) {
      setError(t("marketplace.error.uninstallNoServer"));
      setUninstalling(null);
      return;
    }
    const agentId = pluginAgentId();
    const key = `app:${plugin.slug}`;
    mark(key, true);
    setError(null);
    const analytics = desktopAnalytics.scope();
    const failures: string[] = [];
    for (const app of plugin.apps) {
      const config = heldApp(app);
      if (!config) continue;
      try {
        setServers(await calls().mcp.removeMcpServer({ mcpServerId: config.id }, serverId));
      } catch (cause) {
        failures.push(`${app.name}: ${marketplaceErrorMessage(cause)}`);
      }
    }
    if (agentId) {
      for (const skill of plugin.skills) {
        if (!pluginSkillHeld(skill.id)) continue;
        try {
          await skillCalls().uninstall({ agentId, skillId: skill.id });
        } catch (cause) {
          failures.push(`${skill.slug}: ${marketplaceErrorMessage(cause)}`);
        }
      }
    }
    setUninstalling(null);
    analytics.track("marketplace_action", {
      entity: "plugin",
      action: "uninstall",
      result: failures.length > 0 ? "failed" : "succeeded",
      listing_slug: plugin.slug,
      ...(failures.length > 0 ? { failure_code: "uninstall_failed" } : {}),
    });
    /* Read back before the failure is written: the reads clear the error, and a message set first
       would be taken off screen by the read that follows it. */
    await readServers(serverId);
    if (agentId && plugin.skills.length > 0) await readInstalled(agentId);
    mark(key, false);
    if (failures.length > 0)
      setError(t("marketplace.error.uninstallPartial", { name: plugin.name, failures: failures.join(" ") }));
    else setNotice(t("marketplace.notice.appDisconnected", { name: plugin.name }));
  }

  async function removeServer(id: string) {
    const serverId = props.pluginServerId;
    if (!serverId) {
      setError(t("marketplace.error.uninstallNoServer"));
      return false;
    }
    const name = servers().find((server) => server.id === id)?.name ?? "";
    const next = await run(() => calls().mcp.removeMcpServer({ mcpServerId: id }, serverId));
    if (!next) return false;
    setServers(next);
    setNotice(t("marketplace.notice.serverRemoved", { name }));
    return true;
  }

  function openPluginUrl(url: string) {
    const safe = safeBrowserUrl(url);
    if (!safe) return;
    void calls()
      .openUrl(safe)
      .catch(() => setError(t("marketplace.error.openLink")));
  }

  /* The address is built from the slug rather than read from `shareUrl`, so what is copied is what the route answers. */
  function copyLink(slug: string) {
    void Promise.resolve()
      .then(() => writeClipboardText(createPluginShareUrl(slug)))
      .catch(() => setError(t("marketplace.error.copyLink")));
  }

  /* The connect step and the confirmation are siblings of the window. Closing the window stops them. */
  const stopDialogs = () => {
    untrack(connecting)?.settle(null);
    setUninstalling(null);
  };
  createEffect(
    () => props.open,
    (open) => {
      if (!open) stopDialogs();
    },
  );
  onCleanup(() => untrack(connecting)?.settle(null));

  const model: MarketplaceModel = {
    listAgents: async (query) => {
      const page = await calls().agents.list(query);
      return { items: page.agents, nextCursor: page.nextCursor };
    },
    get agentHomeCache() {
      return agentHomeCache(calls());
    },
    loadAgent,
    agentState,
    agentBusy: (listingId) => Boolean(busy[`agent:${listingId}`]),
    addAgent,
    openChat,

    listSkills: async (query) => {
      const page = await calls().skills.list(query);
      return { items: page.skills, nextCursor: page.nextCursor };
    },
    get skillHomeCache() {
      return skillHomeCache(calls());
    },
    loadSkill,
    agents: () => props.agents,
    activeAgentId: () => props.activeAgentId,
    readSkills,
    skillRead: (agentId) => skills.read[agentId] ?? "idle",
    installedSkill,
    skillBusy: (skillId) => Boolean(busy[`skill:${skillId}`]),
    setSkill,
    get trySkill() {
      return props.onTrySkill;
    },

    apps,
    canConnectApps: () => Boolean(props.pluginServerId),
    appBusy: (id) => Boolean(busy[`app:${id}`]),
    connectApp: async (app) => {
      if (app.kind === "plugin") return installPlugin(app.plugin);
      if (app.kind === "github") props.githubConnector?.connect();
      return false;
    },
    disconnectApp: (app) => {
      if (app.kind === "plugin") setUninstalling(app.plugin);
      if (app.kind === "github") props.githubConnector?.disconnect();
      if (app.kind === "bitwarden") props.bitwardenConnector?.onDisconnect();
      if (app.kind === "onepassword") props.onePasswordConnector?.disconnect();
    },
    removeServer,
    get runPrompt() {
      const run = props.onRunPluginPrompt;
      const agentId = pluginAgentId();
      return run && agentId ? (prompt: MarketplacePluginPrompt) => run(agentId, prompt) : undefined;
    },
    copyLink,
    openUrl: openPluginUrl,
    get github() {
      const panel = githubPanel();
      return panel ? () => panel : undefined;
    },
    get bitwarden() {
      const panel = props.bitwardenConnector;
      return panel ? () => panel : undefined;
    },
    get onePassword() {
      const panel = onePasswordPanel();
      return panel ? () => panel : undefined;
    },

    error,
    clearError: () => setError(null),
    notice,
  };

  return {
    model,
    appStatesRead,
    connecting,
    uninstalling,
    uninstallPlan,
    uninstallPlugin,
    uninstallBusy: (plugin: MarketplacePluginDetail) => Boolean(busy[`app:${plugin.slug}`]),
    cancelUninstall: () => setUninstalling(null),
    testPluginApp,
    openPluginUrl,
  };
}
