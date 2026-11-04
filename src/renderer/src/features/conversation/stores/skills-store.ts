import type { InstalledSkill } from "@openbot/contracts/ipc";
import { createEffect, createMemo, createSignal, untrack } from "solid-js";
import { conversationRuntime } from "../conversation-runtime";
import type { ConversationProps } from "../conversation-types";
import { installedSkillsRequestKey } from "../installed-skills-source";

/** Separates the agent ids in a request key. An agent id holds no control character. */
const SKILL_AGENT_ID_SEPARATOR = "\u0001";

export interface SkillsStoreDeps {
  props: ConversationProps;
  settingsOpen: () => boolean;
}

/**
 * The agents whose skills `$` offers: the agent of the chat, or each agent of a channel. A skill tag
 * reaches every agent by its name, so a channel offers the skills of all its agents.
 */
function skillAgentIds(props: ConversationProps): string[] {
  if (props.channel) return [...new Set((props.mentionAgents ?? []).map((agent) => agent.id))].sort();
  return props.agent?.id ? [props.agent.id] : [];
}

const usable = (skill: InstalledSkill) => skill.state !== "needs-repair" && skill.enabled !== false;

/**
 * One entry for each skill id: agents that have the same skill give the same id. A usable copy wins,
 * because the composer hides a skill that needs repair or is turned off.
 */
function mergedSkills(lists: readonly InstalledSkill[][]): InstalledSkill[] {
  const skills = new Map<string, InstalledSkill>();
  for (const skill of lists.flat()) {
    const kept = skills.get(skill.skillId);
    if (!kept || (!usable(kept) && usable(skill))) skills.set(skill.skillId, skill);
  }
  return [...skills.values()].sort((left, right) => left.name.localeCompare(right.name));
}

export function createSkillsStore(deps: SkillsStoreDeps) {
  const [installedSkills, setInstalledSkills] = createSignal<InstalledSkill[]>([]);
  const [installedSkillsLoadFailed, setInstalledSkillsLoadFailed] = createSignal(false);
  const [installedSkillsRetry, setInstalledSkillsRetry] = createSignal(0);
  let installedSkillsRequest = 0;
  let installedSkillsSourceId: string | undefined;
  let failedInstalledSkillsAttempt: { serverId: string; sourceId: string; connectionSequence: number } | undefined;
  /** The last list that loaded for each agent of the current source. A failed request keeps it. */
  let skillsByAgent = new Map<string, InstalledSkill[]>();
  let skillsServerId: string | undefined;
  const showLoadedSkills = (agentIds: readonly string[]) =>
    setInstalledSkills(mergedSkills(agentIds.map((agentId) => skillsByAgent.get(agentId) ?? [])));
  const agentIdsKey = createMemo(() => skillAgentIds(deps.props).join(SKILL_AGENT_ID_SEPARATOR));
  const installedSkillsSource = createMemo(() =>
    installedSkillsRequestKey(agentIdsKey(), deps.props.server, deps.props.skillsMarketplaceOpen === true),
  );
  createEffect(
    () => `${deps.props.server?.id ?? "local"}\0${deps.props.server?.connectionSequence ?? 0}`,
    (source) => {
      const [serverId = "", connectionSequenceText] = source.split("\0");
      const failedAttempt = failedInstalledSkillsAttempt;
      if (
        failedAttempt?.serverId === serverId &&
        failedAttempt.sourceId === `${serverId}\0${untrack(agentIdsKey)}` &&
        failedAttempt.connectionSequence !== Number(connectionSequenceText)
      ) {
        setInstalledSkillsRetry((retry) => retry + 1);
      }
    },
  );
  const refreshKey = createMemo(
    () =>
      `${installedSkillsSource()}\0${installedSkillsRetry()}\0${deps.props.activeTurnId ?? ""}\0${deps.settingsOpen()}`,
  );
  createEffect(refreshKey, (source) => {
    const request = ++installedSkillsRequest;
    const [serverId = "", agentIdsText = "", support, visibility] = source.split("\0");
    if (!agentIdsText) {
      installedSkillsSourceId = undefined;
      failedInstalledSkillsAttempt = undefined;
      skillsByAgent = new Map();
      setInstalledSkills([]);
      setInstalledSkillsLoadFailed(false);
      return;
    }
    if (visibility === "hidden") return;
    const sourceId = `${serverId}\0${agentIdsText}`;
    const agentIds = agentIdsText.split(SKILL_AGENT_ID_SEPARATOR);
    if (installedSkillsSourceId !== sourceId) {
      installedSkillsSourceId = sourceId;
      // A new member of a channel keeps the skills of the other members while its own list loads.
      const kept = skillsServerId === serverId ? skillsByAgent : new Map<string, InstalledSkill[]>();
      skillsByAgent = new Map(
        agentIds.flatMap((agentId) => {
          const skills = kept.get(agentId);
          return skills ? [[agentId, skills] as const] : [];
        }),
      );
      skillsServerId = serverId;
      showLoadedSkills(agentIds);
      setInstalledSkillsLoadFailed(false);
    }
    if (support === "unsupported") {
      failedInstalledSkillsAttempt = undefined;
      skillsByAgent = new Map();
      setInstalledSkills([]);
      setInstalledSkillsLoadFailed(false);
      return;
    }
    const connectionSequence = untrack(() => deps.props.server?.connectionSequence) ?? 0;
    failedInstalledSkillsAttempt = undefined;
    const runtime = conversationRuntime(deps.props);
    void Promise.allSettled(agentIds.map((agentId) => runtime.agent.listInstalledSkills(agentId))).then((results) => {
      if (request !== installedSkillsRequest) return;
      // A failed request keeps the list that loaded before for that agent.
      results.forEach((result, index) => {
        if (result.status === "fulfilled") skillsByAgent.set(agentIds[index] ?? "", result.value);
      });
      showLoadedSkills(agentIds);
      const failed = results.some((result) => result.status === "rejected");
      failedInstalledSkillsAttempt = failed ? { serverId, sourceId, connectionSequence } : undefined;
      setInstalledSkillsLoadFailed(failed);
    });
  });

  return {
    installedSkills,
    installedSkillsLoadFailed,
  };
}
