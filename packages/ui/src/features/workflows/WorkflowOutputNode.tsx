/** An output: the end of a branch, which sends the result. */

import type { AppTranslate } from "@openbot/i18n";
import { Bell, Button, CircleCheck, FileText, Hash, Input, Play, Send, Skeleton } from "@openbot/ui";
import { Show, untrack } from "solid-js";
import { useText } from "../../text";
import { resultValue, useBoard, type WfnPortType } from "./workflow-board";
import {
  type Choice,
  ChoicePill,
  FailureAlert,
  Field,
  NodeShell,
  NodeToolbar,
  oneOf,
  PlacePill,
  useField,
  useLocked,
  usePlace,
  useStepRun,
  useTextField,
} from "./workflow-node-parts";

type OutputTarget = "channel" | "file" | "notify";

const TARGETS = (t: AppTranslate): readonly Choice<OutputTarget>[] => [
  { value: "channel", label: t("workflow.node.place.channel"), icon: () => <Hash aria-hidden="true" /> },
  { value: "file", label: t("workflow.output.target.file"), icon: () => <FileText aria-hidden="true" /> },
  { value: "notify", label: t("workflow.output.target.notify"), icon: () => <Bell aria-hidden="true" /> },
];

const TARGET_TYPES: readonly OutputTarget[] = ["channel", "file", "notify"];

const OUTPUT_INPUTS: readonly WfnPortType[] = ["text", "image", "file"];

/** The end of a branch: it posts the result to a channel, saves it to a file, or notifies the user. */
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
  const place = usePlace(
    () => props.id,
    untrack(() => ({ connectionId: props.connectionId, placeId: props.placeId })),
  );
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
  const shown = () => resultValue(board.shown(props.id));
  return (
    <NodeShell
      action={
        <Button
          class="wfn-run"
          fullWidth
          loading={run.running()}
          loadingLabel={t("workflow.node.running")}
          disabled={locked() || !OUTPUT_INPUTS.some((type) => board.connected(props.id, "in", type))}
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
      inputs={OUTPUT_INPUTS}
      requires
      toolbar={<NodeToolbar id={props.id} name={t("workflow.output.name")} locked={locked()} onLock={setLocked} />}
    >
      <Field class="wfn-block-field">
        <Show when={target() === "channel"}>
          <PlacePill
            name={t("workflow.node.place.channel")}
            connectionId={place.connectionId()}
            placeId={place.placeId()}
            disabled={locked()}
            onChange={place.set}
          />
        </Show>
        <Show when={target() === "file"}>
          <Input
            class="wfn-input"
            aria-label={t("workflow.output.path")}
            readonly={locked()}
            value={path()}
            onValueChange={setPath}
          />
        </Show>
        <Show when={target() === "notify"}>
          <Input
            class="wfn-input"
            aria-label={t("workflow.output.notifyTitle")}
            readonly={locked()}
            value={title()}
            onValueChange={setTitle}
          />
        </Show>
        <div class="wfn-field-foot">
          <ChoicePill
            name={t("workflow.output.sendTo")}
            value={target()}
            choices={TARGETS(t).filter(
              (choice) => choice.value === target() || (board.features()?.outputs.includes(choice.value) ?? true),
            )}
            disabled={locked()}
            onChange={setTarget}
          />
        </div>
      </Field>
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
