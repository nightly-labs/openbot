/** An output: the end of a branch, which sends the result. */

import type { AppTranslate } from "@openbot/i18n";
import { Bell, Button, CircleCheck, FileText, Hash, Play, Send, Skeleton } from "@openbot/ui";
import { Show, untrack } from "solid-js";
import { useText } from "../../text";
import { resultValue, useBoard, type WfnPortType } from "./workflow-board";
import { DISCORD_OUTPUT_DEFAULTS, DiscordIcon, DiscordOutputRows } from "./workflow-discord-parts";
import { GITHUB_OUTPUT_DEFAULTS, GitHubIcon, GitHubOutputRows, useGitHubOutputReady } from "./workflow-github-parts";
import {
  type Choice,
  FailureAlert,
  NodeShell,
  NodeToolbar,
  oneOf,
  useField,
  useLocked,
  useStepRun,
  useTextField,
} from "./workflow-node-parts";
import { InputRow, PlaceRow, SettingRow, SettingRows } from "./workflow-setting-rows";
import { SLACK_OUTPUT_DEFAULTS, SlackIcon, SlackOutputRows } from "./workflow-slack-parts";
import { TELEGRAM_OUTPUT_DEFAULTS, TelegramIcon, TelegramOutputRows } from "./workflow-telegram-parts";

type OutputTarget = "channel" | "file" | "notify" | "github" | "discord" | "telegram" | "slack";

const TARGETS = (t: AppTranslate): readonly Choice<OutputTarget>[] => [
  { value: "channel", label: t("workflow.node.place.channel"), icon: () => <Hash aria-hidden="true" /> },
  { value: "file", label: t("workflow.output.target.file"), icon: () => <FileText aria-hidden="true" /> },
  { value: "notify", label: t("workflow.output.target.notify"), icon: () => <Bell aria-hidden="true" /> },
  { value: "github", label: t("workflow.output.target.github"), icon: () => <GitHubIcon /> },
  { value: "discord", label: t("workflow.output.target.discord"), icon: () => <DiscordIcon /> },
  { value: "telegram", label: t("workflow.output.target.telegram"), icon: () => <TelegramIcon /> },
  { value: "slack", label: t("workflow.output.target.slack"), icon: () => <SlackIcon /> },
];

const TARGET_TYPES: readonly OutputTarget[] = ["channel", "file", "notify", "github", "discord", "telegram", "slack"];

/** Targets that only an admin's host offers: they act as the host's GitHub App or messaging bot. */
const HOST_TARGETS: readonly OutputTarget[] = ["github", "discord", "telegram", "slack"];

const TARGET_DEFAULTS: Partial<Record<OutputTarget, Record<string, string>>> = {
  github: GITHUB_OUTPUT_DEFAULTS,
  discord: DISCORD_OUTPUT_DEFAULTS,
  telegram: TELEGRAM_OUTPUT_DEFAULTS,
  slack: SLACK_OUTPUT_DEFAULTS,
};

const OUTPUT_INPUTS: readonly WfnPortType[] = ["text", "image", "file"];

/** A change on GitHub, Discord, Telegram or Slack is text: a comment, a review, the body of an issue, or a message. */
const TEXT_INPUTS: readonly WfnPortType[] = ["text"];

/**
 * The end of a branch: it posts the result to a channel, saves it to a file, notifies the user, or makes
 * one change on GitHub. The target is the first row of the card, and the settings of that target follow it.
 */
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
  /**
   * A new GitHub, Discord, Telegram or Slack output stores the fields that its rows show, so the host reads the
   * same. Each keeps an `action`, so a change from one to another writes the defaults again.
   */
  const chooseTarget = (value: OutputTarget) => {
    const defaults = TARGET_DEFAULTS[value];
    const fromOther = target() !== value && HOST_TARGETS.includes(target());
    if (!defaults || (board.field(props.id, "action") !== undefined && !fromOther)) return setTarget(value);
    board.setFields(props.id, { target: value, ...defaults });
  };
  /** GitHub, Discord, Telegram and Slack need a host that can run them. Other targets show unless the host lists the targets it runs. */
  const offered = (value: OutputTarget) => {
    const outputs = board.features()?.outputs;
    if (value === target()) return true;
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
            value={target()}
            choices={TARGETS(t).filter((choice) => offered(choice.value))}
            disabled={locked()}
            onChange={chooseTarget}
          />
        }
      >
        <Show when={target() === "channel"}>
          <PlaceRow
            id={props.id}
            connectionId={untrack(() => props.connectionId)}
            placeId={untrack(() => props.placeId)}
            disabled={locked()}
          />
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
