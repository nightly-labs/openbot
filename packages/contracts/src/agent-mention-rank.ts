export interface MentionableAgent {
  name: string;
  title: string;
  description: string;
}

function foldMentionText(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "").toLocaleLowerCase();
}

export function agentMentionRank(agent: MentionableAgent, query: string): number | null {
  const folded = foldMentionText(query.trim());
  if (!folded) return 0;
  const name = foldMentionText(agent.name);
  if (name === folded) return 0;
  if (name.startsWith(folded)) return 1;
  if (name.split(/[\s\-_]+/u).some((word) => word.startsWith(folded))) return 2;
  if (name.includes(folded)) return 3;
  const title = foldMentionText(agent.title);
  if (title.includes(folded)) return 4;
  const description = foldMentionText(agent.description);
  if (description.includes(folded)) return 5;
  return `${name} ${title} ${description}`.includes(folded) ? 6 : null;
}

export function rankAgentMentions<T extends MentionableAgent>(agents: readonly T[], query: string): T[] {
  const ranked = agents.flatMap((agent) => {
    const rank = agentMentionRank(agent, query);
    return rank === null ? [] : [{ agent, rank }];
  });
  ranked.sort((left, right) => left.rank - right.rank);
  return ranked.map(({ agent }) => agent);
}
