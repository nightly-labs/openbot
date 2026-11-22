import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import type {
  AddedAgent,
  ClientAgentSummary,
  GithubSkillSource,
  InstalledSkill,
  MacAutomationResult,
  MacAutomationTarget,
  MarketplaceAgentDetail,
  MarketplaceAgentQuery,
  MarketplaceAgentSkill,
  MarketplaceAgentSummary,
  MarketplaceSkillDetail,
  MarketplaceSkillQuery,
  MarketplaceSkillSummary,
  McpServerAccess,
  McpServerConfig,
  McpSignInAppState,
  McpSignInRelayPage,
  McpSignInState,
  SaveMcpSignInAppInput,
} from "@openbot/contracts/ipc";
import {
  assignedSkillCount,
  DEFAULT_MCP_SERVER_ACCESS,
  githubSkillDetail,
  isGithubSkillId,
  isOtherGithubCommit,
  isRemovableSkill,
  isSkillEnabled,
  mcpConfigErrors,
} from "@openbot/contracts/ipc";
import { createMarketplaceShareUrl, type MarketplaceListingLink } from "@openbot/contracts/marketplace-links";
import { mcpAccountFragment, mcpAccountUrl } from "@openbot/contracts/mcp-accounts";
import { type McpConnectFlow, mcpFlowFields, savedKeyFlow } from "@openbot/contracts/mcp-connect-flows";
import { createPluginShareUrl } from "@openbot/contracts/plugin-links";
import { TOAST_DURATION, toast } from "@openbot/ui";
import type { BrowserViewRuntime } from "@openbot/ui/features/browser/BrowserLiveView";
import { connectorSummary } from "@openbot/ui/features/connectors/ConnectorDetailPanel";
import { CONNECTOR_LISTINGS } from "@openbot/ui/features/connectors/connector-catalog";
import { isConnectorId } from "@openbot/ui/features/connectors/connectors";
import { safeBrowserUrl } from "@openbot/ui/features/conversation/RichMessageText";
import type {
  AgentListingState,
  GithubSkillRead,
  MarketplaceApp,
  MarketplaceAppConnection,
  MarketplaceAppStatus,
  MarketplaceAppsBlock,
  MarketplaceMacAutomation,
  MarketplaceMcpAccess,
  MarketplaceModel,
  MarketplaceServerSlots,
  MarketplaceSkillChange,
  MarketplaceSkillRef,
  SkillRead,
} from "@openbot/ui/features/marketplace/marketplace-model";
import { pluginNeedsMac } from "@openbot/ui/features/marketplace/marketplace-model";
import { serverAddress } from "@openbot/ui/features/marketplace/marketplace-view";
import type { McpConnectSubject } from "@openbot/ui/features/settings/McpConnectShell";
import {
  currentPluginAppConfig,
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
import type { McpServerSignIn, McpServerTools } from "../servers/mcp-server-tools";
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

export type MarketplaceAgentRow = Pick<
  ClientAgentSummary,
  "id" | "name" | "title" | "avatarSeed" | "avatarHue" | "avatarUrl"
> & {
  marketplaceSource?: ClientAgentSummary["marketplaceSource"];
};

export type LinkedListing =
  | { kind: "agent"; detail: MarketplaceAgentDetail }
  | { kind: "skill"; skill: MarketplaceSkillSummary };

export interface MarketplaceControllerProps {
  open: boolean;
  agents: readonly MarketplaceAgentRow[];
  activeAgentId: string;
  onOpenChange: (open: boolean) => void;
  onTrySkill?: ((agentId: string, skill: MarketplaceSkillDetail) => void) | undefined;
  onCreateSkill?: ((agentId: string) => void) | undefined;
  onAgentInstalled?: ((agent: AddedAgent, serverId?: string) => void | Promise<void>) | undefined;
  plugins?: readonly MarketplacePluginDetail[] | undefined;
  pluginServerId?: string | undefined;
  pluginsBlocked?: MarketplaceAppsBlock | undefined;
  pluginHostName?: string | undefined;
  pluginSignInRelay?: boolean | undefined;
  pluginHostView?: { runtime: BrowserViewRuntime; clipboard: boolean } | undefined;
  pluginAccounts?: boolean | undefined;
  pluginAccess?: boolean | undefined;
  hostServerId?: string | undefined;
  agentServerId?: string | undefined;
  agentUpdateServerId?: string | undefined;
  githubSkills?: boolean | undefined;
  onRunPluginPrompt?: ((agentId: string, prompt: MarketplacePluginPrompt) => void) | undefined;
  connectors?: ConnectorRegistry | undefined;
  calls?: MarketplaceCalls | undefined;
  macOS?: boolean | undefined;
  macAppsUnavailable?: boolean | undefined;
  pluginSignInApp?: boolean | undefined;
  mcpToolRuntimeNote?: string | null | undefined;
  mcpSignInRequest?: string | null | undefined;
  onMcpSignInRequestHandled?: (() => void) | undefined;
  onMcpSignIns?: ((serverId: string, states: Readonly<Record<string, McpSignInState>>) => void) | undefined;
}

export interface PendingConnect {
  subject: McpConnectSubject;
  flows: readonly [McpConnectFlow, ...McpConnectFlow[]];
  settle: (config: McpServerConfig | null) => void;
}

export interface PendingSkillConfirm {
  kind: "replace" | "remove";
  agents: string;
  settle: (confirmed: boolean) => void;
}

function sameSignInAddress(a: string, b: string): boolean {
  if (!URL.canParse(a.trim()) || !URL.canParse(b.trim())) return false;
  if (mcpAccountFragment(a) !== mcpAccountFragment(b)) return false;
  const [first, second] = [new URL(a.trim()), new URL(b.trim())];
  first.hash = "";
  second.hash = "";
  return first.href === second.href;
}

export interface PendingServerReplace {
  server: string;
  app: string;
  settle: (confirmed: boolean) => void;
}

export interface PendingAgentUpdate {
  agentName: string;
  changed: readonly { skillId: string; name: string }[];
  othersCount: number;
  settle: (replaceSkillIds: string[] | null) => void;
}

interface ChangeRemoval {
  agentId: string;
  modified: boolean;
  removal: HeldRemoval;
}

function takesUpdate(skill: InstalledSkill): boolean {
  return (
    skill.state === "update-available" ||
    skill.state === "installed" ||
    (skill.state === "modified" && skill.availableVersion > skill.installedVersion)
  );
}

function agentQuery({
  query,
  category,
  featured,
  verified,
  sort,
  cursor,
  limit,
}: MarketplaceSkillQuery): MarketplaceAgentQuery {
  return {
    query,
    cursor,
    ...(category ? { category } : {}),
    ...(featured === undefined ? {} : { featured }),
    ...(verified === undefined ? {} : { verified }),
    ...(sort === "installs" ? { sort } : {}),
    ...(limit === undefined ? {} : { limit }),
  };
}

const MAC_AUTOMATION_APP_NAME = {
  calendar: "marketplace.app.automation.app.calendar",
  contacts: "marketplace.app.automation.app.contacts",
  mail: "marketplace.app.automation.app.mail",
  notes: "marketplace.app.automation.app.notes",
  reminders: "marketplace.app.automation.app.reminders",
  messages: "marketplace.app.automation.app.messages",
  safari: "marketplace.app.automation.app.safari",
} as const satisfies Record<MacAutomationTarget, string>;

const SIGN_IN_RELAY_POLL_MS = 1_000;
const GITHUB_READ_KEPT_MS = 5 * 60_000;

export interface MarketplaceSignInRelayState {
  url: string;
  page: McpSignInRelayPage;
}

interface AddedRecord {
  agent: AddedAgent;
  serverId: string | undefined;
}

const skillSlug = (id: string) => (isGithubSkillId(id) ? "github" : id);

export function createMarketplaceController(
  props: MarketplaceControllerProps,
  serverSlots?: (tools: McpServerTools) => MarketplaceServerSlots,
) {
  const { t, format } = useText();
  const calls = () => props.calls ?? desktopMarketplaceCalls();
  const skillCalls = () => calls().agentSkills(props.hostServerId);
  const agents = createMemo(() => props.agents);
  const activeAgentId = createMemo(() => props.activeAgentId);
  const hostServerId = createMemo(() => props.hostServerId);
  const mcpSignInRequest = createMemo(() => props.mcpSignInRequest ?? null);

  const [error, setErrorText] = createSignal<string | null>(null);
  const [errorCode, setErrorCode] = createSignal<string | null>(null);
  const setError = (message: string | null, cause?: unknown) => {
    setErrorText(message);
    setErrorCode(cause === undefined ? null : errorReference(cause));
  };
  const [notice, setNotice] = createSignal("");
  const [busy, setBusy] = createStore<Record<string, true>>({});
  const mark = (key: string, on: boolean) =>
    setBusy((draft) => {
      if (on) draft[key] = true;
      else delete draft[key];
    });
  async function run<T>(work: () => Promise<T>): Promise<T | undefined> {
    setError(null);
    try {
      return await work();
    } catch (cause) {
      setError(marketplaceErrorMessage(cause), cause);
      return undefined;
    }
  }

  const [added, setAdded] = createStore<Record<string, AddedRecord>>({});
  function installation(listing: MarketplaceAgentSummary) {
    const copies = agents().filter((agent) => agent.marketplaceSource?.listingId === listing.id);
    return copies.find((agent) => (agent.marketplaceSource?.version ?? 0) < listing.version) ?? copies[0];
  }
  const canUpdate = () => !props.hostServerId || props.agentUpdateServerId === props.hostServerId;
  function agentState(listing: MarketplaceAgentSummary): AgentListingState {
    if (added[listing.id]) return "added";
    const copy = installation(listing);
    if (!copy) return "add";
    return canUpdate() && (copy.marketplaceSource?.version ?? 0) < listing.version ? "update" : "added";
  }

  const [agentUpdate, setAgentUpdate] = createSignal<PendingAgentUpdate | null>(null);
  async function askChangedSkills(
    listing: MarketplaceAgentDetail | MarketplaceAgentSummary,
    copy: MarketplaceAgentRow,
  ): Promise<MarketplaceAgentSkill[] | null> {
    const detail = "skills" in listing ? listing : await calls().agents.getListing(listing.id);
    const installed = new Map((await skillCalls().listInstalled(copy.id)).map((skill) => [skill.skillId, skill]));
    const updates = detail.skills.filter((skill) => installed.get(skill.skillId)?.installedVersion !== skill.version);
    const changed = updates.filter((skill) => installed.get(skill.skillId)?.state === "modified");
    if (changed.length === 0) return [];
    untrack(agentUpdate)?.settle(null);
    const replaceIds = await new Promise<string[] | null>((resolve) =>
      setAgentUpdate({
        agentName: copy.name,
        changed: changed.map(({ skillId, name }) => ({ skillId, name })),
        othersCount: updates.length - changed.length,
        settle: (ids) => {
          setAgentUpdate(null);
          resolve(ids);
        },
      }),
    );
    return replaceIds && changed.filter((skill) => replaceIds.includes(skill.skillId));
  }

  async function addAgent(listing: MarketplaceAgentDetail | MarketplaceAgentSummary, update = false) {
    const copy = update ? installation(listing) : undefined;
    if (copy && "versionId" in listing && copy.marketplaceSource?.versionId === listing.versionId) return true;
    const key = `agent:${listing.id}`;
    if (busy[key]) return false;
    const serverId = copy ? (props.hostServerId ? props.agentUpdateServerId : undefined) : props.agentServerId;
    const analytics = desktopAnalytics.scope();
    mark(key, true);
    const replace = copy ? await run(() => askChangedSkills(listing, copy)) : [];
    if (replace === null) {
      mark(key, false);
      return false;
    }
    const agent =
      replace &&
      (await run(() =>
        calls().addAgent(
          {
            listingId: listing.id,
            ...(copy ? { agentId: copy.id } : {}),
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
            receiptId: crypto.randomUUID(),
          },
          serverId,
        ),
      ));
    analytics.track("marketplace_action", {
      entity: "agent",
      action: copy ? "update" : "install",
      listing_slug: listing.id,
      result: agent ? "succeeded" : "failed",
      ...(agent ? {} : { failure_code: copy ? "update_failed" : "install_failed" }),
    });
    if (agent && copy && replace?.length) {
      await run(async () => {
        for (const skill of replace)
          await skillCalls().install({
            agentId: copy.id,
            skillId: skill.skillId,
            versionId: skill.versionId,
            replaceModified: true,
          });
      });
      await readInstalled(copy.id);
    }
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

  const [skills, setSkills] = createStore<{
    read: Record<string, SkillRead>;
    installed: Record<string, InstalledSkill[]>;
  }>({ read: {}, installed: {} });
  const skillReads = new Map<string, number>();
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

  let alive = true;
  onCleanup(() => {
    alive = false;
  });
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

  const [settling, setSettling] = createStore<Record<string, number>>({});
  const countSettling = (skillId: string, step: 1 | -1) =>
    setSettling((draft) => {
      const count = (draft[skillId] ?? 0) + step;
      if (count > 0) draft[skillId] = count;
      else delete draft[skillId];
    });
  const skillBusy = (skillId: string) => Boolean(busy[`skill:${skillId}`]) || (settling[skillId] ?? 0) > 0;

  const [skillConfirm, setSkillConfirm] = createSignal<PendingSkillConfirm | null>(null);
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

  const [serverReplace, setServerReplace] = createSignal<PendingServerReplace | null>(null);
  function confirmServerReplace(server: string, app: string): Promise<boolean> {
    untrack(serverReplace)?.settle(false);
    return new Promise((resolve) => {
      setServerReplace({
        server,
        app,
        settle: (confirmed) => {
          setServerReplace(null);
          resolve(confirmed);
        },
      });
    });
  }

  function skillFailure(name: string, failed: readonly string[], reasons: ReadonlySet<string>, asked: number) {
    const reason = [...reasons].join(" ");
    const text = currentText();
    return failed.length === 1 && asked === 1
      ? reason
      : text.t("marketplace.error.skillPartial", { name, agents: text.format.list(failed), reason });
  }
  function reportSkillFailure(message: string, cause: unknown) {
    if (alive) setError(message, cause);
    else actionToast.error(message);
  }

  function changeText(name: string, added: number, removed: number): string {
    const { t: text } = currentText();
    if (removed === 0) return text("marketplace.notice.skillInstalled", { name, count: added });
    if (added === 0) return text("marketplace.notice.skillRemoved", { name, count: removed });
    return text("skill.marketplace.changed", { name, count: added + removed });
  }

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
    const restores = addIds.filter((agentId) => removalHeld(host, agentId, skill.id));
    const installs: string[] = [];
    for (const agentId of addIds) {
      if (restores.includes(agentId) || storedSkill(agentId, skill.id)) continue;
      const list = skills.installed[agentId] ?? [];
      const replaces = list.some((item) => isOtherGithubCommit(skill.id, item.skillId));
      if (!replaces && skills.read[agentId] === "loaded" && assignedSkillCount(list) >= INPUT_LIMITS.agentSkills) {
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
    if (modified.length > 0 && !(await confirmSkill("remove", modified))) {
      mark(key, false);
      return;
    }
    for (const agentId of restores) cancelRemoval(host, agentId, skill.id);
    const held: ChangeRemoval[] = removes.map((entry) => ({
      ...entry,
      removal: holdRemoval(host, entry.agentId, skill.id),
    }));
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
          listing_slug: skillSlug(skill.id),
          result: "succeeded",
        });
      } catch (cause) {
        failed.push(nameOf(agentId));
        reasons.add(marketplaceErrorMessage(cause));
        lastCause = cause;
        analytics.track("marketplace_action", {
          entity: "skill",
          action: "install",
          listing_slug: skillSlug(skill.id),
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
      queueMicrotask(() => toast.dismiss(toastId));
      return true;
    };
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
            listing_slug: skillSlug(skill.id),
            result: "succeeded",
          });
        } catch (cause) {
          failed.push(nameOf(entry.agentId));
          reasons.add(marketplaceErrorMessage(cause));
          lastCause = cause;
          analytics.track("marketplace_action", {
            entity: "skill",
            action: "uninstall",
            listing_slug: skillSlug(skill.id),
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
          listing_slug: skillSlug(skill.id),
          result: "succeeded",
        });
      } catch (cause) {
        failed.push(agentName(agentId));
        reasons.add(marketplaceErrorMessage(cause));
        lastCause = cause;
        analytics.track("marketplace_action", {
          entity: "skill",
          action: "update",
          listing_slug: skillSlug(skill.id),
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
      analytics.track("marketplace_action", {
        entity: "skill",
        action,
        listing_slug: skillSlug(skillId),
        result: "succeeded",
      });
    } catch (cause) {
      setError(marketplaceErrorMessage(cause), cause);
      analytics.track("marketplace_action", {
        entity: "skill",
        action,
        listing_slug: skillSlug(skillId),
        result: "failed",
        failure_code: `${action}_failed`,
      });
    }
    mark(key, false);
  }

  const githubDetails = new Map<string, MarketplaceSkillDetail>();
  const githubReads = new Map<string, { at: number; source: GithubSkillSource }>();

  async function readGithubSkills(link: string): Promise<GithubSkillRead> {
    const read = skillCalls().readGithub;
    if (!read) return { status: "failed", message: t("error.skill.githubHostTooOld") };
    const key = `${untrack(() => props.hostServerId) ?? ""}\n${link}`;
    const kept = githubReads.get(key);
    if (kept && Date.now() - kept.at < GITHUB_READ_KEPT_MS) return { status: "found", source: kept.source };
    try {
      const source: GithubSkillSource = await read(link);
      for (const skill of source.skills) githubDetails.set(skill.id, githubSkillDetail(source, skill));
      githubReads.set(key, { at: Date.now(), source });
      return { status: "found", source };
    } catch (cause) {
      return { status: "failed", message: marketplaceErrorMessage(cause) };
    }
  }

  async function loadSkill(id: string) {
    const analytics = desktopAnalytics.scope();
    const value = githubDetails.get(id) ?? (await run(() => calls().skills.get(id)));
    analytics.track("marketplace_action", {
      entity: "skill",
      action: "view",
      listing_slug: skillSlug(id),
      result: value ? "succeeded" : "failed",
      ...(value ? {} : { failure_code: "load_failed" }),
    });
    return value;
  }

  const [servers, setServers] = createSignal<readonly McpServerConfig[]>([]);
  const heldApps = (app: MarketplacePluginApp) => {
    const rows = servers().filter((held) => isPluginAppConfig(held, app));
    return [
      ...rows.filter((row) => mcpAccountFragment(row.url) === null),
      ...rows.filter((row) => mcpAccountFragment(row.url) !== null),
    ];
  };
  const heldApp = (app: MarketplacePluginApp): McpServerConfig | undefined => heldApps(app)[0];
  const otherRowNamed = (app: MarketplacePluginApp): McpServerConfig | undefined =>
    heldApp(app) ? undefined : servers().find((row) => row.name === app.server.name);
  const [signIns, setSignIns] = createSignal<Readonly<Record<string, McpSignInState>>>({});
  const accountsOffered = (app: MarketplacePluginApp) => {
    const flow = app.server.auth?.[0];
    return (
      props.pluginAccounts === true &&
      app.server.transport === "http" &&
      flow?.kind === "link" &&
      !mcpFlowFields(flow).some((field) => field.url)
    );
  };
  const accountName = (app: MarketplacePluginApp, row: McpServerConfig) =>
    row.name === app.server.name ? app.name : row.name;
  function appConnection(app: MarketplacePluginApp): MarketplaceAppConnection {
    const rows = heldApps(app);
    const accounts = rows.map((row) => ({
      id: row.id,
      name: accountName(app, row),
      signInNeeded: signIns()[row.id]?.needsSignIn === true,
      signedIn: signIns()[row.id]?.signedIn ?? true,
      renamable: mcpAccountFragment(row.url) !== null,
    }));
    return {
      held: accounts.length > 0,
      signInNeeded: accounts.some((account) => account.signInNeeded),
      accounts,
      multipleAccounts: accounts.length > 0 && accountsOffered(app),
      keySaved: rows[0] !== undefined && savedKeyFlow(app.server.auth, rows[0]) !== null,
    };
  }
  const pluginAgentId = () => activeAgentId() || agents()[0]?.id || "";
  const pluginSkillHeld = (skillId: string) => Boolean(installedSkill(pluginAgentId(), skillId));
  function pluginStatus(plugin: MarketplacePluginDetail): MarketplaceAppStatus {
    if (plugin.apps.some((app) => appConnection(app).signInNeeded)) return "attention";
    const parts = [
      ...plugin.apps.map((app) => Boolean(heldApp(app))),
      ...plugin.skills.map((skill) => pluginSkillHeld(skill.id)),
    ];
    if (parts.length > 0 && parts.every(Boolean)) return "connected";
    return parts.some(Boolean) ? "attention" : "idle";
  }

  const localPlugins = createMemo(() => (props.plugins ?? []).map((plugin) => localizedPlugin(plugin, t)));

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
  let signInsRead = 0;
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
  function listSignIns(serverId: string): Promise<Record<string, McpSignInState>> {
    return calls()
      .mcp.listMcpSignIns(serverId)
      .then(mcpSignInRecord, () => ({}));
  }
  async function readSignIns(serverId: string) {
    const request = ++signInsRead;
    const states = await listSignIns(serverId);
    if (request === signInsRead && props.pluginServerId === serverId) setSignIns(states);
  }
  const appStatesRead = () => {
    if (props.pluginServerId && serversReadFor() !== props.pluginServerId) return false;
    const agentId = pluginAgentId();
    if (!agentId || !props.plugins?.some((plugin) => plugin.skills.length > 0)) return true;
    return skills.read[agentId] === "loaded";
  };
  createEffect(
    () => (props.open ? props.pluginServerId : undefined),
    (serverId) => {
      if (serverId) void readServers(serverId);
    },
  );
  createEffect(
    () => (props.open && props.plugins?.some((plugin) => plugin.skills.length > 0) ? pluginAgentId() : ""),
    (agentId) => {
      if (agentId && !untrack(() => skills.read[agentId])) void readInstalled(agentId);
    },
  );

  const [accessServers, setAccessServers] = createSignal<Record<string, McpServerAccess> | null>(null);
  const [accessRoles, setAccessRoles] = createSignal<readonly { id: string; name: string }[]>([]);
  const [accessBusy, setAccessBusy] = createSignal(false);
  let accessRead = 0;
  let accessRevision = 0;
  async function readAccess(serverId: string, keep = false) {
    const access = calls().mcpAccess;
    const request = ++accessRead;
    if (!keep) setAccessServers(null);
    if (!access) return;
    const roles = access.roles(serverId).catch(() => []);
    const answer = await Promise.all([access.get(serverId), roles]).catch(() => undefined);
    if (request !== accessRead) return;
    if (!answer) {
      setAccessServers(null);
      return;
    }
    accessRevision = answer[0].revision;
    setAccessRoles(answer[1]);
    setAccessServers(answer[0].servers ?? null);
  }
  createEffect(
    () => (props.open && props.pluginAccess ? props.pluginServerId : undefined),
    (serverId) => {
      if (serverId) void readAccess(serverId);
      else {
        accessRead += 1;
        setAccessServers(null);
      }
    },
  );
  const mcpAccess: MarketplaceMcpAccess = {
    entry: (mcpServerId) => accessServers()?.[mcpServerId] ?? DEFAULT_MCP_SERVER_ACCESS,
    roles: accessRoles,
    busy: accessBusy,
    set: async (changes) => {
      const serverId = props.pluginServerId;
      const access = calls().mcpAccess;
      if (!serverId || !access) return false;
      setAccessBusy(true);
      let saved = true;
      const read = accessRead;
      let revision = accessRevision;
      for (const change of changes) {
        const answer = await run(() => access.set({ ...change, revision }, serverId));
        if (!answer) {
          saved = false;
          break;
        }
        revision = answer.revision;
        if (read !== accessRead) continue;
        accessRevision = revision;
        setAccessServers(answer.servers ?? null);
      }
      if (!saved && read === accessRead && props.pluginServerId === serverId) await readAccess(serverId, true);
      setAccessBusy(false);
      return saved;
    },
  };

  const [connecting, setConnecting] = createSignal<PendingConnect | null>(null);
  const [uninstalling, setUninstalling] = createSignal<MarketplacePluginDetail | null>(null);

  function connectStep(
    app: MarketplacePluginApp,
    config: McpServerConfig,
    row: McpServerConfig = config,
  ): Promise<McpServerConfig | null> {
    const here = flowsHere(app);
    const saved = savedKeyFlow(here, row);
    const [first, ...rest] = saved ? [saved, ...here.filter((flow) => flow !== saved)] : here;
    if (!first) return Promise.resolve(config);
    return new Promise((resolve) => {
      setConnecting({
        subject: { name: app.name, iconUrl: app.iconUrl, config },
        flows: [first, ...rest],
        settle: (answer) => {
          if (answer === null) cancelSignIn();
          setConnecting(null);
          resolve(answer);
        },
      });
    });
  }

  async function testPluginApp(config: McpServerConfig) {
    const serverId = props.pluginServerId;
    if (!serverId) throw new Error(t("marketplace.error.connectNoServer"));
    return calls().mcp.testMcpServer({ config }, serverId);
  }

  const signInRelay = () => (props.pluginSignInRelay ? calls().signInRelay : undefined);
  const [relayed, setRelayed] = createSignal<MarketplaceSignInRelayState | null>(null);
  const [hostTabbed, setHostTabbed] = createSignal<{ url: string; tabId: string } | null>(null);
  let stopSignIn: (() => void) | undefined;
  let copySignIn: (() => Promise<void>) | undefined;

  async function signInPluginApp(config: McpServerConfig) {
    const serverId = props.pluginServerId;
    if (!serverId) throw new Error(t("marketplace.error.connectNoServer"));
    const relay = signInRelay();
    let waiting = true;
    const { mcp } = calls();
    const signIn = mcp.signInMcpServer({ config }, serverId);
    const stop = () => void mcp.cancelMcpSignIn({ url: config.url }, serverId).catch(() => undefined);
    const copyLink = calls().copySignInLink;
    const copy = copyLink ? () => copyLink(config.url, serverId) : undefined;
    stopSignIn = stop;
    copySignIn = copy;
    if (relay) void followSignInRelay(relay, config.url, serverId, () => waiting);
    if (relay?.hostTab && props.pluginHostView)
      void followSignInHostTab(relay.hostTab, config.url, serverId, () => waiting);
    return signIn.finally(() => {
      waiting = false;
      if (stopSignIn === stop) stopSignIn = undefined;
      if (copy && copySignIn === copy) copySignIn = undefined;
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
        if (
          current?.page.authorizeHost !== page?.authorizeHost ||
          current?.page.url !== page?.url ||
          current?.page.listening !== page?.listening
        )
          setRelayed(page ? { url, page } : null);
        await new Promise((resolve) => setTimeout(resolve, SIGN_IN_RELAY_POLL_MS));
      }
    } finally {
      setRelayed(null);
    }
  }

  async function followSignInHostTab(
    hostTab: NonNullable<MarketplaceSignInRelay["hostTab"]>,
    url: string,
    serverId: string,
    waiting: () => boolean,
  ): Promise<void> {
    try {
      while (waiting()) {
        const tabId = await hostTab(url, serverId).catch(() => null);
        if (!waiting()) return;
        const current = hostTabbed();
        if (current?.url !== url || current.tabId !== tabId) setHostTabbed(tabId ? { url, tabId } : null);
        await new Promise((resolve) => setTimeout(resolve, SIGN_IN_RELAY_POLL_MS));
      }
    } finally {
      setHostTabbed(null);
    }
  }

  async function openSignInRelay(): Promise<void> {
    const relay = signInRelay();
    const current = relayed();
    const serverId = props.pluginServerId;
    if (!relay || !current || !serverId) throw new Error(t("error.mcp.relayEnded"));
    await relay.open(current.url, serverId);
  }

  async function pasteSignInRelay(address: string): Promise<void> {
    const relay = signInRelay();
    const current = relayed();
    const serverId = props.pluginServerId;
    if (!relay || !current || !serverId) throw new Error(t("error.mcp.relayEnded"));
    await relay.paste(current.url, address, serverId);
  }

  async function copySignInLink(): Promise<void> {
    if (!copySignIn) throw new Error(t("error.mcp.relayEnded"));
    await copySignIn();
  }

  function cancelSignIn(): void {
    const stop = stopSignIn;
    stopSignIn = undefined;
    stop?.();
  }

  function mcpServerId(): string {
    const serverId = props.pluginServerId;
    if (!serverId) throw new Error(t("marketplace.error.connectNoServer"));
    return serverId;
  }
  const mcpServerKind = () => (props.pluginHostName ? "remote" : "local");

  async function changeMcpServers(
    action: "mcp_server_saved" | "mcp_server_removed" | "mcp_server_toggled",
    failureCode: string,
    change: (serverId: string) => Promise<McpServerConfig[]>,
  ): Promise<McpServerConfig[]> {
    const serverId = mcpServerId();
    const analytics = desktopAnalytics.scope();
    let next: McpServerConfig[];
    try {
      next = await change(serverId);
    } catch (cause) {
      analytics.track("team_action", {
        action,
        result: "failed",
        server_kind: mcpServerKind(),
        failure_code: failureCode,
      });
      throw cause;
    }
    analytics.track("team_action", { action, result: "succeeded", server_kind: mcpServerKind() });
    if (props.pluginServerId !== serverId) return next;
    serversRead += 1;
    setServers(next);
    setServersReadFor(serverId);
    void readSignIns(serverId);
    return next;
  }

  async function changeSignInApp(change: (serverId: string) => Promise<McpSignInAppState>) {
    const serverId = mcpServerId();
    const state = await change(serverId);
    await readSignIns(serverId);
    return state;
  }

  const mcpTools: McpServerTools = {
    servers,
    signIns,
    save: async (config) => {
      const next = await changeMcpServers("mcp_server_saved", "mcp_server_save_failed", (serverId) =>
        calls().mcp.saveMcpServer({ config }, serverId),
      );
      const saved = next.find((row) => (config.id ? row.id === config.id : row.name === config.name));
      if (!saved) throw new Error(t("mcp.panel.saveFailed"));
      return saved;
    },
    test: async (config) => {
      const serverId = mcpServerId();
      const analytics = desktopAnalytics.scope();
      const result = await calls().mcp.testMcpServer({ config }, serverId);
      analytics.track("team_action", {
        action: "mcp_server_tested",
        result: result.error ? "failed" : "succeeded",
        server_kind: mcpServerKind(),
        ...(result.error ? { failure_code: "mcp_server_test_failed" } : {}),
      });
      return result;
    },
    setEnabled: async (id, enabled) => {
      await changeMcpServers("mcp_server_toggled", "mcp_server_toggle_failed", (serverId) =>
        calls().mcp.setMcpServerEnabled({ mcpServerId: id, enabled }, serverId),
      );
    },
    toolRuntimeNote: () => props.mcpToolRuntimeNote ?? null,
    signIn: () => {
      if (!props.pluginServerId || (props.pluginHostName && !signInRelay())) return undefined;
      return mcpSignIn;
    },
    signInRequest: mcpSignInRequest,
    endSignInRequest: () => props.onMcpSignInRequestHandled?.(),
  };

  const mcpSignIn: McpServerSignIn = {
    start: async (config) => {
      const serverId = mcpServerId();
      const result = await signInPluginApp(config);
      await readSignIns(serverId);
      return result;
    },
    cancel: (url) => calls().mcp.cancelMcpSignIn({ url }, mcpServerId()),
    signOut: async (id) => {
      const serverId = mcpServerId();
      const states = await calls().mcp.signOutMcpServer({ mcpServerId: id }, serverId);
      if (props.pluginServerId === serverId) {
        signInsRead += 1;
        setSignIns(mcpSignInRecord(states));
      }
    },
    get relay() {
      const relay = signInRelay();
      if (!relay) return undefined;
      return {
        hostName: props.pluginHostName ?? "",
        page: (url: string) => {
          const current = relayed();
          return current?.url === url ? current.page : undefined;
        },
        open: (url: string) => relay.open(url, mcpServerId()),
        paste: (url: string, address: string) => relay.paste(url, address, mcpServerId()),
      };
    },
    get hostTab() {
      const view = props.pluginHostView;
      if (!signInRelay()?.hostTab || !view) return undefined;
      return {
        hostName: props.pluginHostName ?? "",
        page: (url: string) => {
          const current = hostTabbed();
          return current?.url === url
            ? { runtime: view.runtime, tabId: current.tabId, clipboard: view.clipboard }
            : undefined;
        },
      };
    },
    get app() {
      const serverId = props.pluginServerId;
      if (!props.pluginSignInApp || !serverId) return undefined;
      const { mcp } = calls();
      return {
        load: (id: string) => mcp.mcpSignInApp({ mcpServerId: id }, serverId),
        save: (input: SaveMcpSignInAppInput) =>
          changeSignInApp((serverId) => calls().mcp.saveMcpSignInApp(input, serverId)),
        remove: (id: string) =>
          changeSignInApp((serverId) => calls().mcp.removeMcpSignInApp({ mcpServerId: id }, serverId)),
      };
    },
  };
  const serverSlotsBuilt = serverSlots?.(mcpTools);

  function mcpServerApp(id: string): string | null | undefined {
    if (!props.pluginServerId || serversReadFor() !== props.pluginServerId) return undefined;
    const holds = (app: MarketplaceApp) =>
      app.kind === "custom"
        ? app.server.id === id
        : app.kind === "plugin" && app.plugin.apps.some((entry) => heldApps(entry).some((row) => row.id === id));
    return apps().find(holds)?.id ?? null;
  }

  function signInPluginServer(id: string): void {
    for (const app of apps()) {
      if (app.kind !== "plugin") continue;
      const entry = app.plugin.apps.find((candidate) => heldApps(candidate).some((row) => row.id === id));
      if (entry) {
        void reconnectPluginApp(app.plugin, entry.id, id);
        return;
      }
    }
  }

  createEffect(
    () => {
      const serverId = serversReadFor();
      const report = props.onMcpSignIns;
      return serverId && report ? { serverId, states: signIns(), report } : null;
    },
    (read) => {
      read?.report(read.serverId, read.states);
    },
  );

  function flowsHere(app: MarketplacePluginApp): McpConnectFlow[] {
    const flows = app.server.auth ?? [];
    if (!props.pluginHostName) return flows;
    return flows.filter((flow) => flow.kind === "key" || (flow.kind === "link" && Boolean(signInRelay())));
  }

  function canConnectHere(plugin: MarketplacePluginDetail, apps: readonly MarketplacePluginApp[]): boolean {
    if (pluginNeedsMac(props, { apps })) {
      setError(t("marketplace.app.blocked.mac", { name: plugin.name }));
      return false;
    }
    const hostOnly = apps.find((app) => (app.server.auth ?? []).length > 0 && flowsHere(app).length === 0);
    if (!hostOnly) return true;
    const key =
      hostOnly.server.auth?.[0]?.kind === "local"
        ? "marketplace.error.installLocalOnHost"
        : "marketplace.error.installOnHost";
    setError(t(key, { name: plugin.name }));
    return false;
  }

  function pluginAppConfig(app: MarketplacePluginApp): McpServerConfig {
    return heldApp(app) ?? createPluginAppConfig(app);
  }

  function newAccountName(app: MarketplacePluginApp): string {
    const taken = new Set(servers().map((server) => server.name.toLocaleLowerCase()));
    let count = 2;
    while (taken.has(`${app.name} ${count}`.toLocaleLowerCase())) count += 1;
    return `${app.name} ${count}`;
  }

  async function undoSkills(agentId: string, skillIds: readonly string[]) {
    for (const skillId of skillIds)
      await skillCalls()
        .uninstall({ agentId, skillId })
        .catch(() => undefined);
  }

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
      const replacing = new Map<string, McpServerConfig>();
      for (const app of plugin.apps) {
        const other = otherRowNamed(app);
        if (!other) continue;
        if (!(await confirmServerReplace(other.name, app.name))) return false;
        replacing.set(app.id, other);
      }
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
          const connected = await connectStep(app, config);
          if (!connected) {
            await undoSkills(agentId, addedSkills);
            return false;
          }
          const replaced = replacing.get(app.id);
          const sharesSignIn = replaced !== undefined && sameSignInAddress(replaced.url, connected.url);
          if (replaced && !sharesSignIn)
            setServers(await calls().mcp.removeMcpServer({ mcpServerId: replaced.id }, serverId));
          const saved = replaced && sharesSignIn ? { ...connected, id: replaced.id } : connected;
          setServers(await calls().mcp.saveMcpServer({ config: saved }, serverId));
        }
      } catch (cause) {
        await undoSkills(agentId, addedSkills);
        throw cause;
      }
      return true;
    });
    if (installed !== false) {
      analytics.track("marketplace_action", {
        entity: "plugin",
        action: "install",
        result: installed ? "succeeded" : "failed",
        listing_slug: plugin.slug,
        ...(installed ? {} : { failure_code: "install_failed" }),
      });
    }
    if (installed && plugin.skills.length > 0) await readInstalled(agentId);
    if (installed) await readSignIns(serverId);
    mark(key, false);
    if (installed) setNotice(t("marketplace.notice.appConnected", { name: plugin.name }));
    if (installed && askAccessOnInstall()) await requestPluginAccess(plugin);
    return installed === true;
  }

  const [askAccessOnInstall, setAskAccessOnInstall] = createSignal(true);
  const requestMacAutomation = () => (props.macOS && !props.pluginHostName ? calls().macAutomation : undefined);

  async function requestPluginAccess(plugin: MarketplacePluginDetail) {
    const request = requestMacAutomation();
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
    const sentences = [
      denied ? t("marketplace.app.automation.refused", { apps: denied }) : "",
      failed ? t("marketplace.app.automation.failed", { apps: failed }) : "",
    ];
    setError(sentences.filter(Boolean).join(" "));
  }

  const macAutomation: MarketplaceMacAutomation = {
    askOnInstall: askAccessOnInstall,
    setAskOnInstall: setAskAccessOnInstall,
    request: async (app) => {
      if (!busy[`app:${app.plugin.slug}`]) await requestPluginAccess(app.plugin);
    },
  };

  async function reconnectPluginApp(
    plugin: MarketplacePluginDetail,
    appId: string,
    accountId?: string | undefined,
  ): Promise<boolean> {
    const serverId = props.pluginServerId;
    if (!serverId) {
      setError(t("marketplace.error.connectNoServer"));
      return false;
    }
    const app = plugin.apps.find((candidate) => candidate.id === appId);
    const rows = app ? heldApps(app) : [];
    const refused = rows.find((candidate) => signIns()[candidate.id]?.needsSignIn) ?? rows[0];
    const row = accountId === undefined ? refused : rows.find((candidate) => candidate.id === accountId);
    if (!app || !row || !canConnectHere(plugin, [app])) return false;
    const key = `app:${plugin.slug}`;
    if (busy[key]) return false;
    mark(key, true);
    const analytics = desktopAnalytics.scope();
    const saved = await run(async () => {
      const connected = await connectStep(app, currentPluginAppConfig(row, app), row);
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

  async function addPluginAccount(plugin: MarketplacePluginDetail, app: MarketplacePluginApp): Promise<boolean> {
    const serverId = props.pluginServerId;
    if (!serverId) {
      setError(t("marketplace.error.connectNoServer"));
      return false;
    }
    if (!heldApp(app) || !accountsOffered(app) || !canConnectHere(plugin, [app])) return false;
    const key = `app:${plugin.slug}`;
    if (busy[key]) return false;
    mark(key, true);
    const base = createPluginAppConfig(app);
    const config = { ...base, name: newAccountName(app), url: mcpAccountUrl(base.url, crypto.randomUUID()) };
    const saved = await run(async () => {
      const connected = await connectStep(app, config);
      if (!connected) return false;
      setServers(await calls().mcp.saveMcpServer({ config: connected }, serverId));
      return true;
    });
    if (saved) await readSignIns(serverId);
    mark(key, false);
    if (saved) setNotice(t("marketplace.notice.appConnected", { name: config.name }));
    return saved === true;
  }

  async function renamePluginAccount(
    plugin: MarketplacePluginDetail,
    app: MarketplacePluginApp,
    accountId: string,
    name: string,
  ): Promise<boolean> {
    const serverId = props.pluginServerId;
    const row = heldApps(app).find((candidate) => candidate.id === accountId);
    const next = name.trim();
    if (!serverId || !row || mcpAccountFragment(row.url) === null) return false;
    if (next === row.name) return true;
    const key = `app:${plugin.slug}`;
    if (busy[key]) return false;
    mark(key, true);
    const saved = await run(() => calls().mcp.saveMcpServer({ config: { ...row, name: next } }, serverId));
    if (saved) setServers(saved);
    mark(key, false);
    return Boolean(saved);
  }

  async function removePluginAccount(
    plugin: MarketplacePluginDetail,
    app: MarketplacePluginApp,
    accountId: string,
  ): Promise<boolean> {
    const serverId = props.pluginServerId;
    const rows = heldApps(app);
    if (!serverId || rows.length < 2 || !rows.some((row) => row.id === accountId)) return false;
    const key = `app:${plugin.slug}`;
    if (busy[key]) return false;
    mark(key, true);
    const removed = await removeServer(accountId);
    if (removed) await readSignIns(serverId);
    mark(key, false);
    return removed;
  }

  function uninstallPlan(plugin: MarketplacePluginDetail): PluginUninstallPlan {
    return {
      pluginName: plugin.name,
      appNames: plugin.apps.flatMap((app) => heldApps(app).map((row) => row.name)),
      skillSlugs: plugin.skills.filter((skill) => pluginSkillHeld(skill.id)).map((skill) => skill.slug),
      agentName: agentName(pluginAgentId()),
    };
  }

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
    for (const [app, config] of plugin.apps.flatMap((app) => heldApps(app).map((row) => [app, row] as const))) {
      try {
        setServers(await calls().mcp.removeMcpServer({ mcpServerId: config.id }, serverId));
      } catch (cause) {
        failures.push(`${accountName(app, config)}: ${marketplaceErrorMessage(cause)}`);
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
    const next = await run(() =>
      changeMcpServers("mcp_server_removed", "mcp_server_remove_failed", (target) =>
        calls().mcp.removeMcpServer({ mcpServerId: id }, target),
      ),
    );
    if (!next) return false;
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

  function copyLink(slug: string) {
    void Promise.resolve()
      .then(() => writeClipboardText(createPluginShareUrl(slug)))
      .catch((cause) => setError(t("marketplace.error.copyLink"), cause));
  }

  function copyListingLink(link: MarketplaceListingLink) {
    void Promise.resolve()
      .then(() => writeClipboardText(createMarketplaceShareUrl(link, calls().shareOrigin)))
      .catch((cause) => setError(t("marketplace.error.copyLink"), cause));
  }

  async function readListing(link: MarketplaceListingLink): Promise<LinkedListing | undefined> {
    const analytics = desktopAnalytics.scope();
    const listing: LinkedListing | undefined = await (link.kind === "agent"
      ? calls()
          .agents.getListing(link.id)
          .then((detail) => ({ kind: "agent" as const, detail }))
      : calls()
          .skills.getBySlug(link.id)
          .then((skill) => ({ kind: "skill" as const, skill }))
    ).catch(() => undefined);
    analytics.track("marketplace_action", {
      entity: link.kind,
      action: "view",
      result: listing ? "succeeded" : "failed",
      ...(listing ? {} : { failure_code: "load_failed" }),
    });
    return listing;
  }

  const stopDialogs = () => {
    untrack(connecting)?.settle(null);
    untrack(skillConfirm)?.settle(false);
    untrack(serverReplace)?.settle(false);
    untrack(agentUpdate)?.settle(null);
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
    untrack(serverReplace)?.settle(false);
    untrack(agentUpdate)?.settle(null);
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
    skillListing: (id) => {
      const github = githubDetails.get(id);
      if (github) return Promise.resolve(github);
      if (isGithubSkillId(id)) return Promise.resolve(undefined);
      return calls()
        .skills.get(id)
        .catch(() => undefined);
    },
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
    get readGithubSkills() {
      return props.githubSkills && skillCalls().readGithub ? readGithubSkills : undefined;
    },
    get createSkill() {
      return props.onCreateSkill;
    },
    get trySkill() {
      return props.onTrySkill;
    },

    apps,
    canConnectApps: () => Boolean(props.pluginServerId),
    appsBlocked: () => props.pluginsBlocked,
    appBusy: (id) => Boolean(busy[`app:${id}`]) || connector(id)?.busy() === true,
    connectApp: (app) => installPlugin(app.plugin),
    reconnectApp: (app, appId, accountId) => reconnectPluginApp(app.plugin, appId, accountId),
    addAccount: (app, appId) => {
      const entry = app.plugin.apps.find((candidate) => candidate.id === appId);
      return entry ? addPluginAccount(app.plugin, entry) : Promise.resolve(false);
    },
    renameAccount: (app, accountId, name) => {
      const entry = app.plugin.apps.find((candidate) => heldApps(candidate).some((row) => row.id === accountId));
      return entry ? renamePluginAccount(app.plugin, entry, accountId, name) : Promise.resolve(false);
    },
    removeAccount: (app, accountId) => {
      const entry = app.plugin.apps.find((candidate) => heldApps(candidate).some((row) => row.id === accountId));
      return entry ? removePluginAccount(app.plugin, entry, accountId) : Promise.resolve(false);
    },
    get appHostName() {
      return props.pluginHostName;
    },
    get macAutomation() {
      return requestMacAutomation() ? macAutomation : undefined;
    },
    get macAppsUnavailable() {
      return props.macAppsUnavailable;
    },
    disconnectApp: (app) => setUninstalling(app.plugin),
    removeServer,
    get mcpAccess() {
      return accessServers() ? mcpAccess : undefined;
    },
    get servers() {
      return props.pluginServerId ? serverSlotsBuilt : undefined;
    },
    get runPrompt() {
      const run = props.onRunPluginPrompt;
      const agentId = pluginAgentId();
      return run && agentId ? (prompt: MarketplacePluginPrompt) => run(agentId, prompt) : undefined;
    },
    copyLink,
    copyListingLink,
    openUrl: openPluginUrl,
    connector,

    error,
    errorReference: errorCode,
    clearError: () => setError(null),
    notice,
  };

  return {
    model,
    readListing,
    appStatesRead,
    connecting,
    uninstalling,
    skillConfirm,
    serverReplace,
    agentUpdate,
    uninstallPlan,
    uninstallPlugin,
    uninstallBusy: (plugin: MarketplacePluginDetail) => Boolean(busy[`app:${plugin.slug}`]),
    cancelUninstall: () => setUninstalling(null),
    testPluginApp,
    signInPluginApp,
    signInRelayed: relayed,
    signInHostPage: () => {
      const current = hostTabbed();
      const view = props.pluginHostView;
      return current && view ? { runtime: view.runtime, tabId: current.tabId, clipboard: view.clipboard } : null;
    },
    openSignInRelay,
    pasteSignInRelay,
    cancelSignIn,
    copySignInLink: () => (calls().copySignInLink ? copySignInLink : undefined),
    openPluginUrl,
    mcpServerApp,
    signInPluginServer,
  };
}
