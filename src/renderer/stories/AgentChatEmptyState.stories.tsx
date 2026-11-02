import type { RoutineFields } from "@openbot/contracts/ipc";
import type { AgentProfile } from "@openbot/ui/data";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { StoryConversation } from "./conversation-story-support";
import { requireFixture, STORY_AGENT, STORY_AGENTS, STORY_MARKETPLACE_AGENT_DETAILS } from "./fixtures";

/*
 * A direct chat before its first message. The agent is a new copy of the Marketplace template
 * "Desk Researcher", so its description and its routine are the template's own.
 */

const template = requireFixture(STORY_MARKETPLACE_AGENT_DETAILS["listing-desk-researcher"], "Desk Researcher");
const templateRoutine = requireFixture(template.routines[0], "Desk Researcher routine");

const AGENT: AgentProfile = {
  ...STORY_AGENT,
  id: "desk-researcher",
  name: template.name,
  title: template.title,
  description: template.description,
  threadId: "thread-desk-researcher",
  workspacePath: "/mock/OpenBot/Agents/desk-researcher",
  avatarSeed: template.avatarSeed,
  avatarHue: template.avatarHue,
  avatarUrl: template.avatarUrl,
  preview: "",
  time: "",
};

const ROUTINE: RoutineFields = {
  id: "routine-morning-reading-list",
  name: templateRoutine.name,
  instruction: templateRoutine.instruction,
  active: true,
  timezone: "Europe/Warsaw",
  trigger: {
    id: "trigger-morning-reading-list",
    routineId: "routine-morning-reading-list",
    schedule: templateRoutine.schedule,
    nextRunAt: "2026-10-24T05:30:00.000Z",
    createdAt: "2026-10-23T09:00:00.000Z",
    updatedAt: "2026-10-23T09:00:00.000Z",
  },
  createdAt: "2026-10-23T09:00:00.000Z",
  updatedAt: "2026-10-23T09:00:00.000Z",
};

function EmptyChat(props: { agent: AgentProfile; routines: RoutineFields[]; width?: string }) {
  return (
    <div style={{ width: props.width ?? "100%", height: "100vh" }}>
      <StoryConversation
        agent={props.agent}
        agents={[props.agent, ...STORY_AGENTS]}
        routines={props.routines}
        messages={[]}
      />
    </div>
  );
}

const meta = {
  title: "Conversation/Agent chat empty state",
  parameters: { layout: "fullscreen", a11y: { test: "error" } },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

/** A template agent: the faint turn asks its routine and plays the host's progress lines. */
export const TemplateAgent: Story = {
  render: () => <EmptyChat agent={AGENT} routines={[ROUTINE]} />,
};

export const TemplateAgentNarrow: Story = {
  render: () => <EmptyChat agent={AGENT} routines={[ROUTINE]} width="420px" />,
};

/** An agent with no routine and no description: only the title, so nothing in it is made up. */
export const AgentWithoutRoutine: Story = {
  render: () => <EmptyChat agent={{ ...AGENT, description: "" }} routines={[]} />,
};
