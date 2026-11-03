import type { InstalledSkill } from "@openbot/contracts/ipc";
import { createEffect, createMemo, createSignal, untrack } from "solid-js";
import { conversationRuntime } from "../conversation-runtime";
import type { ConversationProps } from "../conversation-types";
import { installedSkillsRequestKey, SKILL_AGENT_ID_SEPARATOR } from "../installed-skills-source";

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

/** One entry for each skill id: agents that have the same skill give the same id. */
function mergedSkills(lists: readonly InstalledSkill[][]): InstalledSkill[] {
  const skills = new Map<string, InstalledSkill>();
  for (const skill of lists.flat()) if (!skills.has(skill.skillId)) skills.set(skill.skillId, skill);
  return [...skills.values()].sort((left, right) => left.name.localeCompare(right.name));
}

export function createSkillsStore(deps: SkillsStoreDeps) {
  const [installedSkills, setInstalledSkills] = createSignal<InstalledSkill[]>([]);
  const [installedSkillsLoadFailed, setInstalledSkillsLoadFailed] = createSignal(false);
  const [installedSkillsRetry, setInstalledSkillsRetry] = createSignal(0);
  let installedSkillsRequest = 0;
  let installedSkillsSourceId: string | undefined;
  let failedInstalledSkillsAttempt: { serverId: string; sourceId: string; connectionSequence: number } | undefined;
  const agentIdsKey = createMemo(() => skillAgentIds(deps.props).join(SKILL_AGENT_ID_SEPARATOR));
  const installedSkillsSource = createMemo(() =>
    installedSkillsRequestKey(
      agentIdsKey() ? agentIdsKey().split(SKILL_AGENT_ID_SEPARATOR) : [],
      deps.props.server,
      deps.props.skillsMarketplaceOpen === true,
    ),
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
      setInstalledSkills([]);
      setInstalledSkillsLoadFailed(false);
      return;
    }
    if (visibility === "hidden") return;
    const sourceId = `${serverId}\0${agentIdsText}`;
    if (installedSkillsSourceId !== sourceId) {
      installedSkillsSourceId = sourceId;
      setInstalledSkills([]);
      setInstalledSkillsLoadFailed(false);
    }
    if (support === "unsupported") {
      failedInstalledSkillsAttempt = undefined;
      setInstalledSkills([]);
      setInstalledSkillsLoadFailed(false);
      return;
    }
    const connectionSequence = untrack(() => deps.props.server?.connectionSequence) ?? 0;
    failedInstalledSkillsAttempt = undefined;
    const runtime = conversationRuntime(deps.props);
    void Promise.allSettled(
      agentIdsText.split(SKILL_AGENT_ID_SEPARATOR).map((agentId) => runtime.agent.listInstalledSkills(agentId)),
    ).then((results) => {
      if (request !== installedSkillsRequest) return;
      const loaded = results.flatMap((result) => (result.status === "fulfilled" ? [result.value] : []));
      if (loaded.length === results.length) {
        failedInstalledSkillsAttempt = undefined;
        setInstalledSkills(mergedSkills(loaded));
        setInstalledSkillsLoadFailed(false);
        return;
      }
      failedInstalledSkillsAttempt = { serverId, sourceId, connectionSequence };
      setInstalledSkillsLoadFailed(true);
      // Preserve an already loaded catalog when every refresh fails; otherwise show what loaded.
      if (loaded.length > 0) setInstalledSkills(mergedSkills(loaded));
    });
  });

  return {
    installedSkills,
    installedSkillsLoadFailed,
  };
}
