import { Button, Check, CircleCheck, UserCheck, X } from "@openbot/ui";
import { createSignal, Show, untrack } from "solid-js";
import { useText } from "../../text";
import { AnswerProblems } from "./workflow-answer-parts";
import { useBoard } from "./workflow-board";
import { NameTextarea } from "./workflow-name-textarea";
import { Field, NodeShell, NodeToolbar, useLocked, useTextField } from "./workflow-node-parts";

interface Answer {
  kind: "approved" | "rejected";
  at: Date;
  step: string | undefined;
}

export function ApprovalNode(props: { id: string; question?: string }) {
  const board = useBoard();
  const { t, format } = useText();
  const [question, setQuestion] = useTextField(
    () => props.id,
    "question",
    untrack(() => props.question ?? ""),
  );
  const [answer, setAnswer] = createSignal<Answer>();
  const decision = () => {
    const current = answer();
    return current && current.step === board.step(props.id) ? current : undefined;
  };
  const approvedText = (at: Date) =>
    t("workflow.approval.approvedAt", { time: format.date(at, { hour: "2-digit", minute: "2-digit" }) });
  const [locked, setLocked] = useLocked(() => props.id);
  const waiting = () => board.status(props.id) === "approval" && decision() === undefined;
  const decide = (approved: boolean) => {
    const sent: Answer = { kind: approved ? "approved" : "rejected", at: new Date(), step: board.step(props.id) };
    setAnswer(sent);
    if (approved) board.record(props.id, approvedText(sent.at));
    Promise.resolve(board.decide(props.id, approved)).catch(() => {
      if (answer() === sent) setAnswer(undefined);
    });
  };
  return (
    <NodeShell
      id={props.id}
      label={t("workflow.approval.title")}
      icon={<UserCheck aria-hidden="true" />}
      kind="approval"
      inputs={["text"]}
      output="text"
      requires
      toolbar={<NodeToolbar id={props.id} name={t("workflow.approval.name")} locked={locked()} onLock={setLocked} />}
    >
      <Field class="wfn-block-field">
        <NameTextarea
          node={props.id}
          class="wfn-input"
          aria-label={t("workflow.approval.question")}
          placeholder={t("workflow.approval.questionPlaceholder")}
          readonly={locked()}
          value={question()}
          onValueChange={setQuestion}
        />
      </Field>
      <AnswerProblems id={props.id} />
      <Show when={waiting()}>
        <div class="wfn-block-actions">
          <Button size="sm" onClick={() => decide(true)}>
            <Check aria-hidden="true" />
            {t("workflow.approval.approve")}
          </Button>
          <Button variant="outline" size="sm" onClick={() => decide(false)}>
            <X aria-hidden="true" />
            {t("workflow.approval.reject")}
          </Button>
        </div>
      </Show>
      <Show when={decision()?.kind === "rejected"}>
        <p class="wfn-alert" data-tone="danger">
          <X aria-hidden="true" />
          <span class="wfn-alert-text">{t("workflow.approval.rejected")}</span>
        </p>
      </Show>
      <Show when={decision()?.kind === "approved" ? decision()?.at : undefined}>
        {(at) => (
          <p class="wfn-alert" data-tone="success">
            <CircleCheck aria-hidden="true" />
            <span class="wfn-alert-text">{approvedText(at())}</span>
          </p>
        )}
      </Show>
    </NodeShell>
  );
}
