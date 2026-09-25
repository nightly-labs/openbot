import { createAgentTemplateShareUrl } from "@openbot/contracts/agent-template-links";
import type {
  AgentTemplateDetail,
  AgentTemplatePreview,
  AgentTemplatePublication,
  AgentTemplateSnapshot,
} from "@openbot/contracts/ipc";

export const STORY_AGENT_TEMPLATE_ID = "k3VfX9qLm2Rw8TzA1bN5cQ";

export const STORY_AGENT_TEMPLATE_SNAPSHOT: AgentTemplateSnapshot = {
  name: "dr eggbot",
  title: "Agent designer",
  description:
    "Designs high-quality agents. Asks a few preference questions, then creates them. Coding agents get one job, no filler, and a verified result. Other agents get the same tightness: one voice, explicit anti-jobs, and no extra tools.",
  avatarSeed: "dr-eggbot",
  avatarHue: 0,
  skills: [
    {
      kind: "embedded",
      slug: "agent-interview",
      name: "agent-interview",
      markdown:
        "---\nname: agent-interview\ndescription: Ask three questions before creating an agent.\n---\n\n# Agent interview\n\n1. Ask what the one job is.\n2. Ask what the agent must never do.\n3. Ask how the result is verified.\n",
    },
    {
      kind: "marketplace",
      skillId: "skill-linear",
      versionId: "skill-linear-v4",
      slug: "linear-triage",
      name: "Linear triage",
      version: 4,
    },
  ],
  routines: [
    {
      name: "transcript-healthcheck",
      instruction: "Read yesterday's transcripts and list agents that repeated a failed step.",
      active: true,
      schedule: { kind: "weekdays", time: "08:44" },
    },
    {
      name: "routine-healthcheck",
      instruction: "Check that every routine ran on time last week. Report the late ones.",
      active: false,
      schedule: { kind: "weekly", weekday: 1, time: "08:49" },
    },
  ],
};

export const STORY_AGENT_TEMPLATE_PUBLICATION: AgentTemplatePublication = {
  templateId: STORY_AGENT_TEMPLATE_ID,
  shareUrl: createAgentTemplateShareUrl(STORY_AGENT_TEMPLATE_ID),
  publishedAt: "2026-09-25T09:06:00.000Z",
};

export function storyAgentTemplatePreview(
  agentId: string,
  publication: AgentTemplatePublication | null = null,
): AgentTemplatePreview {
  return {
    ...structuredClone(STORY_AGENT_TEMPLATE_SNAPSHOT),
    agentId,
    avatarUrl: null,
    avatarImage: null,
    updatedAt: "2026-09-25T09:06:00.000Z",
    publication,
    skillsError: null,
  };
}

export const STORY_AGENT_TEMPLATE_DETAIL: AgentTemplateDetail = {
  ...structuredClone(STORY_AGENT_TEMPLATE_SNAPSHOT),
  id: STORY_AGENT_TEMPLATE_ID,
  avatarUrl: null,
  creatorName: "Sam Rivera",
  updatedAt: "2026-09-25T09:06:00.000Z",
};
