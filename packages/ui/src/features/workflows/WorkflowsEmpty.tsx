import type { AppTextKey } from "@openbot/i18n";
import { Bot, Button, Image, Plus, Send, Sparkles, Zap } from "@openbot/ui";
import type { JSX } from "@solidjs/web";
import { createSignal, For, onSettled, Show } from "solid-js";
import { useText } from "../../text";
import { prefersReducedMotion } from "../../utils";
import type { SwitcherWorkflow } from "./WorkflowSwitcher";

const STEP_MS = 1100;
const LENGTH = 12;
const RUN = 6;
const STILL = 10;
const MARGIN = 48;
const NODE_WIDTH = 240;
const PORT_Y = 66;
const WORLD = { width: 1280, height: 620 };

const SAMPLE_NODES = [
  { id: "trigger", x: 0, y: 260, depth: 0, label: "workflow.trigger.title", icon: () => <Zap /> },
  { id: "agent", x: 340, y: 0, depth: 1, label: "workflow.agent.title", icon: () => <Bot /> },
  { id: "llm", x: 700, y: 0, depth: 2, label: "workflow.llm.title", icon: () => <Sparkles /> },
  { id: "image", x: 700, y: 520, depth: 2, label: "workflow.image.title", icon: () => <Image /> },
  { id: "output", x: 1040, y: 260, depth: 3, label: "workflow.output.title", icon: () => <Send /> },
] as const satisfies readonly {
  id: string;
  x: number;
  y: number;
  depth: number;
  label: AppTextKey;
  icon: () => JSX.Element;
}[];

type SampleNode = (typeof SAMPLE_NODES)[number];

const SAMPLE_EDGES = [
  ["trigger", "agent"],
  ["agent", "llm"],
  ["agent", "image"],
  ["llm", "output"],
  ["image", "output"],
] as const satisfies readonly (readonly [SampleNode["id"], SampleNode["id"]])[];

function sampleNode(id: SampleNode["id"]): SampleNode {
  return SAMPLE_NODES.find((node) => node.id === id) ?? SAMPLE_NODES[0];
}

function edgePath(from: SampleNode, to: SampleNode) {
  const x1 = from.x + NODE_WIDTH;
  const y1 = from.y + PORT_Y;
  const x2 = to.x;
  const y2 = to.y + PORT_Y;
  const bend = Math.max(48, (x2 - x1) / 2);
  return `M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}`;
}

export function nextWorkflowAfterDelete(
  workflows: readonly SwitcherWorkflow[],
  deletedId: string,
): SwitcherWorkflow | undefined {
  const index = workflows.findIndex((workflow) => workflow.id === deletedId);
  const rest = workflows.filter((workflow) => workflow.id !== deletedId);
  return rest[Math.min(Math.max(index, 0), rest.length - 1)];
}

export function WorkflowsEmpty(props: {
  next: SwitcherWorkflow | undefined;
  onOpen: (workflowId: string) => void;
  onCreate: () => void;
}) {
  const { t } = useText();
  const [tick, setTick] = createSignal(0);
  const [still, setStill] = createSignal(false);
  onSettled(() => {
    if (prefersReducedMotion()) {
      setStill(true);
      setTick(STILL);
      return;
    }
    const timer = window.setInterval(() => setTick((value) => value + 1), STEP_MS);
    return () => window.clearInterval(timer);
  });
  const step = () => tick() % LENGTH;

  const title = () => {
    const marker = "\u0000";
    const [before = "", after = ""] = t("workflow.canvas.none.title", { run: marker }).split(marker);
    return { before, after };
  };

  return (
    <div class="wfn-none" data-still={still() ? "" : undefined}>
      <WorkflowsEmptyBackdrop step={step()} loop={Math.floor(tick() / LENGTH)} />
      <div class="wfn-none-pitch">
        <h2 class="wfn-none-title">
          <span class="wfn-none-lead">{t("workflow.canvas.none.lead")}</span>
          <span>
            {title().before}
            <span class="wfn-none-hand">{t("workflow.canvas.none.run")}</span>
            {title().after}
          </span>
        </h2>
        <p class="wfn-none-lines">
          <span>{t("workflow.canvas.none.trigger")}</span>
          <span>{t("workflow.canvas.none.handoff")}</span>
        </p>
        <Button type="button" class="wfn-none-action" onClick={() => props.onCreate()}>
          <Plus aria-hidden="true" />
          {t("workflow.canvas.switcher.new")}
        </Button>
        <Show when={props.next}>
          {(next) => (
            <Button type="button" variant="ghost" class="wfn-none-open" onClick={() => props.onOpen(next().id)}>
              <span class="wfn-none-open-name">{t("workflow.canvas.none.open", { name: next().title })}</span>
            </Button>
          )}
        </Show>
      </div>
    </div>
  );
}

function WorkflowsEmptyBackdrop(props: { step: number; loop: number }) {
  const { t } = useText();
  let frame: HTMLDivElement | undefined;
  const [scale, setScale] = createSignal(1);

  onSettled(() => {
    const area = frame;
    if (!area) return;
    const observer = new ResizeObserver(() => {
      setScale(
        Math.min(1, (area.clientWidth - MARGIN * 2) / WORLD.width, (area.clientHeight - MARGIN * 2) / WORLD.height),
      );
    });
    observer.observe(area);
    return () => observer.disconnect();
  });

  const shown = (node: SampleNode) => node.depth + 1 <= props.step;
  const state = (node: SampleNode) => {
    if (props.step < RUN + node.depth) return undefined;
    return props.step === RUN + node.depth ? "running" : "done";
  };

  return (
    <div
      ref={(element) => (frame = element)}
      class="wfn-none-backdrop"
      data-leaving={props.step === LENGTH - 1 ? "" : undefined}
      inert
      aria-hidden="true"
    >
      <For each={[props.loop]}>
        {() => (
          <div
            class="wfn-none-world"
            style={{
              width: `${WORLD.width}px`,
              height: `${WORLD.height}px`,
              "--wfn-none-scale": String(scale()),
            }}
          >
            <svg class="wfn-edges" aria-hidden="true">
              <For each={SAMPLE_EDGES}>
                {([fromId, toId]) => {
                  const from = sampleNode(fromId);
                  const to = sampleNode(toId);
                  return (
                    <g
                      class="wfn-edge wfn-none-edge"
                      data-tone={state(to) === undefined ? undefined : "done"}
                      data-shown={shown(to) ? "" : undefined}
                    >
                      <path class="wfn-edge-line" d={edgePath(from, to)} />
                    </g>
                  );
                }}
              </For>
            </svg>
            <For each={SAMPLE_NODES}>
              {(node) => (
                <div
                  class="wfn-node wfn-none-node"
                  data-shown={shown(node) ? "" : undefined}
                  data-state={state(node)}
                  style={{ left: `${node.x}px`, top: `${node.y}px` }}
                >
                  <span class="wfn-label">
                    {node.icon()}
                    {t(node.label)}
                  </span>
                  <div class="wfn-card">
                    <span class="wfn-none-line" />
                    <span class="wfn-none-line" />
                    <span class="wfn-none-line" />
                  </div>
                </div>
              )}
            </For>
          </div>
        )}
      </For>
    </div>
  );
}
