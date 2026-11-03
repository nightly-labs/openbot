/**
 * The GitHub settings of a trigger and of an output card. A GitHub trigger starts a run for each event that
 * matches its repository, its event and its filters; the Events row lists what each event did. A GitHub
 * output makes one change on the issue or the pull request of the event, as OpenBot's bot.
 */

import {
  WORKFLOW_GITHUB_ACTIONS,
  WORKFLOW_GITHUB_CLOSE_REASONS,
  WORKFLOW_GITHUB_EVENTS,
  WORKFLOW_GITHUB_FILTERS,
  WORKFLOW_GITHUB_PULL_REQUEST_ACTIONS,
  type WorkflowGitHubAction,
  type WorkflowGitHubCloseReason,
  type WorkflowGitHubDelivery,
  type WorkflowGitHubEvent,
  type WorkflowGitHubFilter,
  type WorkflowGitHubItem,
  type WorkflowGitHubSkipReason,
  workflowGitHubEventItemKind,
} from "@openbot/contracts/ipc";
import type { AppTextKey, AppTranslate } from "@openbot/i18n";
import {
  AtSign,
  Bot,
  Button,
  ChevronDown,
  CircleCheck,
  CircleDot,
  CirclePlus,
  CircleX,
  DropdownMenu,
  Eye,
  FileDiff,
  Filter,
  GitCommitHorizontal,
  GitMerge,
  GitPullRequest,
  Hash,
  Hourglass,
  ListChecks,
  LoaderCircle,
  Lock,
  MessageSquare,
  MessageSquareReply,
  OctagonX,
  Repeat2,
  RotateCcw,
  Square,
  Tag,
  TriangleAlert,
  UserCheck,
  UserPlus,
  WifiOff,
  Zap,
} from "@openbot/ui";
import type { JSX } from "@solidjs/web";
import { createSignal, Show } from "solid-js";
import { useText } from "../../text";
import { GitHubMark } from "../settings/brand-marks";
import { GitHubConnectDialog } from "../settings/GitHubConnectorPanel";
import { PickerActions, type PickerChip, type PickerGroup } from "./WorkflowPicker";
import { useBoard } from "./workflow-board";
import { githubRepository, type WorkflowGitHubCanvas } from "./workflow-github";
import { asString, type Choice, oneOf, useField, useTextField } from "./workflow-node-parts";
import { InputRow, SettingListRow, SettingRow, SettingsFoot, useListField } from "./workflow-setting-rows";

export function GitHubIcon() {
  return <GitHubMark class="wfn-github-mark" />;
}

const EVENT_ICONS: Record<WorkflowGitHubEvent, () => JSX.Element> = {
  "issue.opened": () => <CircleDot aria-hidden="true" />,
  "issue.closed": () => <CircleCheck aria-hidden="true" />,
  "issue.labeled": () => <Tag aria-hidden="true" />,
  "pr.opened": () => <GitPullRequest aria-hidden="true" />,
  "pr.updated": () => <GitCommitHorizontal aria-hidden="true" />,
  "pr.reviewRequested": () => <Eye aria-hidden="true" />,
  "pr.reviewSubmitted": () => <ListChecks aria-hidden="true" />,
  "pr.checksFailed": () => <CircleX aria-hidden="true" />,
  "pr.merged": () => <GitMerge aria-hidden="true" />,
  comment: () => <MessageSquare aria-hidden="true" />,
  mention: () => <AtSign aria-hidden="true" />,
  assigned: () => <UserCheck aria-hidden="true" />,
};

const ACTION_ICONS: Record<WorkflowGitHubAction, () => JSX.Element> = {
  comment: () => <MessageSquareReply aria-hidden="true" />,
  "label.add": () => <Tag aria-hidden="true" />,
  "label.remove": () => <Tag aria-hidden="true" />,
  assign: () => <UserPlus aria-hidden="true" />,
  "review.request": () => <Eye aria-hidden="true" />,
  "review.approve": () => <CircleCheck aria-hidden="true" />,
  "review.changes": () => <FileDiff aria-hidden="true" />,
  close: () => <CircleX aria-hidden="true" />,
  reopen: () => <RotateCcw aria-hidden="true" />,
  "issue.create": () => <CirclePlus aria-hidden="true" />,
};

const EVENT_LABEL = {
  "issue.opened": "workflow.github.event.issue.opened",
  "issue.closed": "workflow.github.event.issue.closed",
  "issue.labeled": "workflow.github.event.issue.labeled",
  "pr.opened": "workflow.github.event.pr.opened",
  "pr.updated": "workflow.github.event.pr.updated",
  "pr.reviewRequested": "workflow.github.event.pr.reviewRequested",
  "pr.reviewSubmitted": "workflow.github.event.pr.reviewSubmitted",
  "pr.checksFailed": "workflow.github.event.pr.checksFailed",
  "pr.merged": "workflow.github.event.pr.merged",
  comment: "workflow.github.event.comment",
  mention: "workflow.github.event.mention",
  assigned: "workflow.github.event.assigned",
} as const satisfies Record<WorkflowGitHubEvent, AppTextKey>;

const ACTION_LABEL = {
  comment: "workflow.github.action.comment",
  "label.add": "workflow.github.action.label.add",
  "label.remove": "workflow.github.action.label.remove",
  assign: "workflow.github.action.assign",
  "review.request": "workflow.github.action.review.request",
  "review.approve": "workflow.github.action.review.approve",
  "review.changes": "workflow.github.action.review.changes",
  close: "workflow.github.action.close",
  reopen: "workflow.github.action.reopen",
  "issue.create": "workflow.github.action.issue.create",
} as const satisfies Record<WorkflowGitHubAction, AppTextKey>;

const eventChoice = (t: AppTranslate, event: WorkflowGitHubEvent): Choice<WorkflowGitHubEvent> => ({
  value: event,
  label: t(EVENT_LABEL[event]),
  icon: EVENT_ICONS[event],
});

const EVENT_KIND_GROUPS = ["issue", "pullRequest", "both"] as const;

const EVENT_GROUP_LABEL = {
  issue: "workflow.github.events.issues",
  pullRequest: "workflow.github.events.pullRequests",
  both: "workflow.github.events.both",
} as const;

/** The events, in the groups of their menu. */
const eventGroups = (t: AppTranslate) =>
  EVENT_KIND_GROUPS.map((kind) => ({
    label: t(EVENT_GROUP_LABEL[kind]),
    choices: WORKFLOW_GITHUB_EVENTS.filter((event) => workflowGitHubEventItemKind(event) === kind).map((event) =>
      eventChoice(t, event),
    ),
  }));

const isPullRequestAction = (action: WorkflowGitHubAction) =>
  WORKFLOW_GITHUB_PULL_REQUEST_ACTIONS.some((value) => value === action);

/** A GitHub label colour as CSS. */
const labelTone = (color: string | undefined) => (color ? `#${color}` : undefined);

const itemIcon = (item: WorkflowGitHubItem) => () =>
  item.pullRequest ? <GitPullRequest aria-hidden="true" /> : <CircleDot aria-hidden="true" />;

function Warning(props: { children: string }) {
  return (
    <p class="wfn-alert" data-tone="warning">
      <TriangleAlert aria-hidden="true" />
      <span class="wfn-alert-text">{props.children}</span>
    </p>
  );
}

/** Opens the connect dialog of the GitHub page, which shows the code that the user types on GitHub. */
function ConnectButton(props: { github: WorkflowGitHubCanvas }) {
  const { t } = useText();
  const [open, setOpen] = createSignal(false);
  const connect = () => {
    setOpen(true);
    props.github.connection().onConnect();
  };
  return (
    <>
      <Button size="sm" variant="secondary" loading={props.github.connection().busy} onClick={connect}>
        <GitHubIcon />
        {t("connector.github.connect")}
      </Button>
      <GitHubConnectDialog {...props.github.connection()} open={open()} onClose={() => setOpen(false)} />
    </>
  );
}

/** One page on GitHub fixes access, write access and events: the installation of the App. */
function OpenGitHubButton(props: { github: WorkflowGitHubCanvas; label: string }) {
  const { t } = useText();
  return (
    <Button
      size="sm"
      variant="secondary"
      loading={props.github.opening()}
      loadingLabel={t("connector.github.waiting")}
      onClick={() => props.github.openGitHub()}
    >
      <GitHubIcon />
      {props.label}
    </Button>
  );
}

/** What stops a GitHub step on a repository, or undefined when it can act. Nothing shows while the host reads. */
type AccessProblem = "missing" | "readOnly" | "eventsOff";

function accessProblem(
  github: WorkflowGitHubCanvas | undefined,
  repository: string,
  need: { write: boolean; events: boolean },
): AccessProblem | undefined {
  const catalog = github?.catalog();
  if (!repository || !catalog?.connected) return undefined;
  const entry = githubRepository(github, repository);
  if (!entry) return "missing";
  if (need.write && !entry.canWrite) return "readOnly";
  if (need.events && !entry.events) return "eventsOff";
  return undefined;
}

function AccessAlerts(props: { github: WorkflowGitHubCanvas; repository: string; write: boolean; events: boolean }) {
  const { t } = useText();
  const problem = () => accessProblem(props.github, props.repository, { write: props.write, events: props.events });
  return (
    <>
      <Show when={problem() === "missing"}>
        <Warning>{t("workflow.github.alert.missing", { repository: props.repository })}</Warning>
        <OpenGitHubButton github={props.github} label={t("connector.github.chooseRepositories")} />
      </Show>
      <Show when={problem() === "readOnly"}>
        <Warning>{t("workflow.github.alert.readOnly", { repository: props.repository })}</Warning>
        <OpenGitHubButton github={props.github} label={t("connector.github.openGitHub")} />
      </Show>
      <Show when={problem() === "eventsOff"}>
        <Warning>{t("workflow.github.alert.eventsOff", { repository: props.repository })}</Warning>
        <OpenGitHubButton github={props.github} label={t("connector.github.openGitHub")} />
      </Show>
    </>
  );
}

/** The rows of a GitHub step, or a Connect button when GitHub is not connected. */
function Connected(props: { children: JSX.Element }) {
  const board = useBoard();
  const notConnected = () => {
    const github = board.github();
    return github && github.catalog()?.connected === false ? github : undefined;
  };
  return (
    <Show when={notConnected()} fallback={props.children}>
      {(github) => <ConnectButton github={github()} />}
    </Show>
  );
}

function useRepositoryChoices() {
  const board = useBoard();
  return (current: string): Choice<string>[] => {
    const repositories = board.github()?.catalog()?.repositories ?? [];
    const choices = repositories.map((repository) => ({
      value: repository.fullName,
      label: repository.fullName,
      icon: () => (repository.private ? <Lock aria-hidden="true" /> : <GitHubIcon />),
    }));
    const known = repositories.some((repository) => repository.fullName.toLowerCase() === current.toLowerCase());
    return current && current !== "trigger" && !known
      ? [{ value: current, label: current, icon: () => <GitHubIcon /> }, ...choices]
      : choices;
  };
}

/** The labels and people of a repository, as the host reads them. */
function useRepositoryOptions(repository: () => string) {
  const board = useBoard();
  const options = () => {
    const name = repository();
    return name ? board.github()?.options(name) : undefined;
  };
  return {
    labels: () => options()?.labels.map((label) => label.name) ?? [],
    tone: (name: string) => labelTone(options()?.labels.find((label) => label.name === name)?.color),
    people: () => options()?.people ?? [],
    /** The host still reads them. */
    loading: () => Boolean(repository()) && options() === undefined,
  };
}

/** Keeps the values that the user chose, and the ones of the repository after them. */
const withValues = (options: readonly string[], values: readonly string[]) => [
  ...values.filter((value) => !options.includes(value)),
  ...options,
];

/* ------------------------------------------------------------- Trigger */

/** The fields that a GitHub trigger stores when the user chooses it. The host reads the same names. */
export const GITHUB_TRIGGER_DEFAULTS = { event: "issue.opened", filters: "notBot" } as const;

/** The settings of a GitHub trigger. An output reads them too: it acts on the event. */
function useGitHubTrigger(id: () => string) {
  const board = useBoard();
  const [repository] = useField<string>(id, "repository", "", asString);
  const [event, setEvent] = useField<WorkflowGitHubEvent>(
    id,
    "event",
    GITHUB_TRIGGER_DEFAULTS.event,
    oneOf(WORKFLOW_GITHUB_EVENTS),
  );
  const [storedFilters, setFilters] = useListField(id, "filters", []);
  const [labels, setLabels] = useListField(id, "labels", []);
  const [titleText, setTitleText] = useTextField(id, "titleText", "");
  const [branch, setBranch] = useTextField(id, "branch", "");
  /** The base branch is a filter of pull requests only. */
  const filterOptions = (): WorkflowGitHubFilter[] =>
    WORKFLOW_GITHUB_FILTERS.filter(
      (filter) => filter !== "branch" || workflowGitHubEventItemKind(event()) === "pullRequest",
    );
  const filters = () => storedFilters().filter((filter) => filterOptions().some((option) => option === filter));
  /** Labels belong to one repository, so a new repository starts with none, in one change. */
  const setRepository = (value: string) => board.setFields(id(), { repository: value, labels: "" });
  return {
    repository,
    setRepository,
    event,
    setEvent,
    filterOptions,
    filters,
    setFilters,
    labels,
    setLabels,
    titleText,
    setTitleText,
    branch,
    setBranch,
  };
}

export function GitHubTriggerRows(props: { id: string; locked: boolean }) {
  const { t } = useText();
  const board = useBoard();
  const fields = useGitHubTrigger(() => props.id);
  const repositories = useRepositoryChoices();
  const options = useRepositoryOptions(fields.repository);
  // On "Issue labeled", the list is the labels that start a run. On other events, the item must have one of them.
  const labelsName = () =>
    fields.event() === "issue.labeled"
      ? t("workflow.github.trigger.labelAdded")
      : t("workflow.github.trigger.hasLabel");
  const filterLabel = (value: string) => {
    if (value === "notBot") return t("workflow.github.filter.notBot");
    if (value === "firstTime") return t("workflow.github.filter.firstTime");
    if (value === "title") return t("workflow.github.filter.title");
    return t("workflow.github.filter.branch");
  };
  const filterTag = (value: string) => {
    if (value === "title" && fields.titleText())
      return t("workflow.github.filter.titleValue", { text: fields.titleText() });
    if (value === "branch" && fields.branch())
      return t("workflow.github.filter.branchValue", { branch: fields.branch() });
    return filterLabel(value);
  };
  const hasFilter = (filter: WorkflowGitHubFilter) => fields.filters().some((value) => value === filter);
  return (
    <Connected>
      <SettingRow
        name={t("workflow.github.repository")}
        value={fields.repository()}
        placeholder={t("workflow.github.chooseRepository")}
        search={t("workflow.github.searchRepositories")}
        choices={repositories(fields.repository())}
        disabled={props.locked}
        onChange={fields.setRepository}
      />
      <SettingRow
        name={t("workflow.github.trigger.event")}
        value={fields.event()}
        choices={WORKFLOW_GITHUB_EVENTS.map((event) => eventChoice(t, event))}
        groups={eventGroups(t)}
        disabled={props.locked}
        onChange={fields.setEvent}
      />
      <SettingListRow
        name={labelsName()}
        empty={t("workflow.github.trigger.anyLabel")}
        options={withValues(options.labels(), fields.labels())}
        tone={options.tone}
        values={fields.labels()}
        loading={options.loading()}
        disabled={props.locked}
        onChange={fields.setLabels}
      />
      <SettingListRow
        name={t("workflow.github.trigger.onlyWhen")}
        empty={t("workflow.github.trigger.always")}
        options={fields.filterOptions()}
        values={fields.filters()}
        optionLabel={filterLabel}
        tagLabel={filterTag}
        disabled={props.locked}
        onChange={fields.setFilters}
      />
      <Show when={hasFilter("title")}>
        <InputRow
          name={t("workflow.github.trigger.titleHas")}
          value={fields.titleText()}
          disabled={props.locked}
          onChange={fields.setTitleText}
        />
      </Show>
      <Show when={hasFilter("branch")}>
        <InputRow
          name={t("workflow.github.trigger.baseBranch")}
          value={fields.branch()}
          placeholder={t("workflow.github.trigger.baseBranchPlaceholder")}
          disabled={props.locked}
          onChange={fields.setBranch}
        />
      </Show>
      <Show when={board.github()}>
        {(github) => (
          <>
            <AccessAlerts github={github()} repository={fields.repository()} write={false} events />
            <Show when={fields.repository()}>
              <SettingsFoot>
                <EventsRow id={props.id} github={github()} />
              </SettingsFoot>
            </Show>
          </>
        )}
      </Show>
    </Connected>
  );
}

/** Whether "Run with last event" can start: GitHub is connected and the trigger can read its repository. */
export function useGitHubTriggerReady(id: () => string) {
  const board = useBoard();
  const fields = useGitHubTrigger(id);
  return () => {
    const github = board.github();
    if (!github?.catalog()?.connected || !fields.repository()) return false;
    return accessProblem(github, fields.repository(), { write: false, events: false }) !== "missing";
  };
}

/* ------------------------------------------------------ Events history */

const SKIP_ICONS: Record<WorkflowGitHubSkipReason, () => JSX.Element> = {
  filter: () => <Filter aria-hidden="true" />,
  self: () => <Repeat2 aria-hidden="true" />,
  chain: () => <OctagonX aria-hidden="true" />,
  offline: () => <WifiOff aria-hidden="true" />,
  refused: () => <OctagonX aria-hidden="true" />,
};

const SKIP_TEXT = {
  filter: "workflow.github.skip.filter",
  self: "workflow.github.skip.self",
  chain: "workflow.github.skip.chain",
  offline: "workflow.github.skip.offline",
  refused: "workflow.github.skip.refused",
} as const satisfies Record<WorkflowGitHubSkipReason, string>;

/** The icon of an event: its issue or pull request, or the gap of an offline host. */
function deliveryIcon(delivery: WorkflowGitHubDelivery) {
  return delivery.item ? itemIcon(delivery.item) : () => <WifiOff aria-hidden="true" />;
}

const sameItem = (left: WorkflowGitHubItem, right: WorkflowGitHubItem) =>
  left.number === right.number && left.repository.toLowerCase() === right.repository.toLowerCase();

/** The texts and the runs of the events of a GitHub trigger. */
function useGitHubHistory(github: () => WorkflowGitHubCanvas | undefined) {
  const { t, format } = useText();
  const runName = (number: number) => t("workflow.canvas.run.number", { number });
  const clock = (at: string) => format.date(new Date(at), { hour: "numeric", minute: "2-digit" });
  /** The open run on the item of an event that waits for it. */
  const waitsFor = (delivery: WorkflowGitHubDelivery) => {
    const item = delivery.item;
    const host = github();
    if (!item || !host) return undefined;
    for (const entry of host.history().runs) {
      const run = host.run(entry.runId);
      if (run && sameItem(entry.item, item) && ["running", "approval", "stopping"].includes(run.status)) return run;
    }
    return undefined;
  };
  const runChip = (runId: string | null): PickerChip => {
    const run = runId ? github()?.run(runId) : undefined;
    if (!run) return { icon: () => <Zap aria-hidden="true" />, text: t("workflow.github.history.started") };
    switch (run.status) {
      case "running":
      case "stopping":
        return {
          icon: () => <LoaderCircle aria-hidden="true" />,
          text: t("workflow.github.history.running", { run: runName(run.number) }),
        };
      case "approval":
        return {
          icon: () => <UserCheck aria-hidden="true" />,
          text: t("workflow.github.history.approval", { run: runName(run.number) }),
        };
      case "failed":
        return {
          icon: () => <CircleX aria-hidden="true" />,
          text: t("workflow.github.history.failed", { run: runName(run.number) }),
        };
      case "stopped":
        return {
          icon: () => <Square aria-hidden="true" />,
          text: t("workflow.github.history.stopped", { run: runName(run.number) }),
        };
      default:
        return { icon: () => <CircleCheck aria-hidden="true" />, text: runName(run.number) };
    }
  };
  const outcomeChip = (delivery: WorkflowGitHubDelivery): PickerChip => {
    if (delivery.outcome === "waiting") {
      const run = waitsFor(delivery);
      return {
        icon: () => <Hourglass aria-hidden="true" />,
        text: run
          ? t("workflow.github.history.waitsFor", { run: runName(run.number) })
          : t("workflow.github.history.waiting"),
      };
    }
    if (delivery.outcome === "skipped") {
      const reason = delivery.reason ?? "filter";
      return { icon: SKIP_ICONS[reason], text: t(SKIP_TEXT[reason]) };
    }
    return runChip(delivery.runId);
  };
  const label = (delivery: WorkflowGitHubDelivery) =>
    delivery.item ? `#${delivery.item.number} ${delivery.item.title}` : t("workflow.github.history.offline");
  return { runName, clock, waitsFor, outcomeChip, label };
}

/**
 * The events row at the end of a GitHub trigger: the newest event that GitHub sent, and how many wait.
 * Its menu lists each event with what it did. A run opens on the canvas; a skipped event opens on GitHub.
 */
function EventsRow(props: { id: string; github: WorkflowGitHubCanvas }) {
  const { t, format } = useText();
  const board = useBoard();
  const text = useGitHubHistory(() => props.github);
  const deliveries = () => props.github.history().deliveries.filter((delivery) => delivery.nodeId === props.id);
  const newest = () => deliveries()[0];
  const waiting = () => deliveries().filter((delivery) => delivery.outcome === "waiting");
  const option = (delivery: WorkflowGitHubDelivery) => ({
    value: delivery.id,
    label: text.label(delivery),
    tile: deliveryIcon(delivery),
    chips: [{ text: text.clock(delivery.receivedAt) }, text.outcomeChip(delivery)],
  });
  const groups = (): readonly PickerGroup<string>[] => {
    const of = (outcome: WorkflowGitHubDelivery["outcome"]) =>
      deliveries()
        .filter((delivery) => delivery.outcome === outcome)
        .map(option);
    return [
      { label: t("workflow.github.history.waitingGroup"), options: of("waiting") },
      { label: t("workflow.github.history.startedGroup"), options: of("started") },
      { label: t("workflow.github.history.skippedGroup"), options: of("skipped") },
    ].filter((group) => group.options.length > 0);
  };
  const choose = (id: string) => {
    const delivery = deliveries().find((candidate) => candidate.id === id);
    if (!delivery) return;
    if (delivery.outcome === "started") {
      const run = delivery.runId ? props.github.run(delivery.runId) : undefined;
      if (run) return board.view(run.number);
    }
    if (delivery.outcome === "waiting") {
      const run = text.waitsFor(delivery);
      if (run) return board.view(run.number);
    }
    if (delivery.item) props.github.openItem(delivery.item);
  };
  const shown = () => {
    const delivery = newest();
    return delivery ? text.label(delivery) : t("workflow.github.history.none");
  };
  return (
    <DropdownMenu.Root placement="bottom-start" gutter={6}>
      <DropdownMenu.Trigger
        class="wfn-row"
        aria-label={t("workflow.node.choice", { name: t("workflow.github.history.name"), value: shown() })}
        disabled={deliveries().length === 0}
      >
        <span class="wfn-row-name">{t("workflow.github.history.name")}</span>
        <Show
          when={newest()}
          fallback={
            <span class="wfn-row-value" data-empty="">
              {t("workflow.github.history.none")}
            </span>
          }
        >
          {(delivery) => (
            <span class="wfn-row-value" data-one-line="">
              {deliveryIcon(delivery())()}
              <span class="wfn-row-text">{text.label(delivery())}</span>
              <Show when={waiting().length > 0}>
                <span class="wfn-tag">
                  {t("workflow.github.history.waitingCount", {
                    count: waiting().length,
                    number: format.number(waiting().length),
                  })}
                </span>
              </Show>
            </span>
          )}
        </Show>
        <ChevronDown class="wfn-row-arrow" aria-hidden="true" />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <PickerActions label={t("workflow.github.history.name")} groups={groups()} onSelect={choose} />
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

/* -------------------------------------------------------------- Output */

/** The fields that a GitHub output stores when the user chooses it. The host reads the same names. */
export const GITHUB_OUTPUT_DEFAULTS = { action: "comment" } as const;

type OutputItem = "event" | "input";
type LabelsFrom = "agent" | "list";

/** The settings of a GitHub output, and what the trigger before it gives. */
function useGitHubOutput(id: () => string) {
  const board = useBoard();
  const triggerId = () => board.githubTriggers(id())[0] ?? "";
  const trigger = useGitHubTrigger(triggerId);
  const fromEvent = () => triggerId() !== "";
  const [repository] = useField<string>(id, "repository", "trigger", asString);
  const [item, setItem] = useField<OutputItem>(id, "item", "event", oneOf<OutputItem>(["event", "input"]));
  const [action, setAction] = useField<WorkflowGitHubAction>(
    id,
    "action",
    GITHUB_OUTPUT_DEFAULTS.action,
    oneOf(WORKFLOW_GITHUB_ACTIONS),
  );
  const [labels, setLabels] = useListField(id, "labels", []);
  const [labelsFrom, setLabelsFrom] = useField<LabelsFrom>(
    id,
    "labelsFrom",
    "list",
    oneOf<LabelsFrom>(["agent", "list"]),
  );
  const [person, setPerson] = useField<string>(id, "person", "", asString);
  const [reason, setReason] = useField<WorkflowGitHubCloseReason>(
    id,
    "reason",
    "completed",
    oneOf(WORKFLOW_GITHUB_CLOSE_REASONS),
  );
  const [title, setTitle] = useTextField(id, "title", "");
  /** The repository that the action changes. Empty when it is the trigger's and no GitHub trigger leads here. */
  const target = () => {
    const value = repository();
    return value === "trigger" || !value ? trigger.repository() : value;
  };
  const creates = () => action() === "issue.create";
  /** The action uses the trigger's repository or its item, but no GitHub trigger leads to it. */
  const noEvent = () =>
    !fromEvent() && (repository() === "trigger" || !repository() || (!creates() && item() === "event"));
  /** The event starts on issues only, so actions of pull requests cannot act on it. */
  const issuesOnly = () =>
    fromEvent() && !creates() && item() === "event" && workflowGitHubEventItemKind(trigger.event()) === "issue";
  const pullRequestOnly = () => isPullRequestAction(action()) && issuesOnly();
  /** A new repository keeps none of the labels or people of the old one, in one change. */
  const chooseRepository = (value: string) => board.setFields(id(), { repository: value, labels: "", person: "" });
  return {
    fromEvent,
    triggerEvent: trigger.event,
    repository,
    setRepository: chooseRepository,
    target,
    item,
    setItem,
    action,
    setAction,
    labels,
    setLabels,
    labelsFrom,
    setLabelsFrom,
    person,
    setPerson,
    reason,
    setReason,
    title,
    setTitle,
    creates,
    noEvent,
    pullRequestOnly,
    issuesOnly,
  };
}

/** Whether a GitHub output can run alone: GitHub is connected, and it can change the repository. */
export function useGitHubOutputReady(id: () => string) {
  const board = useBoard();
  const fields = useGitHubOutput(id);
  return () => {
    const github = board.github();
    if (!github?.catalog()?.connected || !fields.target()) return false;
    const problem = accessProblem(github, fields.target(), { write: true, events: false });
    return problem === undefined && !fields.noEvent() && !fields.pullRequestOnly();
  };
}

export function GitHubOutputRows(props: { id: string; locked: boolean }) {
  const { t } = useText();
  const board = useBoard();
  const fields = useGitHubOutput(() => props.id);
  const repositoryChoices = useRepositoryChoices();
  const options = useRepositoryOptions(fields.target);
  const actionLabel = (action: WorkflowGitHubAction) => t(ACTION_LABEL[action]);
  const isLabels = () => fields.action() === "label.add" || fields.action() === "label.remove" || fields.creates();
  const isPerson = () => fields.action() === "assign" || fields.action() === "review.request";
  /** The reason "not planned" exists only on issues. */
  const hasReason = () =>
    fields.action() === "close" &&
    !(
      fields.fromEvent() &&
      fields.item() === "event" &&
      workflowGitHubEventItemKind(fields.triggerEvent()) === "pullRequest"
    );
  const repositories = (): Choice<string>[] => {
    const own = repositoryChoices(fields.repository());
    return fields.fromEvent() || fields.repository() === "trigger"
      ? [
          {
            value: "trigger",
            label: t("workflow.github.output.sameRepository"),
            icon: () => <Zap aria-hidden="true" />,
          },
          ...own,
        ]
      : own;
  };
  const items = (): Choice<OutputItem>[] => [
    ...(fields.fromEvent() || fields.item() === "event"
      ? [{ value: "event" as const, label: t("workflow.github.output.sameItem"), icon: () => <GitHubIcon /> }]
      : []),
    { value: "input", label: t("workflow.github.output.numberInInput"), icon: () => <Hash aria-hidden="true" /> },
  ];
  const actions = (): Choice<WorkflowGitHubAction>[] =>
    WORKFLOW_GITHUB_ACTIONS.filter(
      (action) => action === fields.action() || !(fields.issuesOnly() && isPullRequestAction(action)),
    ).map((action) => ({ value: action, label: actionLabel(action), icon: ACTION_ICONS[action] }));
  const people = (): Choice<string>[] => [
    { value: "agent", label: t("workflow.row.agentChooses"), icon: () => <Bot aria-hidden="true" /> },
    ...withValues(options.people(), fields.person() && fields.person() !== "agent" ? [fields.person()] : []).map(
      (login) => ({ value: login, label: `@${login}`, icon: () => <UserPlus aria-hidden="true" /> }),
    ),
  ];
  const reasons = (): Choice<WorkflowGitHubCloseReason>[] => [
    {
      value: "completed",
      label: t("workflow.github.output.reason.completed"),
      icon: () => <CircleCheck aria-hidden="true" />,
    },
    {
      value: "notPlanned",
      label: t("workflow.github.output.reason.notPlanned"),
      icon: () => <CircleX aria-hidden="true" />,
    },
  ];
  const labelsAgent = () => ({
    on: fields.labelsFrom() === "agent",
    onChange: (on: boolean) => fields.setLabelsFrom(on ? "agent" : "list"),
  });
  return (
    <Connected>
      <SettingRow
        name={t("workflow.github.repository")}
        value={fields.repository() || "trigger"}
        placeholder={t("workflow.github.chooseRepository")}
        search={t("workflow.github.searchRepositories")}
        choices={repositories()}
        disabled={props.locked}
        onChange={fields.setRepository}
      />
      <Show when={!fields.creates()}>
        <SettingRow
          name={t("workflow.github.output.on")}
          value={fields.item()}
          choices={items()}
          disabled={props.locked}
          onChange={fields.setItem}
        />
      </Show>
      <SettingRow
        name={t("workflow.github.output.action")}
        value={fields.action()}
        choices={actions()}
        disabled={props.locked}
        onChange={fields.setAction}
      />
      <Show when={fields.creates()}>
        <InputRow
          name={t("workflow.github.output.title")}
          value={fields.title()}
          placeholder={t("workflow.github.output.titlePlaceholder")}
          disabled={props.locked}
          onChange={fields.setTitle}
        />
      </Show>
      <Show when={isLabels()}>
        <SettingListRow
          name={t("workflow.github.output.labels")}
          empty={t("workflow.github.output.none")}
          options={withValues(options.labels(), fields.labels())}
          tone={options.tone}
          values={fields.labels()}
          loading={options.loading()}
          disabled={props.locked}
          onChange={fields.setLabels}
          agent={labelsAgent()}
        />
      </Show>
      <Show when={isPerson()}>
        <SettingRow
          name={t("workflow.github.output.person")}
          value={fields.person()}
          placeholder={t("workflow.github.output.choosePerson")}
          choices={people()}
          loading={options.loading()}
          disabled={props.locked}
          onChange={fields.setPerson}
        />
      </Show>
      <Show when={hasReason()}>
        <SettingRow
          name={t("workflow.github.output.reason")}
          value={fields.reason()}
          choices={reasons()}
          disabled={props.locked}
          onChange={fields.setReason}
        />
      </Show>
      <Show when={fields.noEvent()}>
        <Warning>{t("workflow.github.alert.noEvent")}</Warning>
      </Show>
      <Show when={fields.pullRequestOnly()}>
        <Warning>{t("workflow.github.alert.pullRequestOnly", { action: actionLabel(fields.action()) })}</Warning>
      </Show>
      <Show when={board.github()}>
        {(github) => <AccessAlerts github={github()} repository={fields.target()} write events={false} />}
      </Show>
    </Connected>
  );
}
