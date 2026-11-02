/**
 * The story data of the workflows: the catalogs that the host gives the nodes, the results that a
 * story run records, the field values that the stories open with, and the example workflows with
 * their runs and versions. The nodes have no data of their own.
 */

import type {
  RoutineSchedule,
  WorkflowGitHubDelivery,
  WorkflowGitHubHistory,
  WorkflowGitHubItem,
  WorkflowGraph,
  WorkflowRunDetail,
  WorkflowStep,
  WorkflowVersion,
} from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import { EMPTY_GITHUB_HISTORY, type WorkflowGitHubCanvas } from "@openbot/ui/features/workflows/workflow-github";
import type { WorkflowCatalogs } from "@openbot/ui/features/workflows/workflow-model";
import type { WorkflowRunView } from "@openbot/ui/features/workflows/workflow-run-view";
import { FILES_ROWS } from "./files-fixtures";
import { STORY_AGENT_STATUS, STORY_AGENTS, STORY_MODELS, STORY_TEAM_MEMBERS } from "./fixtures";

/** The images of the story files. An image step draws them in turn. */
export const STORY_IMAGES = FILES_ROWS.filter((file) => file.previewKind === "image" && file.previewUrl);

const STORY_CONNECTION = "story-team";

export const STORY_CATALOGS: WorkflowCatalogs = {
  agents: STORY_AGENTS,
  models: STORY_MODELS,
  status: STORY_AGENT_STATUS,
  places: ["market", "general", "research"].map((placeId) => ({
    connectionId: STORY_CONNECTION,
    placeId,
    label: `#${placeId}`,
  })),
  imageModels: [
    { id: "gpt-image", name: "GPT Image", provider: "codex", maker: "OpenAI" },
    { id: "nano-banana", name: "Nano Banana", provider: "antigravity", maker: "Google" },
    { id: "grok-imagine", name: "Grok Imagine", provider: "grok", maker: "xAI" },
  ],
  files: FILES_ROWS,
  self: STORY_TEAM_MEMBERS.find((member) => member.id === "member-self")?.name ?? undefined,
};

/** A time today, as an ISO string, for the results that a story opens with. */
export function todayAt(hours: number, minutes: number): string {
  const time = new Date();
  time.setHours(hours, minutes, 0, 0);
  return time.toISOString();
}

export const AGENT_RESULT =
  "Northwind launched “Atlas”, an agent workspace for small teams, on 22 Oct. Pricing starts at €12 a seat. Their changelog also adds a Slack connector.";

export const LLM_RESULT =
  "Atlas: agent workspace for small teams. Launched 22 Oct. From €12 a seat. Adds a Slack connector. Watch: price is under ours for teams of 3–10.";

/**
 * What a story run of each kind of step records. An image step records the next story image, and an
 * approval step records the answer of the user.
 */
export const STEP_ANSWER: Partial<Record<string, string>> = {
  agent: AGENT_RESULT,
  llm: LLM_RESULT,
  image: STORY_IMAGES[1]?.name ?? "",
  trigger: "Started at 09:00.",
  condition: "yes",
  output: "Posted to #market at 09:14.",
};

/** The field values that the stories open with, as the user typed them. */
export const STORY_SEED = {
  agentId: "research",
  schedule: { kind: "weekdays", time: "09:00" } satisfies RoutineSchedule,
  /** The next run of the schedule: Monday 26 October, 09:00. */
  nextRun: new Date(2026, 9, 26, 9, 0).toISOString(),
  rule: "The report names a new competitor",
  question: "Post the report to #market?",
  path: "Reports/competitor-watch.md",
  title: "Competitor watch",
};

/** A placeholder webhook address: the stories have no webhook service. */
export const storyWebhook = (id: string) => `https://hooks.openbot.run/wf/${id}`;

/* ------------------------------------------------------------ Workflows */

/** A saved version of a story workflow, with the graph that its preview shows. */
interface StoryVersion {
  version: WorkflowVersion;
  graph: WorkflowGraph;
}

/** A workflow that a canvas story opens with. */
export interface StoryWorkflow {
  id: string;
  title: string;
  graph: WorkflowGraph;
  /** Runs from before the story. The story host shows them; the preview mock does not know them. */
  runs?: WorkflowRunView;
  /** Versions from before the story, newest first. */
  versions?: readonly StoryVersion[];
  /** GitHub events from before the story, and the items of the fixture runs that they started. */
  github?: WorkflowGitHubHistory;
}

const COLUMN = 460;

/** A story time in October 2026, as an ISO string. */
const octoberAt = (day: number, hours: number, minutes: number) => new Date(2026, 9, day, hours, minutes).toISOString();

/**
 * Competitor watch, with every node type: the inputs on the left, an agent that does the research,
 * two direct model calls that write, an image step, and an agent that posts the result.
 */
const COMPETITOR_WATCH: WorkflowGraph = {
  nodes: [
    { kind: "text", id: "h-inputs", at: { x: 0, y: -96 }, fields: { text: "INPUTS", size: "lg", bold: true } },
    { kind: "text", id: "h-research", at: { x: COLUMN, y: -96 }, fields: { text: "RESEARCH", size: "lg", bold: true } },
    { kind: "text", id: "h-write", at: { x: COLUMN * 2, y: -96 }, fields: { text: "WRITE", size: "lg", bold: true } },
    { kind: "text", id: "h-image", at: { x: COLUMN * 3, y: -96 }, fields: { text: "IMAGE", size: "lg", bold: true } },
    {
      kind: "text",
      id: "h-publish",
      at: { x: COLUMN * 4, y: -96 },
      fields: { text: "PUBLISH", size: "lg", bold: true },
    },
    {
      kind: "prompt",
      id: "brief",
      at: { x: 0, y: 0 },
      fields: {
        text: "Weekly note on competitor launches for the market team. Focus on pricing and new features.",
      },
    },
    { kind: "asset", id: "sources", at: { x: 0, y: 232 }, fields: { file: "pricing-sources.pdf" } },
    {
      kind: "trigger",
      id: "start",
      at: { x: 0, y: 440 },
      fields: { trigger: "schedule" },
      schedule: STORY_SEED.schedule,
    },
    { kind: "asset", id: "moodboard", at: { x: 0, y: 880 }, fields: { file: "moodboard-01.jpg" } },
    {
      kind: "agent",
      id: "research",
      at: { x: COLUMN, y: 0 },
      fields: {
        agentId: "research",
        task: "Check competitor sites, changelogs and launch posts since yesterday. Compare prices with the sources file.",
      },
    },
    {
      kind: "llm",
      id: "summary",
      at: { x: COLUMN * 2, y: 0 },
      fields: {
        prompt: "Summarize the research in 3 lines for the market team",
        system: "You write for busy readers. Use short sentences and no adjectives.",
      },
    },
    {
      kind: "llm",
      id: "headline",
      at: { x: COLUMN * 2, y: 480 },
      fields: { prompt: "Write one headline for the note, under 8 words" },
    },
    {
      kind: "image",
      id: "cover",
      at: { x: COLUMN * 3, y: 840 },
      fields: { prompt: "Cover image for the note, in the moodboard style", aspect: "16:9" },
    },
    {
      kind: "agent",
      id: "publish",
      at: { x: COLUMN * 4, y: 0 },
      fields: { agentId: "chief", task: "Post the note with its headline and cover image to #market" },
    },
  ],
  edges: [
    { id: "start>research:text", from: "start", to: "research", type: "text" },
    { id: "brief>research:text", from: "brief", to: "research", type: "text" },
    { id: "sources>research:file", from: "sources", to: "research", type: "file" },
    { id: "research>summary:text", from: "research", to: "summary", type: "text" },
    { id: "research>headline:text", from: "research", to: "headline", type: "text" },
    { id: "headline>cover:text", from: "headline", to: "cover", type: "text" },
    { id: "moodboard>cover:image", from: "moodboard", to: "cover", type: "image" },
    { id: "summary>publish:text", from: "summary", to: "publish", type: "text" },
    { id: "headline>publish:text", from: "headline", to: "publish", type: "text" },
    { id: "cover>publish:image", from: "cover", to: "publish", type: "image" },
  ],
  strokes: [],
};

/** New competitor alert: a branch on what the research found, and an approval before the post. */
const NEW_COMPETITOR_ALERT: WorkflowGraph = {
  nodes: [
    {
      kind: "trigger",
      id: "start",
      at: { x: 0, y: 80 },
      fields: { trigger: "schedule" },
      schedule: STORY_SEED.schedule,
    },
    {
      kind: "agent",
      id: "scan",
      at: { x: 320, y: 0 },
      fields: { agentId: "research", task: "Check competitor sites, changelogs and launch posts since yesterday" },
    },
    { kind: "condition", id: "found", at: { x: 720, y: 40 }, fields: { rule: "The report names a new competitor" } },
    { kind: "approval", id: "ask", at: { x: 1120, y: -120 }, fields: { question: "Post the report to #market?" } },
    {
      kind: "output",
      id: "post",
      at: { x: 1520, y: -120 },
      fields: {
        target: "channel",
        connectionId: STORY_CONNECTION,
        placeId: "market",
        path: STORY_SEED.path,
        title: STORY_SEED.title,
      },
    },
    {
      kind: "output",
      id: "quiet",
      at: { x: 1120, y: 280 },
      fields: { target: "notify", path: STORY_SEED.path, title: STORY_SEED.title },
    },
    { kind: "note", id: "why", at: { x: 0, y: 260 }, fields: { text: "Runs before the Monday stand-up." } },
  ],
  edges: [
    { id: "start>scan:text", from: "start", to: "scan", type: "text" },
    { id: "scan>found:text", from: "scan", to: "found", type: "text" },
    { id: "found.yes>ask:text", from: "found", to: "ask", type: "text", branch: "yes" },
    { id: "found.no>quiet:text", from: "found", to: "quiet", type: "text", branch: "no" },
    { id: "ask>post:text", from: "ask", to: "post", type: "text" },
  ],
  strokes: [],
};

/**
 * When each step of Competitor watch starts and ends, as parts of the run's duration. The inputs end
 * at once; the steps after them wait for their inputs.
 */
const COMPETITOR_WATCH_TIMING: Record<string, readonly [start: number, end: number]> = {
  start: [0, 0],
  brief: [0, 0],
  sources: [0, 0],
  moodboard: [0, 0],
  research: [0, 0.55],
  summary: [0.55, 0.8],
  headline: [0.55, 0.7],
  cover: [0.7, 0.92],
  publish: [0.92, 1],
};

/** What each step of Competitor watch answers in a new run. Prompt and asset steps answer nothing. */
const COMPETITOR_WATCH_ANSWERS = {
  start: STEP_ANSWER.trigger ?? "",
  research: AGENT_RESULT,
  summary: LLM_RESULT,
  headline: "Atlas undercuts us for small teams",
  cover: "campaign-banner-wide.png",
  publish: "Posted to #market at 09:14. 3 people reacted.",
};

/** One step of a story run. A step that ran alone has no run. */
function storyStep(
  graph: WorkflowGraph,
  workflowId: string,
  runId: string | null,
  stepId: string,
  nodeId: string,
  times: { startedAt: string; endedAt: string },
  result: Partial<Pick<WorkflowStep, "status" | "output" | "error">>,
): WorkflowStep {
  const agentId = graph.nodes.find((node) => node.id === nodeId)?.fields.agentId;
  return {
    id: stepId,
    workflowId,
    runId,
    nodeId,
    attempt: 1,
    agentId: typeof agentId === "string" ? agentId : null,
    status: "done",
    output: null,
    branch: null,
    error: null,
    ...times,
    ...result,
  };
}

/** A story run of Competitor watch that ended. Each node in `results` ran; its value is its output or a failure. */
function competitorWatchRun(input: {
  workflowId: string;
  number: number;
  startedAt: string;
  seconds: number;
  results: Record<string, string | null | { error: string }>;
}): WorkflowRunDetail {
  const id = `story-run-${input.number}`;
  const start = Date.parse(input.startedAt);
  const at = (part: number) => new Date(start + part * input.seconds * 1000).toISOString();
  const steps = Object.entries(input.results).map(([nodeId, result]) => {
    const [from, to] = COMPETITOR_WATCH_TIMING[nodeId] ?? [0, 0];
    const outcome =
      typeof result === "object" && result !== null
        ? { status: "failed" as const, error: result.error }
        : { output: result };
    return storyStep(
      COMPETITOR_WATCH,
      input.workflowId,
      id,
      `${id}:${nodeId}`,
      nodeId,
      { startedAt: at(from), endedAt: at(to) },
      outcome,
    );
  });
  return {
    run: {
      id,
      workflowId: input.workflowId,
      number: input.number,
      triggerNodeId: null,
      source: "schedule",
      status: steps.some((step) => step.status === "failed") ? "failed" : "done",
      error: null,
      startedAt: input.startedAt,
      endedAt: at(1),
    },
    steps,
  };
}

/** The steps of Competitor watch that the user ran alone after run 2: the cover three times, the headline once. */
const COMPETITOR_WATCH_TRIES: Record<string, readonly { at: string; value: string }[]> = {
  cover: [
    { at: octoberAt(21, 9, 40), value: "launch-timeline.png" },
    { at: octoberAt(21, 9, 43), value: "campaign-banner-wide.png" },
    { at: octoberAt(21, 9, 47), value: "hero-illustration-v1.png" },
  ],
  headline: [{ at: octoberAt(21, 9, 35), value: "Atlas undercuts us for small teams" }],
};

/**
 * The run history of Competitor watch: two scheduled runs and the steps that ran alone after them.
 * With `last`, a third run ended just now, with each step done or with the summary failed.
 */
function competitorWatchRuns(workflowId: string, last?: "done" | "failed"): WorkflowRunView {
  const runs = [
    competitorWatchRun({
      workflowId,
      number: 1,
      startedAt: octoberAt(14, 9, 0),
      seconds: 38,
      results: {
        start: "Started at 09:00.",
        brief: null,
        sources: null,
        moodboard: null,
        research: "Northwind changed its Team plan from €15 to €13 a seat. No new launches or changelog entries.",
        summary: "Northwind Team is now €13 a seat, down from €15. No launches. Watch: their price is close to ours.",
        headline: "Northwind cuts its Team price",
        cover: "launch-hero.png",
        publish: "Posted to #market at 09:01.",
      },
    }),
    competitorWatchRun({
      workflowId,
      number: 2,
      startedAt: octoberAt(21, 9, 0),
      seconds: 41,
      results: {
        start: "Started at 09:00.",
        brief: null,
        sources: null,
        moodboard: null,
        research: "Northwind teased “Atlas” on its blog: an agent workspace for small teams. No date or price yet.",
        summary: "Northwind teased Atlas, an agent workspace for small teams. No date or price. No price changes.",
        headline: "Northwind teases Atlas",
        cover: "launch-hero-dark.png",
        publish: "Posted to #market at 09:01. 2 people reacted.",
      },
    }),
  ];
  if (last) {
    const failed = last === "failed";
    runs.push(
      competitorWatchRun({
        workflowId,
        number: 3,
        startedAt: new Date(Date.now() - 12_000).toISOString(),
        seconds: 12,
        results: {
          start: COMPETITOR_WATCH_ANSWERS.start,
          brief: null,
          sources: null,
          moodboard: null,
          research: COMPETITOR_WATCH_ANSWERS.research,
          summary: failed ? { error: sourceText("error.workflow.modelFailed") } : COMPETITOR_WATCH_ANSWERS.summary,
          headline: COMPETITOR_WATCH_ANSWERS.headline,
          cover: COMPETITOR_WATCH_ANSWERS.cover,
          // Publish does not start without the summary.
          ...(failed ? {} : { publish: COMPETITOR_WATCH_ANSWERS.publish }),
        },
      }),
    );
  }
  const soloSteps = Object.entries(COMPETITOR_WATCH_TRIES).flatMap(([nodeId, tries]) =>
    tries.map(({ at, value }, index) =>
      storyStep(
        COMPETITOR_WATCH,
        workflowId,
        null,
        `story-try:${nodeId}:${index + 1}`,
        nodeId,
        { startedAt: new Date(Date.parse(at) - 6000).toISOString(), endedAt: at },
        { output: value },
      ),
    ),
  );
  const newestFirst = (left: string | null, right: string | null) => (right ?? "").localeCompare(left ?? "");
  return {
    runs: runs.sort((left, right) => newestFirst(left.run.startedAt, right.run.startedAt)),
    soloSteps: soloSteps.sort((left, right) => newestFirst(left.startedAt, right.startedAt)),
    nextBefore: null,
  };
}

/** The graph without some nodes and their connections. */
function withoutNodes(graph: WorkflowGraph, ids: readonly string[]): WorkflowGraph {
  const gone = new Set(ids);
  return {
    nodes: graph.nodes.filter((node) => !gone.has(node.id)),
    edges: graph.edges.filter((edge) => !gone.has(edge.from) && !gone.has(edge.to)),
    strokes: graph.strokes,
  };
}

/** A time today, but not after now, so that a story version is never newer than a version the story saves. */
const earlierToday = (hours: number, minutes: number) =>
  new Date(Math.min(Date.parse(todayAt(hours, minutes)), Date.now() - 60_000)).toISOString();

/** The auto-saved versions of Competitor watch, newest first. The column headings came last, one column at a time. */
function competitorWatchVersions(): StoryVersion[] {
  return [
    { at: earlierToday(11, 30), without: ["h-publish"] },
    { at: octoberAt(23, 17, 4), without: ["h-image", "h-publish"] },
    { at: octoberAt(22, 10, 15), without: ["h-inputs", "h-research", "h-write", "h-image", "h-publish"] },
  ].map(({ at, without }, index) => ({
    version: { id: `story-version-${3 - index}`, at, kind: "auto", revision: 0 },
    graph: withoutNodes(COMPETITOR_WATCH, without),
  }));
}

/** Competitor watch with its run history and versions. `last` adds a run that ended just now. */
export function competitorWatch(last?: "done" | "failed"): StoryWorkflow {
  const id = "competitor-watch";
  return {
    id,
    title: STORY_SEED.title,
    graph: COMPETITOR_WATCH,
    runs: competitorWatchRuns(id, last),
    versions: competitorWatchVersions(),
  };
}

/** New competitor alert, which never ran. */
export const newCompetitorAlert = (): StoryWorkflow => ({
  id: "new-competitor-alert",
  title: "New competitor alert",
  graph: NEW_COMPETITOR_ALERT,
});

/* ------------------------------------------------------------ GitHub */

const TRIAGE_REPOSITORY = "openbot-preview/app";

/** Issue help: a new comment on an issue goes to an agent, which answers on the issue and labels it. */
const GITHUB_TRIAGE: WorkflowGraph = {
  nodes: [
    {
      kind: "trigger",
      id: "comment",
      at: { x: 0, y: 40 },
      fields: { trigger: "github", repository: TRIAGE_REPOSITORY, event: "comment", filters: "notBot" },
    },
    {
      kind: "agent",
      id: "triage",
      at: { x: 420, y: 0 },
      fields: {
        agentId: "research",
        task: "Read the comment and the issue, find the likely cause, and answer in 5 lines",
      },
    },
    {
      kind: "output",
      id: "answer",
      at: { x: 840, y: -120 },
      fields: { target: "github", action: "comment" },
    },
    {
      kind: "output",
      id: "label",
      at: { x: 840, y: 240 },
      fields: { target: "github", action: "label.add", labelsFrom: "agent", labels: "bug\nenhancement" },
    },
  ],
  edges: [
    { id: "comment>triage:text", from: "comment", to: "triage", type: "text" },
    { id: "triage>answer:text", from: "triage", to: "answer", type: "text" },
    { id: "triage>label:text", from: "triage", to: "label", type: "text" },
  ],
  strokes: [],
};

/** A run of Issue help that a comment started. An open run has its trigger done and its agent at work. */
function triageRun(
  workflowId: string,
  number: number,
  item: WorkflowGitHubItem,
  startedAt: string,
  open: boolean,
): WorkflowRunDetail {
  const id = `story-github-run-${number}`;
  const start = Date.parse(startedAt);
  const at = (seconds: number) => new Date(start + seconds * 1000).toISOString();
  const step = (nodeId: string, times: { startedAt: string; endedAt: string }, output: string) =>
    storyStep(GITHUB_TRIAGE, workflowId, id, `${id}:${nodeId}`, nodeId, times, { output });
  const steps = [step("comment", { startedAt: at(0), endedAt: at(0) }, STEP_ANSWER.trigger ?? "")];
  if (open) {
    steps.push({ ...step("triage", { startedAt: at(1), endedAt: at(1) }, ""), status: "running", endedAt: null });
  } else {
    steps.push(
      step("triage", { startedAt: at(1), endedAt: at(40) }, AGENT_RESULT),
      step("answer", { startedAt: at(40), endedAt: at(42) }, `Commented on #${item.number}.`),
      step("label", { startedAt: at(40), endedAt: at(43) }, `Added the label bug to #${item.number}.`),
    );
  }
  return {
    run: {
      id,
      workflowId,
      number,
      triggerNodeId: "comment",
      source: "github",
      status: open ? "running" : "done",
      error: null,
      startedAt,
      endedAt: open ? null : at(43),
    },
    steps,
  };
}

/**
 * Issue help with two runs open at the same time, one for each of two issues. A second comment on one
 * of them waits until the run of its issue ends. An earlier run ended.
 */
export function githubTriage(): StoryWorkflow {
  const id = "github-triage";
  const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();
  const item = (number: number, title: string): WorkflowGitHubItem => ({
    repository: TRIAGE_REPOSITORY,
    number,
    pullRequest: false,
    title,
  });
  const started = [
    { item: item(42, "Crash when the export folder is missing"), minutes: 1, open: true },
    { item: item(41, "Settings window opens off screen"), minutes: 2, open: true },
    { item: item(38, "Export fails when the folder name has a space"), minutes: 90, open: false },
  ].map((entry, index) => ({
    item: entry.item,
    detail: triageRun(id, 3 - index, entry.item, ago(entry.minutes), entry.open),
  }));
  const waiting = started[0]?.item ?? null;
  return {
    id,
    title: "Issue help",
    graph: GITHUB_TRIAGE,
    runs: { runs: started.map((entry) => entry.detail), soloSteps: [], nextBefore: null },
    github: {
      deliveries: [
        {
          id: "story-delivery-4",
          nodeId: "comment",
          event: "comment",
          item: waiting,
          receivedAt: ago(0.5),
          outcome: "waiting",
          reason: null,
          runId: null,
        },
        ...started.map(
          ({ item, detail }): WorkflowGitHubDelivery => ({
            id: `story-delivery-${detail.run.number}`,
            nodeId: "comment",
            event: "comment",
            item,
            receivedAt: detail.run.startedAt,
            outcome: "started",
            reason: null,
            runId: detail.run.id,
          }),
        ),
      ],
      runs: started.map(({ item, detail }) => ({ runId: detail.run.id, item })),
    },
  };
}

/**
 * The GitHub of the node stories: connected, with one repository that the bot can change and one that
 * it can only read. The buttons do nothing.
 */
export const STORY_GITHUB: WorkflowGitHubCanvas = {
  catalog: () => ({
    connected: true,
    repositories: [
      { fullName: TRIAGE_REPOSITORY, private: false, canWrite: true, events: true },
      { fullName: "openbot-preview/docs", private: true, canWrite: false, events: true },
    ],
  }),
  history: () => EMPTY_GITHUB_HISTORY,
  run: () => undefined,
  options: () => ({
    labels: [
      { name: "bug", color: "d73a4a" },
      { name: "enhancement", color: "a2eeef" },
      { name: "needs triage", color: "fbca04" },
    ],
    people: ["octocat", "hubot"],
  }),
  connection: () => ({
    status: {
      available: true,
      state: "connected",
      login: "octocat",
      avatarUrl: null,
      userCode: null,
      verificationUri: null,
      error: null,
    },
    busy: false,
    repositories: null,
    repositoriesError: null,
    onConnect: () => undefined,
    onCancel: () => undefined,
    onOpenVerification: () => undefined,
    onOpenInstall: () => undefined,
  }),
  openGitHub: () => undefined,
  opening: () => false,
  openItem: () => undefined,
  runLastEvent: () => undefined,
};
