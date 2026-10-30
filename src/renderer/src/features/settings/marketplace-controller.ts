import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import type {
  AddedAgent,
  ClientAgentSummary,
  InstalledSkill,
  MacAutomationResult,
  MacAutomationTarget,
  MarketplaceAgentDetail,
  MarketplaceAgentQuery,
  MarketplaceAgentSummary,
  MarketplaceSkillDetail,
  MarketplaceSkillQuery,
  McpServerConfig,
  McpSignInRelayPage,
  McpSignInState,
} from "@openbot/contracts/ipc";
import { assignedSkillCount, isRemovableSkill, isSkillEnabled, mcpConfigErrors } from "@openbot/contracts/ipc";
import type { McpConnectFlow } from "@openbot/contracts/mcp-connect-flows";
import { createPluginShareUrl } from "@openbot/contracts/plugin-links";
import { TOAST_DURATION, toast } from "@openbot/ui";
import { connectorSummary } from "@openbot/ui/features/connectors/ConnectorDetailPanel";
import { CONNECTOR_LISTINGS } from "@openbot/ui/features/connectors/connector-catalog";
import { isConnectorId } from "@openbot/ui/features/connectors/connectors";
import { safeBrowserUrl } from "@openbot/ui/features/conversation/RichMessageText";
import type {
  AgentListingState,
  MarketplaceApp,
  MarketplaceAppConnection,
  MarketplaceAppStatus,
  MarketplaceMacAutomation,
  MarketplaceModel,
  MarketplaceSkillChange,
  MarketplaceSkillRef,
  SkillRead,
} from "@openbot/ui/features/marketplace/marketplace-model";
import { serverAddress } from "@openbot/ui/features/marketplace/marketplace-view";
import type { McpConnectSubject } from "@openbot/ui/features/settings/McpConnectShell";
import {
  isPluginAppConfig,
  type MarketplacePluginApp,
  type MarketplacePluginDetail,
  type MarketplacePluginPrompt,
} from "@openbot/ui/features/settings/marketplace-plugins";
import type { PluginUninstallPlan } from "@openbot/ui/features/settings/PluginUninstallDialog";
import { currentText, useText } from "@openbot/ui/text";
import { errorReference } from "@openbot/user-errors";
import { createEffect, createMemo, createSignal, createStore, onCleanup, untrack } from "solid-js";
import { actionToast } from "../../action-toast";
import { desktopAnalytics } from "../../analytics";
import { writeClipboardText } from "../../clipboard";
import type { AgentSkillCalls } from "../../skills-port";
import type { ConnectorRegistry } from "../connectors/connector-registry";
import { mcpSignInRecord } from "../servers/mcp-servers";
import { desktopMarketplaceCalls, type MarketplaceCalls, type MarketplaceSignInRelay } from "./marketplace-calls";
import { createPluginAppConfig } from "./marketplace-plugin-catalog";
import { localizedPlugin } from "./marketplace-plugin-text";
import { agentHomeCache, marketplaceErrorMessage, skillHomeCache } from "./marketplace-shared";
import {
  cancelRemoval,
  type HeldRemoval,
  heldChangeSettled,
  holdRemoval,
  onHeldChangeSettled,
  releaseRemoval,
  removalHeld,
  removalWaits,
} from "./marketplace-skill-removals";

/** An agent of the server that the Marketplace is for. */
export type MarketplaceAgentRow = Pick<
  ClientAgentSummary,
  "id" | "name" | "title" | "avatarSeed" | "avatarHue" | "avatarUrl"
> & {
  marketplaceSource?: ClientAgentSummary["marketplaceSource"];
};

export interface MarketplaceControllerProps {
  open: boolean;
  /** The agents that a skill can go to. Empty for a member, who browses and installs nothing. */
  agents: readonly MarketplaceAgentRow[];
  activeAgentId: string;
  onOpenChange: (open: boolean) => void;
  onTrySkill?: ((agentId: string, skill: MarketplaceSkillDetail) => void) | undefined;
  /** Starts a chat with the agent that makes a new skill. Absent while no composer can take the request. */
  onCreateSkill?: ((agentId: string) => void) | undefined;
  /** Opens an agent that the Marketplace added. `serverId` is the joined server, or absent for this computer. */
  onAgentInstalled?: ((agent: AddedAgent, serverId?: string) => void | Promise<void>) | undefined;
  plugins?: readonly MarketplacePluginDetail[] | undefined;
  /** The server that holds the MCP servers of an app. Absent: apps show, but do not connect. */
  pluginServerId?: string | undefined;
  /** The joined server that keeps an app's credential. Absent when this computer keeps it. */
  pluginHostName?: string | undefined;
  /** The joined server in `pluginServerId` relays its sign-ins to this computer (`sign-in-relay-v1`). */
  pluginSignInRelay?: boolean | undefined;
  /** The joined server whose agents `agents` lists, when this account manages it. Absent: this computer. */
  hostServerId?: string | undefined;
  /** The joined server that a marketplace agent is added to. Absent: this computer. */
  agentServerId?: string | undefined;
  /** The joined server in `hostServerId` when its host also updates an agent. */
  agentUpdateServerId?: string | undefined;
  onRunPluginPrompt?: ((agentId: string, prompt: MarketplacePluginPrompt) => void) | undefined;
  /** The connectors of the server. Each one that this account can connect is an app. */
  connectors?: ConnectorRegistry | undefined;
  /** What the Marketplace calls. Absent: this computer's bridge. */
  calls?: MarketplaceCalls | undefined;
  /** This computer runs macOS, so an app that drives Apple apps can ask for their Automation access. */
  macOS?: boolean | undefined;
  /** Opens the form that adds a custom MCP server. Absent when the user cannot add one. */
  onAddServer?: (() => void) | undefined;
}

/** The connect step of one app. `settle(null)` is a closed dialog. */
export interface PendingConnect {
  subject: McpConnectSubject;
  flow: McpConnectFlow;
  settle: (config: McpServerConfig | null) => void;
}

/** A confirmation that a skill change asks for before it replaces or removes a changed copy. */
export interface PendingSkillConfirm {
  kind: "replace" | "remove";
  /** The agents whose copy has local changes, as a list. */
  agents: string;
  settle: (confirmed: boolean) => void;
}

/** A remove of one change, and whether its copy has local changes. */
interface ChangeRemoval {
  agentId: string;
  modified: boolean;
  removal: HeldRemoval;
}

/**
 * The copy can take the newest version. The caller chose the agents: an `installed` copy can be older
 * than the listing before the host reads the new version. A changed copy also needs a confirmation.
 */
function takesUpdate(skill: InstalledSkill): boolean {
  return (
    skill.state === "update-available" ||
    skill.state === "installed" ||
    (skill.state === "modified" && skill.availableVersion > skill.installedVersion)
  );
}

/** The agent catalog has no source filter, and it orders only by installs. */
function agentQuery({ query, category, featured, sort, cursor, limit }: MarketplaceSkillQuery): MarketplaceAgentQuery {
  return {
    query,
    cursor,
    ...(category ? { category } : {}),
    ...(featured === undefined ? {} : { featured }),
    ...(sort === "installs" ? { sort } : {}),
    ...(limit === undefined ? {} : { limit }),
  };
}

/** The name macOS shows for each Apple app, in the reader's language. */
const MAC_AUTOMATION_APP_NAME = {
  calendar: "marketplace.app.automation.app.calendar",
  contacts: "marketplace.app.automation.app.contacts",
  mail: "marketplace.app.automation.app.mail",
  notes: "marketplace.app.automation.app.notes",
  reminders: "marketplace.app.automation.app.reminders",
  messages: "marketplace.app.automation.app.messages",
  safari: "marketplace.app.automation.app.safari",
} as const satisfies Record<MacAutomationTarget, string>;

/** How often the page of a relayed sign-in is read while it waits. */
const SIGN_IN_RELAY_POLL_MS = 1_000;

/** The relayed sign-in of one app while it waits. */
export interface MarketplaceSignInRelayState {
  url: string;
  page: McpSignInRelayPage;
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
  /* The window passes these as conditional props, which make a memo on each read. A memo made in an
     effect callback halts the UI, and the skill reads run in effect callbacks, so read them once here. */
  const agents = createMemo(() => props.agents);
  const activeAgentId = createMemo(() => props.activeAgentId);
  const hostServerId = createMemo(() => props.hostServerId);

  const [error, setErrorText] = createSignal<string | null>(null);
  const [errorCode, setErrorCode] = createSignal<string | null>(null);
  /** Shows `message`, with the code of `cause` when a failure gave one. */
  const setError = (message: string | null, cause?: unknown) => {
    setErrorText(message);
    setErrorCode(cause === undefined ? null : errorReference(cause));
  };
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
      setError(marketplaceErrorMessage(cause), cause);
      return undefined;
    }
  }

  /* Agents. */

  const [added, setAdded] = createStore<Record<string, AddedRecord>>({});
  /** The user's copy of a listing: the one with an older version first. */
  function installation(listing: MarketplaceAgentSummary) {
    const copies = agents().filter((agent) => agent.marketplaceSource?.listingId === listing.id);
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
    const copy = agents().find((agent) => agent.marketplaceSource?.listingId === listingId);
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
  /** What the host listed last, a remove that waits for its Undo toast included. */
  const storedSkill = (agentId: string, skillId: string) =>
    skills.installed[agentId]?.find((skill) => skill.skillId === skillId);
  const installedSkill = (agentId: string, skillId: string) =>
    removalHeld(hostServerId(), agentId, skillId) ? undefined : storedSkill(agentId, skillId);
  const installedSkills = (agentId: string): readonly InstalledSkill[] =>
    (skills.installed[agentId] ?? []).filter((skill) => !removalHeld(hostServerId(), agentId, skill.skillId));
  const agentName = (agentId: string) =>
    agents().find((agent) => agent.id === agentId)?.name ?? t("marketplace.thisAgent");

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
      setError(marketplaceErrorMessage(cause), cause);
    }
  }

  function readSkills() {
    untrack(() => {
      for (const agent of agents()) {
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

  /* False after the window closed. A held change that ends then reports through a toast. */
  let alive = true;
  onCleanup(() => {
    alive = false;
  });
  /* A held change ends after its toast closes. The window shows the result at once, then reads it again. */
  onCleanup(
    onHeldChangeSettled((settled) => {
      if (settled.host !== skillHost) return;
      if (settled.removed)
        setSkills((draft) => {
          const list = draft.installed[settled.agentId];
          if (list) draft.installed[settled.agentId] = list.filter((item) => item.skillId !== settled.skillId);
        });
      if ((skills.read[settled.agentId] ?? "idle") !== "idle") void readInstalled(settled.agentId);
    }),
  );

  /** The changes on the host that end after their toast closed, by skill id. */
  const [settling, setSettling] = createStore<Record<string, number>>({});
  const countSettling = (skillId: string, step: 1 | -1) =>
    setSettling((draft) => {
      const count = (draft[skillId] ?? 0) + step;
      if (count > 0) draft[skillId] = count;
      else delete draft[skillId];
    });
  const skillBusy = (skillId: string) => Boolean(busy[`skill:${skillId}`]) || (settling[skillId] ?? 0) > 0;

  const [skillConfirm, setSkillConfirm] = createSignal<PendingSkillConfirm | null>(null);
  /** Asks to replace or remove the changed copies of these agents. False when the user cancels. */
  function confirmSkill(kind: PendingSkillConfirm["kind"], agentNames: readonly string[]): Promise<boolean> {
    untrack(skillConfirm)?.settle(false);
    return new Promise((resolve) => {
      setSkillConfirm({
        kind,
        agents: format.list(agentNames),
        settle: (confirmed) => {
          setSkillConfirm(null);
          resolve(confirmed);
        },
      });
    });
  }

  /** One sentence for the agents that did not change: the reason alone when only one agent was asked. */
  function skillFailure(name: string, failed: readonly string[], reasons: ReadonlySet<string>, asked: number) {
    const reason = [...reasons].join(" ");
    const text = currentText();
    return failed.length === 1 && asked === 1
      ? reason
      : text.t("marketplace.error.skillPartial", { name, agents: text.format.list(failed), reason });
  }
  /** In the window while it is open, else in a toast: a change can end after the window closed. */
  function reportSkillFailure(message: string, cause: unknown) {
    if (alive) setError(message, cause);
    else actionToast.error(message);
  }

  /** The text of one change: what it added and removed, together. */
  function changeText(name: string, added: number, removed: number): string {
    const { t: text } = currentText();
    if (removed === 0) return text("marketplace.notice.skillInstalled", { name, count: added });
    if (added === 0) return text("marketplace.notice.skillRemoved", { name, count: removed });
    return text("skill.marketplace.changed", { name, count: added + removed });
  }

  /**
   * One change of the agents dialog. Adds install at once. A remove waits for the Undo toast: the
   * window shows the skill as removed, and the host removes it when the toast closes, also after the
   * window closed. Undo takes back the waiting removes and removes what this change installed. An
   * agent that refuses is named in one partial error: at its skill limit, or with a skill that
   * OpenBot cannot remove.
   */
  async function changeSkill(skill: MarketplaceSkillRef, change: MarketplaceSkillChange) {
    const key = `skill:${skill.id}`;
    if (skillBusy(skill.id)) return;
    const host = untrack(() => props.hostServerId);
    const names = new Map(agents().map((agent) => [agent.id, agent.name]));
    const nameOf = (agentId: string) => names.get(agentId) ?? t("marketplace.thisAgent");
    const removeIds = [...new Set(change.remove)].filter((agentId) => names.has(agentId));
    const addIds = [...new Set(change.add)].filter((agentId) => names.has(agentId) && !removeIds.includes(agentId));
    const failed: string[] = [];
    const reasons = new Set<string>();
    let lastCause: unknown;
    /* An add of a skill whose remove waits takes that remove back: the host still has the skill. */
    const restores = addIds.filter((agentId) => removalHeld(host, agentId, skill.id));
    const installs: string[] = [];
    for (const agentId of addIds) {
      if (restores.includes(agentId) || storedSkill(agentId, skill.id)) continue;
      const list = skills.installed[agentId] ?? [];
      if (skills.read[agentId] === "loaded" && assignedSkillCount(list) >= INPUT_LIMITS.agentSkills) {
        failed.push(nameOf(agentId));
        reasons.add(t("skill.marketplace.limitReason", { limit: INPUT_LIMITS.agentSkills }));
      } else installs.push(agentId);
    }
    const removes: Omit<ChangeRemoval, "removal">[] = [];
    for (const agentId of removeIds) {
      const copy = installedSkill(agentId, skill.id);
      if (!copy) continue;
      if (isRemovableSkill(copy)) removes.push({ agentId, modified: copy.state === "modified" });
      else {
        failed.push(nameOf(agentId));
        reasons.add(t("skill.marketplace.cannotRemove"));
      }
    }
    const asked = restores.length + installs.length + removes.length + failed.length;
    if (asked === 0) return;
    mark(key, true);
    setError(null);
    const modified = removes.filter((entry) => entry.modified).map((entry) => nameOf(entry.agentId));
    // A cancel stops the whole change, before anything changed.
    if (modified.length > 0 && !(await confirmSkill("remove", modified))) {
      mark(key, false);
      return;
    }
    for (const agentId of restores) cancelRemoval(host, agentId, skill.id);
    const held: ChangeRemoval[] = removes.map((entry) => ({
      ...entry,
      removal: holdRemoval(host, entry.agentId, skill.id),
    }));
    // The calls of this host, kept for the toast: the window can close or show another host first.
    const hostCalls = skillCalls();
    const added: string[] = [];
    for (const agentId of installs) {
      const analytics = desktopAnalytics.scope();
      try {
        await hostCalls.install({ agentId, skillId: skill.id, replaceModified: false });
        added.push(agentId);
        analytics.track("marketplace_action", {
          entity: "skill",
          action: "install",
          listing_slug: skill.id,
          result: "succeeded",
        });
      } catch (cause) {
        failed.push(nameOf(agentId));
        reasons.add(marketplaceErrorMessage(cause));
        lastCause = cause;
        analytics.track("marketplace_action", {
          entity: "skill",
          action: "install",
          listing_slug: skill.id,
          result: "failed",
          failure_code: "install_failed",
        });
      }
    }
    if (alive && host === skillHost) {
      for (const agentId of added) await readInstalled(agentId);
    }
    mark(key, false);
    const changed = restores.length + added.length + held.length;
    if (changed > 0) setNotice(changeText(skill.name, restores.length + added.length, held.length));
    if (failed.length > 0) setError(skillFailure(skill.name, failed, reasons, asked), lastCause);
    if (added.length + held.length > 0) holdChange(skill, host, hostCalls, added, held, nameOf);
  }

  /**
   * The Undo toast of one change. Its close commits the waiting removes; Undo takes them back and
   * removes what the change installed. Both work after the window closed: they use only what the
   * change kept, and report through a toast then.
   */
  function holdChange(
    skill: MarketplaceSkillRef,
    host: string | undefined,
    hostCalls: AgentSkillCalls,
    added: readonly string[],
    held: readonly ChangeRemoval[],
    nameOf: (agentId: string) => string,
  ) {
    const toastId = `marketplace-skill-change-${crypto.randomUUID()}`;
    let settled = false;
    const end = () => {
      if (settled) return false;
      settled = true;
      // A cleanup can call this, and a write to the Toaster from there stops the reactive system.
      queueMicrotask(() => toast.dismiss(toastId));
      return true;
    };
    /** Removes the skill from each agent. The names of the agents that refused, and why. */
    async function removeFrom(
      entries: readonly { agentId: string; modified: boolean }[],
      afterEach: (agentId: string, removed: boolean) => void,
    ) {
      const failed: string[] = [];
      const reasons = new Set<string>();
      let lastCause: unknown;
      const counted = alive;
      if (counted) countSettling(skill.id, 1);
      for (const entry of entries) {
        const analytics = desktopAnalytics.scope();
        let removed = false;
        try {
          await hostCalls.uninstall({
            agentId: entry.agentId,
            skillId: skill.id,
            ...(entry.modified ? { removeModified: true } : {}),
          });
          removed = true;
          analytics.track("marketplace_action", {
            entity: "skill",
            action: "uninstall",
            listing_slug: skill.id,
            result: "succeeded",
          });
        } catch (cause) {
          failed.push(nameOf(entry.agentId));
          reasons.add(marketplaceErrorMessage(cause));
          lastCause = cause;
          analytics.track("marketplace_action", {
            entity: "skill",
            action: "uninstall",
            listing_slug: skill.id,
            result: "failed",
            failure_code: "uninstall_failed",
          });
        }
        heldChangeSettled({ host, agentId: entry.agentId, skillId: skill.id, removed });
        afterEach(entry.agentId, removed);
      }
      if (counted) countSettling(skill.id, -1);
      if (failed.length > 0) reportSkillFailure(skillFailure(skill.name, failed, reasons, entries.length), lastCause);
      return failed.length === 0;
    }
    async function commit() {
      if (!end()) return;
      const waiting = held.filter((entry) => removalWaits(entry.removal));
      // A failed remove shows the skill again, as the host still has it.
      await removeFrom(waiting, (agentId) => {
        const entry = waiting.find((item) => item.agentId === agentId);
        if (entry) releaseRemoval(entry.removal);
      });
    }
    async function undo() {
      if (!end()) return;
      for (const entry of held) releaseRemoval(entry.removal);
      const done = await removeFrom(
        added.map((agentId) => ({ agentId, modified: false })),
        () => undefined,
      );
      if (done && alive) setNotice(currentText().t("skill.marketplace.undone", { name: skill.name }));
    }
    const text = currentText();
    toast(changeText(skill.name, added.length, held.length), {
      id: toastId,
      duration: TOAST_DURATION,
      action: { label: text.t("conversation.threads.deleteUndo.action"), onClick: () => void undo() },
      onAutoClose: () => void commit(),
      onDismiss: () => void commit(),
    });
  }

  /** Installs the newest version on each agent that has an older one. A changed copy asks first. */
  async function updateSkill(skill: MarketplaceSkillRef, agentIds: readonly string[]) {
    const key = `skill:${skill.id}`;
    if (skillBusy(skill.id)) return;
    const targets = [...new Set(agentIds)].flatMap((agentId) => {
      const copy = installedSkill(agentId, skill.id);
      return copy && takesUpdate(copy) ? [{ agentId, modified: copy.state === "modified" }] : [];
    });
    if (targets.length === 0) return;
    mark(key, true);
    setError(null);
    const modified = targets.filter((entry) => entry.modified).map((entry) => agentName(entry.agentId));
    if (modified.length > 0 && !(await confirmSkill("replace", modified))) {
      mark(key, false);
      return;
    }
    const failed: string[] = [];
    const reasons = new Set<string>();
    let lastCause: unknown;
    for (const { agentId, modified: replaceModified } of targets) {
      const analytics = desktopAnalytics.scope();
      try {
        await skillCalls().install({ agentId, skillId: skill.id, replaceModified });
        analytics.track("marketplace_action", {
          entity: "skill",
          action: "update",
          listing_slug: skill.id,
          result: "succeeded",
        });
      } catch (cause) {
        failed.push(agentName(agentId));
        reasons.add(marketplaceErrorMessage(cause));
        lastCause = cause;
        analytics.track("marketplace_action", {
          entity: "skill",
          action: "update",
          listing_slug: skill.id,
          result: "failed",
          failure_code: "update_failed",
        });
      }
      await readInstalled(agentId);
    }
    mark(key, false);
    const changed = targets.length - failed.length;
    if (changed > 0) setNotice(t("skill.marketplace.updated", { name: skill.name, count: changed }));
    if (failed.length > 0) setError(skillFailure(skill.name, failed, reasons, targets.length), lastCause);
  }

  /** Turns the skill on or off for one agent. A changed copy, or one that needs repair, stays on. */
  async function setSkillEnabled(agentId: string, skillId: string, on: boolean) {
    const key = `skill:${skillId}`;
    const copy = installedSkill(agentId, skillId);
    if (!copy || isSkillEnabled(copy) === on || skillBusy(skillId)) return;
    const action = on ? "enable" : "disable";
    const analytics = desktopAnalytics.scope();
    mark(key, true);
    setError(null);
    try {
      const next = await skillCalls().setEnabled({ agentId, skillId, enabled: on });
      setSkills((draft) => {
        const list = draft.installed[agentId];
        if (list) draft.installed[agentId] = list.map((item) => (item.skillId === skillId ? next : item));
      });
      analytics.track("marketplace_action", { entity: "skill", action, listing_slug: skillId, result: "succeeded" });
    } catch (cause) {
      // The host refuses a changed copy and one that needs repair: `error.skill.disableModified` and
      // `error.skill.disableNeedsRepair`, in the reader's language.
      setError(marketplaceErrorMessage(cause), cause);
      analytics.track("marketplace_action", {
        entity: "skill",
        action,
        listing_slug: skillId,
        result: "failed",
        failure_code: `${action}_failed`,
      });
    }
    mark(key, false);
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
  /** Which held http rows have a sign-in, by row id. Read with the rows. */
  const [signIns, setSignIns] = createSignal<Readonly<Record<string, McpSignInState>>>({});
  function appConnection(app: MarketplacePluginApp): MarketplaceAppConnection {
    const held = heldApp(app);
    return { held: Boolean(held), signInNeeded: held ? signIns()[held.id]?.needsSignIn === true : false };
  }
  /** The agent that a plugin's skills go to: the open conversation, else the first agent. */
  const pluginAgentId = () => activeAgentId() || agents()[0]?.id || "";
  const pluginSkillHeld = (skillId: string) => Boolean(installedSkill(pluginAgentId(), skillId));
  /**
   * Connected when every app and skill is here. Something left from a partial install needs
   * attention, and so does an app whose server refused its sign-in.
   */
  function pluginStatus(plugin: MarketplacePluginDetail): MarketplaceAppStatus {
    if (plugin.apps.some((app) => appConnection(app).signInNeeded)) return "attention";
    const parts = [
      ...plugin.apps.map((app) => Boolean(heldApp(app))),
      ...plugin.skills.map((skill) => pluginSkillHeld(skill.id)),
    ];
    if (parts.length > 0 && parts.every(Boolean)) return "connected";
    return parts.some(Boolean) ? "attention" : "idle";
  }

  /** The catalog listings in the reader's language. Made once per language, not on each status change. */
  const localPlugins = createMemo(() => (props.plugins ?? []).map((plugin) => localizedPlugin(plugin, t)));

  /** The controller of a connector app that this account can connect. */
  const connector = (id: string) => {
    if (!isConnectorId(id)) return undefined;
    const entry = props.connectors?.get(id);
    return entry?.access === "available" ? entry.controller : undefined;
  };

  const apps = createMemo((): MarketplaceApp[] => {
    const plugins = localPlugins();
    return [
      ...(props.connectors?.available() ?? []).map((controller): MarketplaceApp => {
        const listing = CONNECTOR_LISTINGS[controller.id];
        const { status } = connectorSummary(controller.detail, t);
        return {
          kind: "connector",
          id: controller.id,
          connector: controller.id,
          name: t(listing.title),
          tagline: t(listing.tagline),
          category: listing.category,
          status: status === "unavailable" ? "idle" : status,
        };
      }),
      ...plugins.map(
        (plugin): MarketplaceApp => ({
          kind: "plugin",
          id: plugin.slug,
          name: plugin.name,
          tagline: plugin.tagline,
          category: plugin.category,
          status: pluginStatus(plugin),
          plugin,
          connections: Object.fromEntries(plugin.apps.map((app) => [app.id, appConnection(app)])),
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
  /** Each read of the sign-in states. An older answer does not replace a newer one. */
  let signInsRead = 0;
  /** The server whose MCP servers `servers` holds. Null before the first read ends, and while a new read runs. */
  const [serversReadFor, setServersReadFor] = createSignal<string | null>(null);
  async function readServers(serverId: string) {
    const request = ++serversRead;
    const signInRequest = ++signInsRead;
    setServersReadFor(null);
    const [configs, states] = await Promise.all([
      run(() => calls().mcp.listMcpServers(serverId)),
      listSignIns(serverId),
    ]);
    if (!configs || request !== serversRead) return;
    setServers(configs);
    if (signInRequest === signInsRead) setSignIns(states);
    setServersReadFor(serverId);
  }
  /**
   * A sign-in state is a badge beside the app, not the app: a failed read, or a host without
   * `mcp-sign-in-v1`, shows no badge rather than failing the read of the rows.
   */
  function listSignIns(serverId: string): Promise<Record<string, McpSignInState>> {
    return calls()
      .mcp.listMcpSignIns(serverId)
      .then(mcpSignInRecord, () => ({}));
  }
  /** After a save, a new sign-in can replace a refused one. */
  async function readSignIns(serverId: string) {
    const request = ++signInsRead;
    const states = await listSignIns(serverId);
    if (request === signInsRead && props.pluginServerId === serverId) setSignIns(states);
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
          // Each way out of the step that adds nothing also ends the sign-in that the step waits for.
          if (answer === null) cancelSignIn();
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

  /** The relay of a joined server, when both sides can relay a sign-in. */
  const signInRelay = () => (props.pluginSignInRelay ? calls().signInRelay : undefined);
  const [relayed, setRelayed] = createSignal<MarketplaceSignInRelayState | null>(null);
  /** Ends the sign-in that waits now, on the server and for the address that it started with. */
  let stopSignIn: (() => void) | undefined;

  /**
   * A browser sign-in for a "link" listing: opens the browser when the server asks for one. A joined
   * server that relays opens the page in this computer's browser; the paste field shows while it waits.
   */
  async function signInPluginApp(config: McpServerConfig) {
    const serverId = props.pluginServerId;
    if (!serverId) throw new Error(t("marketplace.error.connectNoServer"));
    const relay = signInRelay();
    let waiting = true;
    const { mcp } = calls();
    const signIn = mcp.signInMcpServer({ config }, serverId);
    const stop = () => void mcp.cancelMcpSignIn({ url: config.url }, serverId).catch(() => undefined);
    stopSignIn = stop;
    if (relay) void followSignInRelay(relay, config.url, serverId, () => waiting);
    return signIn.finally(() => {
      waiting = false;
      if (stopSignIn === stop) stopSignIn = undefined;
    });
  }

  async function followSignInRelay(
    relay: MarketplaceSignInRelay,
    url: string,
    serverId: string,
    waiting: () => boolean,
  ): Promise<void> {
    try {
      while (waiting()) {
        const page = await relay.page(url, serverId).catch(() => null);
        if (!waiting()) return;
        const current = relayed();
        if (current?.page.authorizeHost !== page?.authorizeHost || current?.page.listening !== page?.listening)
          setRelayed(page ? { url, page } : null);
        await new Promise((resolve) => setTimeout(resolve, SIGN_IN_RELAY_POLL_MS));
      }
    } finally {
      setRelayed(null);
    }
  }

  /** Opens the relayed sign-in page in this computer's browser, after the user checked its host name. */
  async function openSignInRelay(): Promise<void> {
    const relay = signInRelay();
    const current = relayed();
    const serverId = props.pluginServerId;
    if (!relay || !current || !serverId) throw new Error(t("error.mcp.relayEnded"));
    await relay.open(current.url, serverId);
  }

  /** The address the browser shows at the end of a relayed sign-in. Main sends only its query to the host. */
  async function pasteSignInRelay(address: string): Promise<void> {
    const relay = signInRelay();
    const current = relayed();
    const serverId = props.pluginServerId;
    if (!relay || !current || !serverId) throw new Error(t("error.mcp.relayEnded"));
    await relay.paste(current.url, address, serverId);
  }

  /**
   * Ends the sign-in that the connect step waits for, on this computer or on the host that relays it.
   * The waiting connect step then reports it as stopped.
   */
  function cancelSignIn(): void {
    const stop = stopSignIn;
    stopSignIn = undefined;
    stop?.();
  }

  /**
   * A browser sign-in saves its grant on the computer that finishes it, and a local server answers
   * only on the computer that runs it, so an app that asks for either is connected on the host
   * itself. A host that relays its sign-ins finishes a browser sign-in in this computer's browser
   * and keeps the grant itself. False, with the error shown, when one of `apps` cannot connect here.
   */
  function canConnectHere(plugin: MarketplacePluginDetail, apps: readonly MarketplacePluginApp[]): boolean {
    const hostOnly = apps.find((app) => {
      const kind = app.server.auth?.[0]?.kind ?? "";
      return kind === "local" || (kind === "link" && !signInRelay());
    });
    if (!props.hostServerId || !hostOnly) return true;
    const key =
      hostOnly.server.auth?.[0]?.kind === "local"
        ? "marketplace.error.installLocalOnHost"
        : "marketplace.error.installOnHost";
    setError(t(key, { name: plugin.name }));
    return false;
  }

  /**
   * The configuration that the connect step of `app` starts from. An app that the host holds starts
   * from its row: the save updates that row (a second row with the same name is refused), and the
   * step replaces only the fields it asks for, so the user's own changes to the row stay.
   */
  function pluginAppConfig(app: MarketplacePluginApp): McpServerConfig {
    return heldApp(app) ?? createPluginAppConfig(app);
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
    if (!canConnectHere(plugin, plugin.apps)) return false;
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
          const config = pluginAppConfig(app);
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
    if (installed) await readSignIns(serverId);
    mark(key, false);
    if (installed) setNotice(t("marketplace.notice.appConnected", { name: plugin.name }));
    if (installed && askAccessOnInstall()) await requestPluginAccess(plugin);
    return installed === true;
  }

  const [askAccessOnInstall, setAskAccessOnInstall] = createSignal(true);
  /** macOS asks only on the computer that runs the server, and only the desktop app can make it ask. */
  const requestMacAutomation = () => (props.macOS && !props.pluginHostName ? calls().macAutomation : undefined);

  /**
   * Makes macOS show the Automation prompt of each Apple app that the plugin drives, one after the
   * other, so the prompts come now and not in the middle of an agent's task. The app stays installed
   * whatever the user answers.
   */
  async function requestPluginAccess(plugin: MarketplacePluginDetail) {
    const request = requestMacAutomation();
    // Main asks each app once, so an app that two of the plugin's apps list is not asked twice.
    const targets = plugin.apps.flatMap((app) => app.macAutomation ?? []);
    const key = `app:${plugin.slug}`;
    if (!request || targets.length === 0) return;
    mark(key, true);
    const results = await run(() => request(targets));
    mark(key, false);
    if (!results) return;
    const named = (status: MacAutomationResult["status"]) =>
      format.list(
        results.filter((result) => result.status === status).map((result) => t(MAC_AUTOMATION_APP_NAME[result.target])),
      );
    const denied = named("denied");
    const failed = named("failed");
    if (!denied && !failed) {
      setNotice(t("marketplace.app.automation.allowed"));
      return;
    }
    // Only a refusal is changed in System Settings. An app that macOS was not asked about is asked again.
    const sentences = [
      denied ? t("marketplace.app.automation.refused", { apps: denied }) : "",
      failed ? t("marketplace.app.automation.failed", { apps: failed }) : "",
    ];
    setError(sentences.filter(Boolean).join(" "));
  }

  const macAutomation: MarketplaceMacAutomation = {
    askOnInstall: askAccessOnInstall,
    setAskOnInstall: setAskAccessOnInstall,
    /* The busy check is here and not in `requestPluginAccess`: the install calls that right after it
       marks the app free, before the store write is flushed, and would read the app as still busy. */
    request: async (app) => {
      if (!busy[`app:${app.plugin.slug}`]) await requestPluginAccess(app.plugin);
    },
  };

  /**
   * The connect step of one held app again, saved over its row: a new key, a new sign-in, or a
   * desktop app that answers again. The plugin's other apps and its skills do not change.
   */
  async function reconnectPluginApp(plugin: MarketplacePluginDetail, appId: string): Promise<boolean> {
    const serverId = props.pluginServerId;
    if (!serverId) {
      setError(t("marketplace.error.connectNoServer"));
      return false;
    }
    const app = plugin.apps.find((candidate) => candidate.id === appId);
    if (!app || !heldApp(app) || !canConnectHere(plugin, [app])) return false;
    const key = `app:${plugin.slug}`;
    if (busy[key]) return false;
    mark(key, true);
    const analytics = desktopAnalytics.scope();
    const saved = await run(async () => {
      const connected = await connectStep(app, pluginAppConfig(app));
      if (!connected) return false;
      setServers(await calls().mcp.saveMcpServer({ config: connected }, serverId));
      return true;
    });
    if (saved !== false) {
      analytics.track("marketplace_action", {
        entity: "plugin",
        action: "update",
        result: saved ? "succeeded" : "failed",
        listing_slug: plugin.slug,
        ...(saved ? {} : { failure_code: "update_failed" }),
      });
    }
    if (saved) await readSignIns(serverId);
    mark(key, false);
    if (saved) setNotice(t("marketplace.notice.appConnected", { name: app.name }));
    return saved === true;
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
    let lastCause: unknown;
    for (const app of plugin.apps) {
      const config = heldApp(app);
      if (!config) continue;
      try {
        setServers(await calls().mcp.removeMcpServer({ mcpServerId: config.id }, serverId));
      } catch (cause) {
        failures.push(`${app.name}: ${marketplaceErrorMessage(cause)}`);
        lastCause = cause;
      }
    }
    if (agentId) {
      for (const skill of plugin.skills) {
        if (!pluginSkillHeld(skill.id)) continue;
        try {
          await skillCalls().uninstall({ agentId, skillId: skill.id });
        } catch (cause) {
          failures.push(`${skill.slug}: ${marketplaceErrorMessage(cause)}`);
          lastCause = cause;
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
      setError(t("marketplace.error.uninstallPartial", { name: plugin.name, failures: failures.join(" ") }), lastCause);
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
      .catch((cause) => setError(t("marketplace.error.openLink"), cause));
  }

  /* The address is built from the slug rather than read from `shareUrl`, so what is copied is what the route answers. */
  function copyLink(slug: string) {
    void Promise.resolve()
      .then(() => writeClipboardText(createPluginShareUrl(slug)))
      .catch((cause) => setError(t("marketplace.error.copyLink"), cause));
  }

  /* The connect step and the confirmation are siblings of the window. Closing the window stops them. */
  const stopDialogs = () => {
    untrack(connecting)?.settle(null);
    untrack(skillConfirm)?.settle(false);
    setUninstalling(null);
  };
  createEffect(
    () => props.open,
    (open) => {
      if (!open) stopDialogs();
    },
  );
  onCleanup(() => {
    untrack(connecting)?.settle(null);
    untrack(skillConfirm)?.settle(false);
  });

  const model: MarketplaceModel = {
    listAgents: async (query) => {
      const page = await calls().agents.list(agentQuery(query));
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
    skillListing: (id) =>
      calls()
        .skills.get(id)
        .catch(() => undefined),
    agents,
    activeAgentId,
    readSkills,
    skillRead: (agentId) => skills.read[agentId] ?? "idle",
    installedSkill,
    installedSkills,
    skillBusy,
    changeSkill,
    setSkillEnabled,
    updateSkill,
    get createSkill() {
      return props.onCreateSkill;
    },
    get trySkill() {
      return props.onTrySkill;
    },

    apps,
    canConnectApps: () => Boolean(props.pluginServerId),
    appBusy: (id) => Boolean(busy[`app:${id}`]) || connector(id)?.busy() === true,
    connectApp: (app) => installPlugin(app.plugin),
    reconnectApp: (app, appId) => reconnectPluginApp(app.plugin, appId),
    get appHostName() {
      return props.pluginHostName;
    },
    get macAutomation() {
      return requestMacAutomation() ? macAutomation : undefined;
    },
    disconnectApp: (app) => setUninstalling(app.plugin),
    removeServer,
    get addServer() {
      return props.onAddServer;
    },
    get runPrompt() {
      const run = props.onRunPluginPrompt;
      const agentId = pluginAgentId();
      return run && agentId ? (prompt: MarketplacePluginPrompt) => run(agentId, prompt) : undefined;
    },
    copyLink,
    openUrl: openPluginUrl,
    connector,

    error,
    errorReference: errorCode,
    clearError: () => setError(null),
    notice,
  };

  return {
    model,
    appStatesRead,
    connecting,
    uninstalling,
    skillConfirm,
    uninstallPlan,
    uninstallPlugin,
    uninstallBusy: (plugin: MarketplacePluginDetail) => Boolean(busy[`app:${plugin.slug}`]),
    cancelUninstall: () => setUninstalling(null),
    testPluginApp,
    signInPluginApp,
    signInRelayed: relayed,
    openSignInRelay,
    pasteSignInRelay,
    cancelSignIn,
    openPluginUrl,
  };
}
