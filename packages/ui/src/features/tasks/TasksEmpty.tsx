import type { AvatarMood } from "@openbot/brand/bloub-avatar-motion";
import type { AgentTask } from "@openbot/contracts/ipc";
import type { AppTextKey } from "@openbot/i18n";
import { taskTone } from "@openbot/team-client/agent-tasks";
import { buttonVariants } from "@openbot/ui";
import { SwapLabel } from "@openbot/ui/components/SwapLabel";
import type { AgentProfile } from "@openbot/ui/data";
import { AgentAvatar } from "@openbot/ui/features/agents/AgentAvatar";
import { AgentTaskMark, agentTaskStatus } from "@openbot/ui/features/conversation/AgentTasks";
import { useText } from "@openbot/ui/text";
import { prefersReducedMotion } from "@openbot/ui/utils";
import { createMemo, createSignal, For, onSettled } from "solid-js";

/** One sample task: its title, and what its agent does while it runs. */
interface SampleTask {
  id: string;
  title: AppTextKey;
  progress: AppTextKey;
}

const SAMPLE_TASKS: SampleTask[] = [
  {
    id: "hiring",
    title: "conversation.tasks.empty.sample.hiring",
    progress: "conversation.tasks.empty.sample.hiringProgress",
  },
  {
    id: "papers",
    title: "conversation.tasks.empty.sample.papers",
    progress: "conversation.tasks.empty.sample.papersProgress",
  },
  {
    id: "call",
    title: "conversation.tasks.empty.sample.call",
    progress: "conversation.tasks.empty.sample.callProgress",
  },
  {
    id: "offsite",
    title: "conversation.tasks.empty.sample.offsite",
    progress: "conversation.tasks.empty.sample.offsiteProgress",
  },
  {
    id: "paper",
    title: "conversation.tasks.empty.sample.paper",
    progress: "conversation.tasks.empty.sample.paperProgress",
  },
  {
    id: "contacts",
    title: "conversation.tasks.empty.sample.contacts",
    progress: "conversation.tasks.empty.sample.contactsProgress",
  },
];

/** A task moves one section on each step. The CSS transitions are shorter than a step. */
const STEP_MS = 2400;
/** Waiting, Working, Answered: the steps a task is on screen before it fades. */
const LIFE = 3;

/** How far a task is in its life: 0 waits, 1 works, 2 is answered, 3 fades out. */
type Age = 0 | 1 | 2 | 3;
const AGES: readonly Age[] = [0, 1, 2, 3];
const MOOD: Record<Age, AvatarMood> = { 0: "waiting", 1: "working", 2: "responded", 3: "responded" };

const SECTIONS = [
  "conversation.tasks.section.needsYou",
  "conversation.tasks.section.working",
  "conversation.tasks.section.waiting",
] as const satisfies readonly AppTextKey[];

/** The title of the empty page. The second line ends on one handwritten word, written once. */
export function TasksEmptyPitch() {
  const { t } = useText();
  const title = () => {
    const marker = "\u0000";
    const [before = "", after = ""] = t("conversation.tasks.empty.title", { answer: marker }).split(marker);
    return { before, after };
  };
  return (
    <div class="tasks-page-empty-pitch">
      <h3 class="tasks-page-empty-title">
        <span class="tasks-page-empty-lead">{t("conversation.tasks.empty.lead")}</span>
        <span>
          {title().before}
          <span class="tasks-page-empty-word">{t("conversation.tasks.empty.answer")}</span>
          {title().after}
        </span>
      </h3>
      <p class="tasks-page-empty-lines">
        <span>{t("conversation.tasks.empty.together")}</span>
        <span>{t("conversation.tasks.empty.waits")}</span>
      </p>
    </div>
  );
}

/**
 * A faint copy of the task list under the composer of the empty page. A sample task arrives in
 * Waiting, rises to Working, then to Needs you as Answered, and fades. Each step adds the next task.
 * It is decoration: nothing in it can be opened, and a reader does not hear it. Less motion keeps one
 * frame with one task in each section.
 */
export function TasksEmptyBoard(props: { agents: readonly AgentProfile[] }) {
  const { t } = useText();
  const [step, setStep] = createSignal(LIFE - 1);
  onSettled(() => {
    if (prefersReducedMotion()) return;
    const timer = window.setInterval(() => setStep((value) => value + 1), STEP_MS);
    return () => window.clearInterval(timer);
  });

  /** The tasks on screen: the newest one waits, the oldest fades out. */
  const shown = createMemo(() => {
    const current = step();
    const items: { key: string; index: number; sample: SampleTask; age: Age }[] = [];
    for (let index = Math.max(0, current - LIFE); index <= current; index += 1) {
      const sample = SAMPLE_TASKS[index % SAMPLE_TASKS.length];
      const age = AGES[current - index];
      if (sample && age !== undefined) items.push({ key: String(index), index, sample, age });
    }
    return items;
  });

  return (
    <div class="tasks-page-empty-board" aria-hidden="true" inert>
      <For each={SECTIONS}>
        {(key) => (
          <div class="tasks-page-section tasks-page-empty-section">
            <p class="tasks-page-section-heading">
              <span>{t(key)}</span>
              <span class="tasks-page-count">1</span>
            </p>
          </div>
        )}
      </For>
      <div class="tasks-page-empty-rows">
        <For each={shown()} keyed={(item) => item.key}>
          {(item) => (
            <SampleRow
              sample={item().sample}
              age={item().age}
              agent={props.agents.length > 0 ? props.agents[item().index % props.agents.length] : undefined}
            />
          )}
        </For>
      </div>
    </div>
  );
}

/**
 * One row with the real row styles: a span with the button classes, not a button. Its section is a
 * position, so a change of state moves it up.
 */
function SampleRow(props: { sample: SampleTask; age: Age; agent: AgentProfile | undefined }) {
  const { t } = useText();
  const task = createMemo((): AgentTask => {
    const at = new Date(0).toISOString();
    return {
      id: props.sample.id,
      agentId: props.agent?.id ?? "",
      threadId: props.sample.id,
      origin: "user",
      title: t(props.sample.title),
      state: props.age === 0 ? "queued" : props.age === 1 ? "running" : "idle",
      outcome: props.age >= 2 ? "completed" : null,
      hold: null,
      activeTurnId: props.age === 1 ? props.sample.id : null,
      progress: props.age === 1 ? t(props.sample.progress) : null,
      error: null,
      queuedMessages: [],
      createdAt: at,
      updatedAt: at,
      closedAt: null,
    };
  });
  return (
    <div
      class="tasks-page-empty-row"
      data-age={props.age}
      style={{ "--tasks-page-empty-slot": String(2 - Math.min(props.age, 2)) }}
    >
      <span class={`${buttonVariants({ variant: "ghost" })} tasks-page-row`}>
        <AgentTaskMark task={task()} decorative />
        <span class="tasks-page-row-title">{task().title}</span>
        <span class="tasks-page-status" data-tone={taskTone(task())}>
          <SwapLabel text={agentTaskStatus(task(), t)} />
        </span>
        <AgentAvatar agent={props.agent} mood={MOOD[props.age]} class="tasks-page-avatar" />
      </span>
    </div>
  );
}
