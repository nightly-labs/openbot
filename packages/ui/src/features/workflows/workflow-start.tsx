import type { RoutineSchedule, WorkflowNodeKind } from "@openbot/contracts/ipc";
import type { AppMessages, AppTranslate } from "@openbot/i18n";
import { Button, Plus } from "@openbot/ui";
import { For, onCleanup } from "solid-js";
import { createScrollFades } from "../../components/createScrollFades";
import { ScrollEdgeBlur } from "../../components/ScrollEdgeBlur";
import { useText } from "../../text";
import type { WfnFields } from "./workflow-board";
import type { Clip } from "./workflow-clipboard";
import { defaultWorkflowModel, type WorkflowCatalogs, type WorkflowFeatures } from "./workflow-model";

type TextKey = Extract<keyof AppMessages, `workflow.template.${string}`>;

interface TemplateStep {
  readonly id: string;
  readonly kind: WorkflowNodeKind;
  readonly at: { readonly x: number; readonly y: number };
  readonly schedule?: RoutineSchedule;
}

interface TemplateHost {
  readonly t: AppTranslate;
  readonly features: WorkflowFeatures;
  readonly catalogs: WorkflowCatalogs;
}

export interface WorkflowTemplate {
  readonly id: string;
  readonly title: TextKey;
  readonly brief: TextKey;
  readonly steps: readonly TemplateStep[];
  readonly edges: Clip["edges"];
  readonly fields: (host: TemplateHost) => Record<string, WfnFields>;
}

const NODE_HEIGHT = 200;
const NODE_WIDTH: Partial<Record<WorkflowNodeKind, number>> = { agent: 350, llm: 350, trigger: 320, output: 320 };
const THUMB = { width: 240, height: 100, margin: 14 };

const link = (from: string, to: string, branch?: string): Clip["edges"][number] =>
  branch === undefined
    ? { id: `${from}>${to}:text`, from, to, type: "text" }
    : { id: `${from}.${branch}>${to}:text`, from, to, type: "text", branch };

const MORNING_BRIEF: WorkflowTemplate = {
  id: "morningBrief",
  title: "workflow.template.morningBrief.title",
  brief: "workflow.template.morningBrief.brief",
  steps: [
    { id: "start", kind: "trigger", at: { x: 0, y: 40 }, schedule: { kind: "daily", time: "08:00" } },
    { id: "collect", kind: "agent", at: { x: 440, y: 0 } },
    { id: "send", kind: "output", at: { x: 920, y: 40 } },
  ],
  edges: [link("start", "collect"), link("collect", "send")],
  fields: ({ t }) => ({
    start: { trigger: "schedule" },
    collect: { task: t("workflow.template.morningBrief.task") },
    send: { target: "notify", title: t("workflow.template.morningBrief.title") },
  }),
};

const ANSWER_ISSUES: WorkflowTemplate = {
  id: "answerIssues",
  title: "workflow.template.answerIssues.title",
  brief: "workflow.template.answerIssues.brief",
  steps: [
    { id: "issue", kind: "trigger", at: { x: 0, y: 60 } },
    { id: "triage", kind: "agent", at: { x: 440, y: 0 } },
    { id: "reply", kind: "output", at: { x: 920, y: -160 } },
    { id: "label", kind: "output", at: { x: 920, y: 240 } },
  ],
  edges: [link("issue", "triage"), link("triage", "reply"), link("triage", "label")],
  fields: ({ t }) => ({
    issue: { trigger: "github", event: "issue.opened", filters: "notBot" },
    triage: { task: t("workflow.template.answerIssues.task") },
    reply: { target: "github", action: "comment", item: "event", repository: "trigger" },
    label: {
      target: "github",
      action: "label.add",
      item: "event",
      repository: "trigger",
      labelsFrom: "agent",
      labels: "bug\nquestion\nenhancement",
    },
  }),
};

const WEEKLY_REPORT: WorkflowTemplate = {
  id: "weeklyReport",
  title: "workflow.template.weeklyReport.title",
  brief: "workflow.template.weeklyReport.brief",
  steps: [
    { id: "friday", kind: "trigger", at: { x: 0, y: 40 }, schedule: { kind: "weekly", weekday: 5, time: "16:00" } },
    { id: "sum", kind: "agent", at: { x: 440, y: 0 } },
    { id: "check", kind: "approval", at: { x: 920, y: 40 } },
    { id: "post", kind: "output", at: { x: 1360, y: 40 } },
  ],
  edges: [link("friday", "sum"), link("sum", "check"), link("check", "post")],
  fields: ({ t, features, catalogs }) => {
    const channel = catalogs.channels?.[0];
    const post: WfnFields =
      channel && features.outputs.includes("chat-channel")
        ? { target: "chat-channel", channelId: channel.id }
        : { target: "notify", title: t("workflow.template.weeklyReport.title") };
    return {
      friday: { trigger: "schedule" },
      sum: { task: t("workflow.template.weeklyReport.task") },
      check: { question: t("workflow.template.weeklyReport.question") },
      post,
    };
  },
};

const PRICE_WATCH: WorkflowTemplate = {
  id: "priceWatch",
  title: "workflow.template.priceWatch.title",
  brief: "workflow.template.priceWatch.brief",
  steps: [
    { id: "morning", kind: "trigger", at: { x: 0, y: 40 }, schedule: { kind: "daily", time: "09:00" } },
    { id: "read", kind: "agent", at: { x: 440, y: 0 } },
    { id: "lower", kind: "condition", at: { x: 920, y: 40 } },
    { id: "alert", kind: "output", at: { x: 1360, y: 40 } },
  ],
  edges: [link("morning", "read"), link("read", "lower"), link("lower", "alert", "yes")],
  fields: ({ t }) => ({
    morning: { trigger: "schedule" },
    read: { task: t("workflow.template.priceWatch.task") },
    lower: { rule: t("workflow.template.priceWatch.rule") },
    alert: { target: "notify", title: t("workflow.template.priceWatch.alert") },
  }),
};

const SOCIAL_POST: WorkflowTemplate = {
  id: "socialPost",
  title: "workflow.template.socialPost.title",
  brief: "workflow.template.socialPost.brief",
  steps: [
    { id: "idea", kind: "prompt", at: { x: 0, y: 160 } },
    { id: "write", kind: "llm", at: { x: 440, y: 0 } },
    { id: "picture", kind: "image", at: { x: 440, y: 380 } },
  ],
  edges: [link("idea", "write"), link("idea", "picture")],
  fields: ({ t }) => ({
    idea: { text: t("workflow.template.socialPost.idea") },
    write: { prompt: t("workflow.template.socialPost.prompt") },
    picture: { media: "image", prompt: t("workflow.template.socialPost.picture"), aspect: "1:1" },
  }),
};

export const WORKFLOW_TEMPLATES: readonly WorkflowTemplate[] = [
  MORNING_BRIEF,
  ANSWER_ISSUES,
  WEEKLY_REPORT,
  PRICE_WATCH,
  SOCIAL_POST,
];

const fieldText = (fields: WfnFields | undefined, name: string) => {
  const value = fields?.[name];
  return typeof value === "string" ? value : undefined;
};

function stepRunnable(kind: WorkflowNodeKind, catalogs: WorkflowCatalogs): boolean {
  if (kind === "agent") return catalogs.agents.length > 0;
  if (kind === "llm" || kind === "condition") return defaultWorkflowModel(catalogs) !== undefined;
  if (kind === "image") return catalogs.imageModels.some((choice) => choice.kinds.includes("image"));
  return true;
}

export function templateAvailable(template: WorkflowTemplate, host: TemplateHost): boolean {
  const fields = template.fields(host);
  return template.steps.every((step) => {
    if (!host.features.kinds.includes(step.kind) || !stepRunnable(step.kind, host.catalogs)) return false;
    const own = fields[step.id];
    const trigger = fieldText(own, "trigger");
    const target = fieldText(own, "target");
    if (step.kind === "trigger" && trigger !== undefined && !host.features.triggers.some((type) => type === trigger))
      return false;
    return !(step.kind === "output" && target !== undefined && !host.features.outputs.some((type) => type === target));
  });
}

export function templateClip(template: WorkflowTemplate, host: TemplateHost): Clip {
  return {
    nodes: template.steps.map((step) => ({
      id: step.id,
      kind: step.kind,
      at: { ...step.at },
      ...(step.schedule ? { schedule: step.schedule } : {}),
    })),
    sizes: {},
    fields: template.fields(host),
    edges: template.edges,
  };
}

function templateThumb(template: WorkflowTemplate) {
  const boxes = template.steps.map((step) => ({
    id: step.id,
    kind: step.kind,
    x: step.at.x,
    y: step.at.y,
    width: NODE_WIDTH[step.kind] ?? 300,
    height: NODE_HEIGHT,
  }));
  const left = Math.min(...boxes.map((box) => box.x));
  const top = Math.min(...boxes.map((box) => box.y));
  const right = Math.max(...boxes.map((box) => box.x + box.width));
  const bottom = Math.max(...boxes.map((box) => box.y + box.height));
  const room = { width: THUMB.width - THUMB.margin * 2, height: THUMB.height - THUMB.margin * 2 };
  const scale = Math.min(room.width / (right - left), room.height / (bottom - top));
  const offset = {
    x: (THUMB.width - (right - left) * scale) / 2,
    y: (THUMB.height - (bottom - top) * scale) / 2,
  };
  const nodes = boxes.map((box) => ({
    id: box.id,
    kind: box.kind,
    x: offset.x + (box.x - left) * scale,
    y: offset.y + (box.y - top) * scale,
    width: box.width * scale,
    height: box.height * scale,
  }));
  const placed = new Map(nodes.map((box) => [box.id, box]));
  const links = template.edges.flatMap((edge) => {
    const from = placed.get(edge.from);
    const to = placed.get(edge.to);
    if (!from || !to) return [];
    const start = { x: from.x + from.width, y: from.y + from.height / 2 };
    const end = { x: to.x, y: to.y + to.height / 2 };
    const bend = Math.max(6, (end.x - start.x) / 2);
    return [
      {
        id: edge.id,
        d: `M ${start.x} ${start.y} C ${start.x + bend} ${start.y}, ${end.x - bend} ${end.y}, ${end.x} ${end.y}`,
      },
    ];
  });
  return { nodes, links };
}

function TemplateCard(props: { template: WorkflowTemplate; onPick: () => void }) {
  const { t } = useText();
  const thumb = templateThumb(props.template);
  return (
    <Button variant="ghost" class="wfn-start-card" onClick={() => props.onPick()}>
      <span class="wfn-start-thumb" aria-hidden="true">
        <svg class="wfn-start-svg" viewBox={`0 0 ${THUMB.width} ${THUMB.height}`} aria-hidden="true">
          <For each={thumb.links}>{(line) => <path class="wfn-start-link" d={line.d} />}</For>
          <For each={thumb.nodes}>
            {(box) => (
              <rect
                class="wfn-minimap-node wfn-start-node"
                data-kind={box.kind}
                x={box.x}
                y={box.y}
                width={box.width}
                height={box.height}
                rx={3}
              />
            )}
          </For>
        </svg>
      </span>
      <span class="wfn-start-text">
        <span class="wfn-start-name">{t(props.template.title)}</span>
        <span class="wfn-start-brief">{t(props.template.brief)}</span>
      </span>
    </Button>
  );
}

export function WorkflowStart(props: {
  templates: readonly WorkflowTemplate[];
  onTemplate: (template: WorkflowTemplate) => void;
  onBlank: () => void;
}) {
  const { t } = useText();
  const fades = createScrollFades();
  onCleanup(() => fades.stop());
  return (
    <>
      <div ref={(element) => fades.bind(element)} class={["wfn-empty", fades.classes()]} onScroll={fades.measure}>
        <h2 class="wfn-start-title">{t("workflow.canvas.start.title")}</h2>
        <div class="wfn-start-grid" ref={(element) => fades.watch(element)}>
          <For each={props.templates}>
            {(template) => <TemplateCard template={template} onPick={() => props.onTemplate(template)} />}
          </For>
          <Button variant="ghost" class="wfn-start-card" onClick={() => props.onBlank()}>
            <span class="wfn-start-thumb" aria-hidden="true">
              <span class="wfn-menu-icon wfn-start-blank">
                <Plus />
              </span>
            </span>
            <span class="wfn-start-text">
              <span class="wfn-start-name">{t("workflow.canvas.start.blank")}</span>
            </span>
          </Button>
        </div>
      </div>
      <ScrollEdgeBlur fades={fades} />
    </>
  );
}
