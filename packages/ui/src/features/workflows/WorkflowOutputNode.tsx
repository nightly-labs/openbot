import type { AppTranslate } from "@openbot/i18n";
import { Bell, Button, CircleCheck, FileText, Hash, Play, Send, Skeleton, Textarea } from "@openbot/ui";
import { Show, untrack } from "solid-js";
import { useText } from "../../text";
import { AnswerProblems } from "./workflow-answer-parts";
import { resultValue, useBoard, type WfnPortType } from "./workflow-board";
import { DISCORD_OUTPUT_DEFAULTS, DiscordIcon, DiscordOutputRows } from "./workflow-discord-parts";
import { GITHUB_OUTPUT_DEFAULTS, GitHubIcon, GitHubOutputRows, useGitHubOutputReady } from "./workflow-github-parts";
import {
  type Choice,
  FailureAlert,
  Field,
  NodeShell,
  NodeToolbar,
  oneOf,
  useField,
  useLocked,
  useStepRun,
  useTextField,
} from "./workflow-node-parts";
import { InputRow, OutputChannelRow, SettingRow, SettingRows, SettingsFoot, StaticRow } from "./workflow-setting-rows";
import { SLACK_OUTPUT_DEFAULTS, SlackIcon, SlackOutputRows } from "./workflow-slack-parts";
import { TELEGRAM_OUTPUT_DEFAULTS, TelegramIcon, TelegramOutputRows } from "./workflow-telegram-parts";

type OutputTarget = "channel" | "file" | "notify" | "github" | "discord" | "telegram" | "slack" | "chat-channel";

const TARGETS = (t: AppTranslate): readonly Choice<OutputTarget>[] => [
  { value: "channel", label: t("workflow.node.place.channel"), icon: () => <Hash aria-hidden="true" /> },
  { value: "file", label: t("workflow.output.target.file"), icon: () => <FileText aria-hidden="true" /> },
  { value: "notify", label: t("workflow.output.target.notify"), icon: () => <Bell aria-hidden="true" /> },
  { value: "github", label: t("workflow.output.target.github"), icon: () => <GitHubIcon /> },
  { value: "discord", label: t("workflow.output.target.discord"), icon: () => <DiscordIcon /> },
  { value: "telegram", label: t("workflow.output.target.telegram"), icon: () => <TelegramIcon /> },
  { value: "slack", label: t("workflow.output.target.slack"), icon: () => <SlackIcon /> },
];

const TARGET_TYPES: readonly OutputTarget[] = [
  "channel",
  "file",
  "notify",
  "github",
  "discord",
  "telegram",
  "slack",
  "chat-channel",
];

const HOST_TARGETS: readonly OutputTarget[] = ["github", "discord", "telegram", "slack"];

const TARGET_DEFAULTS: Partial<Record<OutputTarget, Record<string, string>>> = {
  github: GITHUB_OUTPUT_DEFAULTS,
  discord: DISCORD_OUTPUT_DEFAULTS,
  telegram: TELEGRAM_OUTPUT_DEFAULTS,
  slack: SLACK_OUTPUT_DEFAULTS,
};

const TEXT_ACTIONS: ReadonlySet<string> = new Set(["comment", "review.changes", "issue.create", "reply", "post"]);

const MESSAGE_FORMAT = 2;

const textAction = (action: unknown) => typeof action === "string" && TEXT_ACTIONS.has(action);

const OUTPUT_INPUTS: readonly WfnPortType[] = ["text", "image", "file"];

const TEXT_INPUTS: readonly WfnPortType[] = ["text"];

export function OutputNode(props: {
  id: string;
  target?: OutputTarget;
  connectionId?: string;
  placeId?: string;
  path?: string;
  title?: string;
}) {
  const board = useBoard();
  const { t } = useText();
  const [target, setTarget] = useField<OutputTarget>(
    () => props.id,
    "target",
    untrack(() => props.target ?? "channel"),
    oneOf(TARGET_TYPES),
  );
  const isChannel = () => target() === "channel" || target() === "chat-channel";
  const chooseTarget = (value: OutputTarget) => {
    if (value === "channel" && isChannel()) return;
    const channels = board.catalogs().channels ?? [];
    const stored = board.field(props.id, "channelId");
    const channel = channels.some((entry) => entry.id === stored) ? stored : channels[0]?.id;
    if (value === "channel" && board.catalogs().places.length === 0 && channel !== undefined)
      return board.setFields(props.id, { target: "chat-channel", channelId: channel });
    const defaults = TARGET_DEFAULTS[value];
    const fromOther = target() !== value && HOST_TARGETS.includes(target());
    if (!defaults || (board.field(props.id, "action") !== undefined && !fromOther)) return setTarget(value);
    board.setFields(props.id, { target: value, ...defaults });
  };
  const offered = (value: OutputTarget) => {
    const outputs = board.features()?.outputs;
    if (value === target()) return true;
    if (value === "channel" && (isChannel() || outputs?.includes("chat-channel"))) return true;
    return HOST_TARGETS.includes(value) ? outputs?.includes(value) === true : (outputs?.includes(value) ?? true);
  };
  const [path, setPath] = useTextField(
    () => props.id,
    "path",
    untrack(() => props.path ?? ""),
  );
  const [title, setTitle] = useTextField(
    () => props.id,
    "title",
    untrack(() => props.title ?? ""),
  );
  const [message, setMessage] = useTextField(() => props.id, "message", "");
  const sendsText = () =>
    target() !== "file" && (!HOST_TARGETS.includes(target()) || textAction(board.field(props.id, "action")));
  const messageShown = () => sendsText() && (message() !== "" || (board.features()?.format ?? 1) >= MESSAGE_FORMAT);
  const [locked, setLocked] = useLocked(() => props.id);
  const run = useStepRun(untrack(() => props.id));
  const githubReady = useGitHubOutputReady(() => props.id);
  const isGitHub = () => target() === "github";
  const inputs = () => (HOST_TARGETS.includes(target()) ? TEXT_INPUTS : OUTPUT_INPUTS);
  const runDisabled = () =>
    locked() || !inputs().some((type) => board.connected(props.id, "in", type)) || (isGitHub() && !githubReady());
  const shown = () => resultValue(board.shown(props.id));
  return (
    <NodeShell
      action={
        <Button
          class="wfn-run"
          fullWidth
          loading={run.running()}
          loadingLabel={t("workflow.node.running")}
          disabled={runDisabled()}
          onClick={run.start}
        >
          {t("workflow.node.run")}
          <Play aria-hidden="true" />
        </Button>
      }
      id={props.id}
      label={t("workflow.output.title")}
      icon={<Send aria-hidden="true" />}
      kind="output"
      inputs={inputs()}
      requires
      style={{ "--wfn-width": "320px" }}
      toolbar={<NodeToolbar id={props.id} name={t("workflow.output.name")} locked={locked()} onLock={setLocked} />}
    >
      <SettingRows
        head={
          <SettingRow
            name={t("workflow.output.sendTo")}
            value={isChannel() ? "channel" : target()}
            choices={TARGETS(t).filter((choice) => offered(choice.value))}
            disabled={locked()}
            onChange={chooseTarget}
          />
        }
      >
        <Show when={isChannel()}>
          <OutputChannelRow
            id={props.id}
            openbot={target() === "chat-channel"}
            connectionId={untrack(() => props.connectionId)}
            placeId={untrack(() => props.placeId)}
            disabled={locked()}
          />
        </Show>
        <Show when={target() === "chat-channel"}>
          <SettingsFoot>
            <StaticRow name={t("workflow.output.postsAs")}>
              <span class="wfn-row-text">{t("workflow.output.postsAsNote")}</span>
            </StaticRow>
          </SettingsFoot>
        </Show>
        <Show when={target() === "file"}>
          <InputRow name={t("workflow.output.path")} value={path()} disabled={locked()} onChange={setPath} />
        </Show>
        <Show when={target() === "notify"}>
          <InputRow
            name={t("workflow.output.notifyTitleRow")}
            value={title()}
            disabled={locked()}
            onChange={setTitle}
          />
        </Show>
        <Show when={isGitHub()}>
          <GitHubOutputRows id={props.id} locked={locked()} />
        </Show>
        <Show when={target() === "discord"}>
          <DiscordOutputRows id={props.id} locked={locked()} />
        </Show>
        <Show when={target() === "telegram"}>
          <TelegramOutputRows id={props.id} locked={locked()} />
        </Show>
        <Show when={target() === "slack"}>
          <SlackOutputRows id={props.id} locked={locked()} />
        </Show>
      </SettingRows>
      <Show when={messageShown()}>
        <Field class="wfn-block-field">
          <Textarea
            class="wfn-input"
            aria-label={t("workflow.output.message")}
            placeholder={t("workflow.output.messagePlaceholder")}
            readonly={locked()}
            value={message()}
            onValueChange={setMessage}
          />
        </Field>
      </Show>
      <AnswerProblems id={props.id} />
      <Show
        when={shown()}
        fallback={
          <Show when={run.running()} fallback={<FailureAlert id={props.id} running={false} />}>
            <div class="wfn-alert" data-pending aria-hidden="true">
              <Skeleton />
            </div>
          </Show>
        }
      >
        {(value) => (
          <p class="wfn-alert" data-tone="success" data-stale={run.running() ? "" : undefined}>
            <CircleCheck aria-hidden="true" />
            <span class="wfn-alert-text">{value()}</span>
          </p>
        )}
      </Show>
    </NodeShell>
  );
}
