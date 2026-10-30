/**
 * Workflows: the canvas over the preview mock, and the nodes one component at a time, each in its
 * empty and filled states. Press a node to select it and show its toolbar. Drag from a port to a port
 * of the other side, in either direction, to connect two nodes, or press the two ports one after the
 * other. A run in these stories uses the preview mock, not a provider.
 */

import { Toaster } from "@openbot/ui";
import { AgentNode } from "@openbot/ui/features/workflows/WorkflowAgentNode";
import { ApprovalNode } from "@openbot/ui/features/workflows/WorkflowApprovalNode";
import { AssetNode } from "@openbot/ui/features/workflows/WorkflowAssetNode";
import { ConditionNode } from "@openbot/ui/features/workflows/WorkflowConditionNode";
import { ImageNode } from "@openbot/ui/features/workflows/WorkflowImageNode";
import { LlmNode } from "@openbot/ui/features/workflows/WorkflowLlmNode";
import { NoteNode } from "@openbot/ui/features/workflows/WorkflowNoteNode";
import { OutputNode } from "@openbot/ui/features/workflows/WorkflowOutputNode";
import { PromptNode } from "@openbot/ui/features/workflows/WorkflowPromptNode";
import { TextNode } from "@openbot/ui/features/workflows/WorkflowTextNode";
import { TriggerNode } from "@openbot/ui/features/workflows/WorkflowTriggerNode";
import type { WorkflowCatalogs } from "@openbot/ui/features/workflows/workflow-model";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { NodeGallery } from "./workflow-node-gallery";
import {
  AGENT_RESULT,
  competitorWatch,
  LLM_RESULT,
  newCompetitorAlert,
  STORY_CATALOGS,
  STORY_IMAGES,
  STORY_SEED,
  storyWebhook,
  todayAt,
} from "./workflow-story-data";
import { STORY_ALL_FEATURES, WorkflowInAppStory, WorkflowStory } from "./workflow-story-host";

const TASK = "Check competitor sites, changelogs and launch posts since yesterday";
const RESULT = AGENT_RESULT;
const AGENT = STORY_SEED.agentId;

/** The story catalogs with a ChatGPT sign-in that the user did not do. */
const CHATGPT_NOT_CONNECTED: WorkflowCatalogs = {
  ...STORY_CATALOGS,
  status: {
    ...STORY_CATALOGS.status,
    providers: (STORY_CATALOGS.status.providers ?? []).map((provider) =>
      provider.id === "codex" ? { ...provider, state: "sign-in-required", version: null, email: null } : provider,
    ),
  },
};

const meta = {
  title: "Workflows",
  parameters: { layout: "fullscreen", a11y: { test: "error" } },
  // One Toaster for the page, as the app has at its root. A canvas that opens again keeps it.
  decorators: [
    (Story) => (
      <>
        {Story()}
        <Toaster />
      </>
    ),
  ],
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

/** Competitor watch has every node type, so its stories offer every node kind. */
export const Example: Story = {
  render: () => <WorkflowStory workflows={[competitorWatch()]} features={STORY_ALL_FEATURES} />,
};

/** The canvas in the desktop window, where the Routines page shows its board today. */
export const InApp: Story = {
  name: "In app",
  render: () => <WorkflowInAppStory workflows={[competitorWatch(), newCompetitorAlert()]} />,
};

export const ExampleAfterRun: Story = {
  name: "Example after run",
  render: () => <WorkflowStory workflows={[competitorWatch("done")]} features={STORY_ALL_FEATURES} />,
};

/** The last run failed at the summary. Retry on it runs the summary and the steps after it again. */
export const RunWithFailedStep: Story = {
  name: "Run with a failed step",
  render: () => <WorkflowStory workflows={[competitorWatch("failed")]} features={STORY_ALL_FEATURES} />,
};

/** A run stops at the approval until you decide. The condition of the preview always answers yes. */
export const BranchAndApproval: Story = {
  name: "Branch and approval",
  render: () => <WorkflowStory workflows={[newCompetitorAlert()]} />,
};

export const EmptyCanvas: Story = {
  name: "Empty canvas",
  render: () => (
    <WorkflowStory
      workflows={[{ id: "untitled", title: "Untitled workflow", graph: { nodes: [], edges: [], strokes: [] } }]}
    />
  ),
};

export const Text: Story = {
  render: () => (
    <NodeGallery selected="heading">
      <TextNode id="empty" />
      <TextNode id="heading" text="RESEARCH" size="lg" bold />
      <TextNode id="body" text="Runs every weekday before the market stand-up." />
    </NodeGallery>
  ),
};

export const Prompt: Story = {
  render: () => (
    <NodeGallery selected="filled">
      <PromptNode id="empty" />
      <PromptNode id="filled" text={TASK} />
    </NodeGallery>
  ),
};

export const Agent: Story = {
  render: () => (
    <NodeGallery selected="result" results={{ result: [{ id: "agent-result", at: todayAt(9, 14), value: RESULT }] }}>
      <AgentNode id="empty" agentId={AGENT} />
      <AgentNode id="result" agentId={AGENT} task={TASK} />
    </NodeGallery>
  ),
};

export const Llm: Story = {
  name: "LLM",
  render: () => (
    <NodeGallery
      selected="result"
      results={{
        result: [
          {
            id: "llm-result",
            at: todayAt(9, 14),
            value: LLM_RESULT,
          },
        ],
      }}
    >
      <LlmNode id="empty" />
      <LlmNode
        id="result"
        prompt="Summarize the research in 3 lines for the market team"
        system="You write for busy readers. Use short sentences and no adjectives."
      />
    </NodeGallery>
  ),
};

/**
 * ChatGPT is not connected. A new LLM step takes a Claude model, and its list has no ChatGPT tab. The
 * agent step keeps ChatGPT, because its agent runs on it.
 */
export const LlmChatGptNotConnected: Story = {
  name: "LLM, ChatGPT not connected",
  render: () => (
    <NodeGallery catalogs={CHATGPT_NOT_CONNECTED}>
      <LlmNode id="empty" />
      <AgentNode id="chief" agentId="chief" />
    </NodeGallery>
  ),
};

export const ImageStory: Story = {
  name: "Image",
  render: () => (
    <NodeGallery selected="filled">
      <ImageNode id="empty" />
      <ImageNode
        id="filled"
        image={STORY_IMAGES[0]?.name}
        prompt="Hero image for the Atlas comparison page, one product window"
      />
      <ImageNode id="wide" image={STORY_IMAGES[3]?.name} aspect="16:9" />
    </NodeGallery>
  ),
};

export const Asset: Story = {
  render: () => (
    <NodeGallery selected="image">
      <AssetNode id="empty" />
      <AssetNode id="image" file="moodboard-01.jpg" />
      <AssetNode id="file" file="pricing-sources.pdf" />
    </NodeGallery>
  ),
};

export const Trigger: Story = {
  render: () => (
    <NodeGallery selected="schedule">
      <TriggerNode id="schedule" nextRun={STORY_SEED.nextRun} />
      <TriggerNode id="manual" trigger="manual" />
      <TriggerNode id="webhook" trigger="webhook" webhookUrl={storyWebhook("webhook")} />
      <TriggerNode id="message" trigger="message" />
    </NodeGallery>
  ),
};

export const Condition: Story = {
  render: () => (
    <NodeGallery
      selected="branch"
      edges={[
        { id: "source>branch:text", from: "source", to: "branch", type: "text" },
        { id: "branch.yes>post:text", from: "branch", to: "post", type: "text", branch: "yes" },
        { id: "branch.no>save:text", from: "branch", to: "save", type: "text", branch: "no" },
      ]}
      results={{ branch: [{ id: "branch-result", at: todayAt(9, 13), value: "yes" }] }}
    >
      <PromptNode id="source" text={RESULT} />
      <ConditionNode id="branch" rule={STORY_SEED.rule} />
      <OutputNode id="post" path={STORY_SEED.path} title={STORY_SEED.title} />
      <OutputNode id="save" target="file" path={STORY_SEED.path} title={STORY_SEED.title} />
    </NodeGallery>
  ),
};

export const Output: Story = {
  render: () => (
    <NodeGallery
      selected="channel"
      edges={[
        { id: "source>channel:text", from: "source", to: "channel", type: "text" },
        { id: "source>file:text", from: "source", to: "file", type: "text" },
        { id: "source>notify:text", from: "source", to: "notify", type: "text" },
      ]}
      results={{ channel: [{ id: "output-result", at: todayAt(9, 14), value: "Posted to #market at 09:14." }] }}
    >
      <PromptNode id="source" text={RESULT} />
      <OutputNode id="channel" path={STORY_SEED.path} title={STORY_SEED.title} />
      <OutputNode id="file" target="file" path={STORY_SEED.path} title={STORY_SEED.title} />
      <OutputNode id="notify" target="notify" path={STORY_SEED.path} title={STORY_SEED.title} />
    </NodeGallery>
  ),
};

export const Approval: Story = {
  render: () => (
    <NodeGallery
      selected="waiting"
      status={{ waiting: "approval" }}
      edges={[
        { id: "source>idle:text", from: "source", to: "idle", type: "text" },
        { id: "source>waiting:text", from: "source", to: "waiting", type: "text" },
      ]}
    >
      <PromptNode id="source" text={RESULT} />
      <ApprovalNode id="idle" question={STORY_SEED.question} />
      <ApprovalNode id="waiting" question={STORY_SEED.question} />
    </NodeGallery>
  ),
};

export const Note: Story = {
  render: () => (
    <NodeGallery selected="blue">
      <NoteNode id="yellow" text="Runs every weekday before the market stand-up." />
      <NoteNode id="blue" tone="blue" text="Ask Research before you change the sources." />
      <NoteNode id="green" tone="green" />
      <NoteNode id="pink" tone="pink" text="Atlas pricing changes often. Check it each week." />
    </NodeGallery>
  ),
};

export const FailedStep: Story = {
  name: "Failed step",
  render: () => (
    <NodeGallery
      selected="agent"
      status={{ agent: "failed", llm: "failed" }}
      errors={{
        agent: "Claude stopped: the usage limit resets at 14:00.",
        llm: "The model did not answer in 60 seconds.",
      }}
    >
      <AgentNode id="agent" agentId={AGENT} task={TASK} />
      <LlmNode id="llm" prompt="Summarize the research in 3 lines for the market team" />
    </NodeGallery>
  ),
};

export const MissingInput: Story = {
  name: "Missing input",
  render: () => (
    <NodeGallery selected="condition" status={{ output: "waiting", approval: "waiting" }}>
      <ConditionNode id="condition" rule={STORY_SEED.rule} />
      <ApprovalNode id="approval" question={STORY_SEED.question} />
      <OutputNode id="output" path={STORY_SEED.path} title={STORY_SEED.title} />
    </NodeGallery>
  ),
};

export const AgentRemoved: Story = {
  name: "Agent removed",
  render: () => (
    <NodeGallery selected="removed">
      <AgentNode id="removed" agentId="deleted-agent" task={TASK} />
    </NodeGallery>
  ),
};

const LONG_TASK = Array.from({ length: 12 }, () => TASK).join(". ");
const LONG_WEBHOOK = `webhook-${"a".repeat(48)}`;

export const LongText: Story = {
  name: "Long text",
  render: () => (
    <NodeGallery
      selected="agent"
      status={{ failed: "failed" }}
      errors={{ failed: `The provider sent an error that has no end. ${LONG_TASK}` }}
      results={{ agent: [{ id: "long-result", at: todayAt(9, 14), value: `${RESULT} ${LONG_TASK}` }] }}
    >
      <AgentNode id="agent" agentId={AGENT} task={LONG_TASK} />
      <ConditionNode id="condition" rule={LONG_TASK} />
      <OutputNode
        id="output"
        target="file"
        path={`Reports/${"competitor-watch-".repeat(8)}final.md`}
        title={STORY_SEED.title}
      />
      <TriggerNode id={LONG_WEBHOOK} trigger="webhook" webhookUrl={storyWebhook(LONG_WEBHOOK)} />
      <AgentNode id="failed" agentId={AGENT} task={TASK} />
    </NodeGallery>
  ),
};

export const Locked: Story = {
  render: () => (
    <NodeGallery selected="agent" locked={["prompt", "agent", "trigger", "note"]}>
      <TriggerNode id="trigger" nextRun={STORY_SEED.nextRun} />
      <PromptNode id="prompt" text={TASK} />
      <AgentNode id="agent" agentId={AGENT} task={TASK} />
      <NoteNode id="note" text="Locked so that nobody moves the sources by mistake." />
    </NodeGallery>
  ),
};
