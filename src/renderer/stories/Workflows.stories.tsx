import type { AgentStepActivity } from "@openbot/contracts/ipc";
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
import { createSignal, onCleanup } from "solid-js";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { NodeGallery } from "./workflow-node-gallery";
import { createStoryPresence } from "./workflow-presence-story";
import {
  AGENT_RESULT,
  competitorWatch,
  githubTriage,
  higgsfieldVideo,
  LLM_RESULT,
  newCompetitorAlert,
  STORY_CATALOGS,
  STORY_GITHUB,
  STORY_IMAGES,
  STORY_SEED,
  type StoryWorkflow,
  storyWebhook,
  todayAt,
} from "./workflow-story-data";
import { STORY_ALL_FEATURES, WorkflowInAppStory, WorkflowStory } from "./workflow-story-host";

const TASK = "Check competitor sites, changelogs and launch posts since yesterday";
const RESULT = AGENT_RESULT;
const AGENT = STORY_SEED.agentId;

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

export const Example: Story = {
  render: () => <WorkflowStory workflows={[competitorWatch()]} features={STORY_ALL_FEATURES} />,
};

export const ExampleWithCollaborators: Story = {
  name: "Example with collaborators",
  render: () => {
    const presence = createStoryPresence();
    return (
      <WorkflowStory
        workflows={[competitorWatch()]}
        features={{ ...STORY_ALL_FEATURES, presence: true }}
        presence={presence}
      />
    );
  },
};

export const InApp: Story = {
  name: "In app",
  render: () => <WorkflowInAppStory workflows={[competitorWatch(), newCompetitorAlert()]} />,
};

export const HiggsfieldVideo: Story = {
  name: "Higgsfield video",
  render: () => <WorkflowStory workflows={[higgsfieldVideo()]} features={STORY_ALL_FEATURES} />,
};

export const ExampleAfterRun: Story = {
  name: "Example after run",
  render: () => <WorkflowStory workflows={[competitorWatch("done")]} features={STORY_ALL_FEATURES} />,
};

export const RunWithFailedStep: Story = {
  name: "Run with a failed step",
  render: () => <WorkflowStory workflows={[competitorWatch("failed")]} features={STORY_ALL_FEATURES} />,
};

export const BranchAndApproval: Story = {
  name: "Branch and approval",
  render: () => <WorkflowStory workflows={[newCompetitorAlert()]} />,
};

export const GitHubRuns: Story = {
  name: "GitHub runs",
  render: () => <WorkflowStory workflows={[githubTriage()]} features={STORY_ALL_FEATURES} />,
};

export const EmptyCanvas: Story = {
  name: "Empty canvas",
  render: () => (
    <WorkflowStory
      workflows={[{ id: "untitled", title: "Untitled workflow", graph: { nodes: [], edges: [], strokes: [] } }]}
    />
  ),
};

function moodboardGroup(folded: boolean): StoryWorkflow {
  const open = { group: "story-moodboard", groupName: "Moodboard" };
  const group = folded ? { ...open, groupFolded: true } : open;
  const pictures = ["moodboard-01.jpg", "moodboard-02.jpg", "moodboard-03.jpg"];
  return {
    id: "moodboard-group",
    title: "Moodboard cover",
    graph: {
      nodes: [
        ...pictures.map((file, index) => ({
          kind: "asset" as const,
          id: `picture-${index + 1}`,
          at: { x: index * 300, y: 0 },
          fields: { file, ...group },
        })),
        {
          kind: "image",
          id: "cover",
          at: { x: 1100, y: 0 },
          fields: { prompt: "Cover image for the note, in the moodboard style", aspect: "16:9" },
        },
      ],
      edges: pictures.map((_, index) => ({
        id: `picture-${index + 1}>cover:image`,
        from: `picture-${index + 1}`,
        to: "cover",
        type: "image" as const,
      })),
      strokes: [],
    },
  };
}

export const Groups: Story = {
  render: () => <WorkflowStory workflows={[moodboardGroup(false)]} features={STORY_ALL_FEATURES} />,
};

export const GroupsCollapsed: Story = {
  name: "Groups, collapsed",
  render: () => <WorkflowStory workflows={[moodboardGroup(true)]} features={STORY_ALL_FEATURES} />,
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

const REFERENCES = [
  { id: "file-1", name: "launch-hero.png" },
  { id: "file-2", name: "launch-hero-dark.png" },
];

const agentWithReferences: StoryWorkflow = {
  id: "agent-references",
  title: "Launch illustration",
  graph: {
    nodes: [
      ...REFERENCES.map((file, index) => ({
        kind: "asset" as const,
        id: `reference-${index + 1}`,
        at: { x: 0, y: index * 340 },
        fields: { fileId: file.id, file: file.name },
      })),
      {
        kind: "agent",
        id: "illustrate",
        at: { x: 420, y: 120 },
        fields: {
          agentId: AGENT,
          task: "Make one 4:5 illustration that keeps the character and the style of the two pictures. Do not invent a new character.",
        },
      },
    ],
    edges: REFERENCES.map((_, index) => ({
      id: `reference-${index + 1}>illustrate:image`,
      from: `reference-${index + 1}`,
      to: "illustrate",
      type: "image" as const,
    })),
    strokes: [],
  },
};

export const AgentWithPictures: Story = {
  name: "Agent with connected pictures",
  render: () => <WorkflowStory workflows={[agentWithReferences]} features={STORY_ALL_FEATURES} />,
};

export const Agent: Story = {
  render: () => (
    <NodeGallery selected="result" results={{ result: [{ id: "agent-result", at: todayAt(9, 14), value: RESULT }] }}>
      <AgentNode id="empty" agentId={AGENT} />
      <AgentNode id="result" agentId={AGENT} task={TASK} />
    </NodeGallery>
  ),
};

const LIVE_STEPS: readonly { detail: string; activity: AgentStepActivity }[] = [
  { detail: "Searched the web: “Northwind Atlas launch”", activity: "searching" },
  { detail: "Reading northwind.com/changelog", activity: "reading" },
  { detail: "Reading northwind.com/pricing", activity: "reading" },
  { detail: "Opening news.ycombinator.com", activity: "browsing" },
  { detail: "Searched the web: “Northwind Slack connector”", activity: "searching" },
  { detail: "Reading northwind.com/blog/atlas", activity: "reading" },
  { detail: "Reviewing the results", activity: "reviewing" },
];

function RunningAgentGallery() {
  const [step, setStep] = createSignal(0);
  const timer = setInterval(() => setStep((value) => (value + 1) % LIVE_STEPS.length), 1800);
  onCleanup(() => clearInterval(timer));
  return (
    <NodeGallery
      selected="research"
      status={{ research: "running" }}
      fields={{ research: { stepName: "Research competitors" }, summary: { stepName: "Summary for #market" } }}
      edges={[{ id: "research>summary", from: "research", to: "summary", type: "text" }]}
      progress={(id) => {
        const current = LIVE_STEPS[step()];
        if (id !== "research" || !current) return undefined;
        return {
          agentId: AGENT,
          detail: current.detail,
          previous: LIVE_STEPS[step() - 1]?.detail,
          activity: current.activity,
          done: step(),
        };
      }}
    >
      <AgentNode id="research" agentId={AGENT} task={TASK} />
      <LlmNode id="summary" prompt="Summarize the research in 3 lines for the market team" />
    </NodeGallery>
  );
}

export const AgentRunning: Story = {
  name: "Agent, running with step names",
  render: () => <RunningAgentGallery />,
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

const RANGE_VIDEO_MODEL = {
  id: "higgsfield-kling3_0_story",
  provider: "higgsfield",
  name: "Kling 3.0",
  maker: "Kuaishou",
  subscription: "Higgsfield",
  credits: true,
  kinds: ["video"],
  voices: false,
  aspects: ["16:9", "9:16", "1:1"],
  durations: Array.from({ length: 13 }, (_, index) => index + 3),
  resolutions: ["720p", "1080p"],
} as const satisfies WorkflowCatalogs["imageModels"][number];

export const VideoCustomLength: Story = {
  name: "Video, custom length",
  render: () => (
    <NodeGallery
      selected="custom"
      catalogs={{ ...STORY_CATALOGS, imageModels: [RANGE_VIDEO_MODEL, ...STORY_CATALOGS.imageModels] }}
      fields={{
        listed: { media: "video", model: RANGE_VIDEO_MODEL.id, aspect: "16:9", duration: 10 },
        custom: { media: "video", model: RANGE_VIDEO_MODEL.id, aspect: "16:9", duration: 7 },
      }}
    >
      <ImageNode id="listed" prompt="A drone shot over a coastal town at sunrise" />
      <ImageNode id="custom" prompt="A drone shot over a coastal town at sunrise" />
    </NodeGallery>
  ),
};

export const ImageManyResults: Story = {
  name: "Image, many results",
  render: () => (
    <NodeGallery
      selected="filled"
      results={{
        filled: Array.from({ length: 12 }, (_, index) => ({
          id: `image-result-${index + 1}`,
          at: todayAt(9, index * 4),
          value: STORY_IMAGES[index % STORY_IMAGES.length]?.name ?? "",
        })),
      }}
    >
      <ImageNode id="filled" prompt="Hero image for the Atlas comparison page, one product window" />
    </NodeGallery>
  ),
};

const TWO_HIGGSFIELD_ACCOUNTS: WorkflowCatalogs = {
  ...STORY_CATALOGS,
  imageModels: STORY_CATALOGS.imageModels?.map((model) =>
    model.provider === "higgsfield"
      ? {
          ...model,
          accounts: [
            { id: "default", label: "Higgsfield", email: null, state: "connected", message: null },
            { id: "a1b2c3d4", label: "Higgsfield 2", email: null, state: "connected", message: null },
          ],
        }
      : model,
  ),
};

export const ImageTwoHiggsfieldAccounts: Story = {
  name: "Image, two Higgsfield accounts",
  render: () => {
    const model = TWO_HIGGSFIELD_ACCOUNTS.imageModels?.find((entry) => entry.provider === "higgsfield")?.id ?? "";
    return (
      <NodeGallery
        selected="second"
        catalogs={TWO_HIGGSFIELD_ACCOUNTS}
        fields={{ first: { model, account: "" }, second: { model, account: "a1b2c3d4" } }}
      >
        <ImageNode id="first" prompt="Hero image for the Atlas comparison page" />
        <ImageNode id="second" prompt="Hero image for the Atlas comparison page" />
      </NodeGallery>
    );
  },
};

function cutOutPicture(): string {
  const canvas = document.createElement("canvas");
  canvas.width = 480;
  canvas.height = 600;
  const context = canvas.getContext("2d");
  if (!context) return "";
  context.fillStyle = "rgba(0, 0, 0, 0.35)";
  context.beginPath();
  context.ellipse(240, 560, 150, 26, 0, 0, Math.PI * 2);
  context.fill();
  const body = context.createLinearGradient(0, 80, 0, 540);
  body.addColorStop(0, "#f0b35a");
  body.addColorStop(1, "#d95926");
  context.fillStyle = body;
  context.beginPath();
  context.roundRect(90, 80, 300, 460, 150);
  context.fill();
  context.fillStyle = "#ffffff";
  for (const x of [190, 290]) {
    context.beginPath();
    context.ellipse(x, 250, 34, 46, 0, 0, Math.PI * 2);
    context.fill();
  }
  context.fillStyle = "#1b1b1f";
  for (const x of [198, 298]) {
    context.beginPath();
    context.arc(x, 262, 18, 0, Math.PI * 2);
    context.fill();
  }
  return canvas.toDataURL("image/png");
}

export const Asset: Story = {
  render: () => {
    const base = STORY_IMAGES[0];
    const cutOut = base && {
      ...base,
      id: "cut-out",
      name: "cut-out.png",
      mimeType: "image/png",
      previewUrl: cutOutPicture(),
    };
    const catalogs = cutOut ? { ...STORY_CATALOGS, files: [...STORY_CATALOGS.files, cutOut] } : STORY_CATALOGS;
    return (
      <NodeGallery selected="image" catalogs={catalogs}>
        <AssetNode id="empty" />
        <AssetNode id="image" file="moodboard-01.jpg" />
        <AssetNode id="file" file="pricing-sources.pdf" />
        <AssetNode id="clear" file="cut-out.png" />
      </NodeGallery>
    );
  },
};

export const Trigger: Story = {
  render: () => (
    <NodeGallery
      selected="schedule"
      github={STORY_GITHUB}
      fields={{
        github: { trigger: "github", repository: "openbot-preview/app", event: "issue.opened", filters: "notBot" },
        "github-empty": { trigger: "github", event: "issue.opened", filters: "notBot" },
        "github-many": {
          trigger: "github",
          repository: "openbot-preview/app",
          repositories: [
            "openbot-preview/app",
            "openbot-preview/desktop-release-pipeline-and-installers",
            "openbot-preview-labs/team-api-gateway",
          ].join("\n"),
          event: "issue.opened",
          filters: "notBot",
        },
      }}
    >
      <TriggerNode id="schedule" nextRun={STORY_SEED.nextRun} />
      <TriggerNode id="manual" trigger="manual" />
      <TriggerNode id="webhook" trigger="webhook" webhookUrl={storyWebhook("webhook")} />
      <TriggerNode id="message" trigger="message" />
      <TriggerNode id="github" trigger="github" />
      <TriggerNode id="github-empty" trigger="github" />
      <TriggerNode id="github-many" trigger="github" />
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
      github={STORY_GITHUB}
      edges={[
        { id: "source>channel:text", from: "source", to: "channel", type: "text" },
        { id: "source>file:text", from: "source", to: "file", type: "text" },
        { id: "source>notify:text", from: "source", to: "notify", type: "text" },
        { id: "issue>comment:text", from: "issue", to: "comment", type: "text" },
        { id: "issue>label:text", from: "issue", to: "label", type: "text" },
        { id: "docs>review:text", from: "docs", to: "review", type: "text" },
      ]}
      fields={{
        issue: { trigger: "github", repository: "openbot-preview/app", event: "issue.opened", filters: "notBot" },
        docs: { trigger: "github", repository: "openbot-preview/docs", event: "pr.opened", filters: "notBot" },
        comment: { target: "github", action: "comment" },
        label: { target: "github", action: "label.add", labelsFrom: "agent", labels: "bug\nenhancement" },
        review: { target: "github", action: "review.approve" },
      }}
      results={{
        channel: [{ id: "output-result", at: todayAt(9, 14), value: "Posted to #market at 09:14." }],
        comment: [{ id: "github-result", at: todayAt(9, 15), value: "Commented on #42." }],
      }}
    >
      <PromptNode id="source" text={RESULT} />
      <OutputNode id="channel" path={STORY_SEED.path} title={STORY_SEED.title} />
      <OutputNode id="file" target="file" path={STORY_SEED.path} title={STORY_SEED.title} />
      <OutputNode id="notify" target="notify" path={STORY_SEED.path} title={STORY_SEED.title} />
      <TriggerNode id="issue" trigger="github" />
      <OutputNode id="comment" target="github" />
      <OutputNode id="label" target="github" />
      <TriggerNode id="docs" trigger="github" />
      <OutputNode id="review" target="github" />
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
