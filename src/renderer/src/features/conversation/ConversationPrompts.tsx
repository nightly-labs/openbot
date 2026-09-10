import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import type { AgentApproval, BrowserPreview, BrowserTab } from "@openbot/contracts/ipc";
import { createMemo, createSignal, For, Show } from "solid-js";
import { Badge, Button, Check, Input, LoaderCircle, Monitor, RadioGroup, Skeleton, X } from "../../components/ui";

export function ChoiceCard(props: {
  title: string;
  hint?: string;
  choices: string[];
  customChoice?: string;
  pending?: boolean;
  onSubmit: (answer: string) => Promise<boolean>;
}) {
  const [answer, setAnswer] = createSignal("");
  const [customSelected, setCustomSelected] = createSignal(false);
  let customInput: HTMLInputElement | undefined;
  const selectedChoice = () => (customSelected() ? (props.customChoice ?? "") : answer());
  const submit = async () => {
    const value = answer().trim();
    if (value && !props.pending) await props.onSubmit(value);
  };
  return (
    <div class="choice-card conversation-interaction-card" aria-busy={props.pending ? "true" : undefined}>
      <header class="conversation-interaction-header">
        <strong>{props.title}</strong>
        <Badge variant="warning-light" class="conversation-interaction-status" role="status">
          <LoaderCircle data-icon="inline-start" aria-hidden="true" />
          {props.pending ? "Sending…" : "Input required"}
        </Badge>
      </header>
      <p class="choice-card-hint">{props.hint ?? "Pick whatever fits, or type your own."}</p>
      <RadioGroup.Root
        class="choice-options"
        aria-label={props.title}
        value={selectedChoice()}
        disabled={props.pending}
        onChange={(choice) => {
          if (choice === props.customChoice) {
            setAnswer("");
            setCustomSelected(true);
            queueMicrotask(() => customInput?.focus());
            return;
          }
          setCustomSelected(false);
          setAnswer(choice);
          void props.onSubmit(choice);
        }}
      >
        <For each={props.choices}>
          {(choice, index) => (
            <RadioGroup.Item class="choice-option-item" value={choice} disabled={props.pending}>
              <RadioGroup.ItemInput aria-label={choice} />
              <RadioGroup.ItemControl
                class={[
                  "choice-option",
                  {
                    "choice-option-selected": choice === props.customChoice ? customSelected() : answer() === choice,
                  },
                ]}
              >
                <span class="choice-key">{String.fromCharCode(65 + index())}</span>
                <span>{choice}</span>
              </RadioGroup.ItemControl>
            </RadioGroup.Item>
          )}
        </For>
      </RadioGroup.Root>
      <Input
        ref={(element) => (customInput = element)}
        class="choice-input"
        value={answer()}
        placeholder="Type your own answer"
        aria-label="Custom answer"
        maxlength={INPUT_LIMITS.promptAnswerText}
        disabled={props.pending}
        onValueChange={(value) => {
          setCustomSelected(true);
          setAnswer(value);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") void submit();
        }}
      />
    </div>
  );
}

export function ApprovalCard(props: {
  approval: AgentApproval;
  onApprove: () => Promise<boolean>;
  onReject: () => Promise<boolean>;
}) {
  const [submitting, setSubmitting] = createSignal(false);
  const submit = async (decision: "accept" | "decline") => {
    if (submitting()) return;
    setSubmitting(true);
    const completed = await (decision === "accept" ? props.onApprove() : props.onReject());
    if (!completed) setSubmitting(false);
  };

  return (
    <section
      class="approval-card conversation-interaction-card"
      aria-label="Agent approval"
      aria-busy={submitting() ? "true" : undefined}
    >
      <header class="approval-card-header conversation-interaction-header">
        <strong>{approvalTitle(props.approval)}</strong>
        <Badge variant="warning-light" class="conversation-interaction-status" role="status">
          <LoaderCircle data-icon="inline-start" aria-hidden="true" />
          Approval
        </Badge>
      </header>
      <Show when={props.approval.reason}>{(reason) => <p class="approval-reason">{reason()}</p>}</Show>
      <div class="approval-card-content">
        <Show when={props.approval.command}>
          {(command) => (
            <div class="approval-command-block">
              <Show when={props.approval.cwd}>
                <div class="approval-cwd">{props.approval.cwd}</div>
              </Show>
              <code>{command()}</code>
            </div>
          )}
        </Show>
        <Show when={props.approval.kind === "file-change"}>
          <div class="approval-detail-row">
            <span class="approval-detail-label">Files</span>
            <strong>{props.approval.grantRoot ?? "Agent workspace"}</strong>
          </div>
        </Show>
        <Show when={props.approval.kind === "permissions"}>
          <PermissionDetails permissions={props.approval.permissions} />
        </Show>
      </div>
      <footer class="approval-card-footer">
        <Button
          variant="default"
          type="button"
          class="approval-button"
          disabled={submitting()}
          onClick={() => void submit("accept")}
        >
          {submitting() ? "Sending…" : "Allow"}
        </Button>
        <Button
          variant="secondary"
          type="button"
          class="approval-button"
          disabled={submitting()}
          onClick={() => void submit("decline")}
        >
          {submitting() ? "Waiting…" : "Deny"}
        </Button>
      </footer>
    </section>
  );
}

export function BrowserTakeoverCard(props: {
  agentName: string;
  tab: BrowserTab | undefined;
  preview: BrowserPreview | null;
  previewStatus: "idle" | "loading" | "ready" | "failed";
  decision?: "complete" | "cancel" | null;
  onComplete: () => Promise<boolean>;
  onCancel: () => Promise<boolean>;
}) {
  const [submitting, setSubmitting] = createSignal<"complete" | "cancel" | null>(null);
  const pageDetails = createMemo(() => browserPageDetails(props.tab));
  const completed = () => props.decision === "complete";
  const cancelled = () => props.decision === "cancel";
  const accessibleLabel = () =>
    completed() ? "Browser takeover complete" : cancelled() ? "Browser takeover cancelled" : "Browser takeover";
  const submit = async (decision: "complete" | "cancel") => {
    if (submitting() || props.decision) return;
    setSubmitting(decision);
    const completed = await (decision === "complete" ? props.onComplete() : props.onCancel());
    if (!completed) setSubmitting(null);
  };

  return (
    <section
      class="browser-takeover-card conversation-interaction-card"
      data-decision={props.decision ?? undefined}
      aria-label={accessibleLabel()}
      aria-busy={submitting() ? "true" : undefined}
    >
      <header class="browser-takeover-header conversation-interaction-header">
        <h2>
          {completed()
            ? `Step completed on ${pageDetails().host}`
            : cancelled()
              ? `Step cancelled on ${pageDetails().host}`
              : `Complete the step on ${pageDetails().host}`}
        </h2>
        <Show
          when={!props.decision}
          fallback={
            <Badge
              variant={completed() ? "success-light" : "secondary"}
              class="conversation-interaction-status"
              role="status"
            >
              <Show when={completed()} fallback={<X data-icon="inline-start" aria-hidden="true" />}>
                <Check data-icon="inline-start" aria-hidden="true" />
              </Show>
              {completed() ? "Done" : "Cancelled"}
            </Badge>
          }
        >
          <Badge variant="warning-light" class="conversation-interaction-status" role="status">
            <LoaderCircle data-icon="inline-start" aria-hidden="true" />
            Action required
          </Badge>
        </Show>
      </header>
      <div class="browser-takeover-copy">
        <p>
          {completed()
            ? `${props.agentName} is continuing.`
            : cancelled()
              ? "The browser step was cancelled."
              : `Finish the sign-in, verification, or consent in the open browser. Then let ${props.agentName} continue.`}
        </p>
      </div>

      <figure class="browser-takeover-preview">
        <figcaption class="browser-takeover-preview-bar">
          <Monitor aria-hidden="true" />
          <span title={pageDetails().title}>{pageDetails().title}</span>
          <small title={pageDetails().host}>{pageDetails().host}</small>
        </figcaption>
        <div class="browser-takeover-preview-viewport">
          <Show
            when={props.previewStatus === "ready" ? props.preview : null}
            fallback={
              <Show
                when={props.previewStatus === "loading" || props.previewStatus === "idle"}
                fallback={
                  <div class="browser-takeover-preview-fallback">
                    <Monitor aria-hidden="true" />
                    <strong>{pageDetails().title}</strong>
                    <span>{pageDetails().host}</span>
                  </div>
                }
              >
                <Skeleton class="browser-takeover-preview-skeleton" />
              </Show>
            }
          >
            {(preview) => (
              <img
                src={preview().dataUrl}
                width={preview().width}
                height={preview().height}
                alt={`Preview of ${pageDetails().title}`}
              />
            )}
          </Show>
        </div>
      </figure>

      <Show when={!props.decision}>
        <footer class="browser-takeover-actions">
          <Button
            variant="default"
            size="sm"
            type="button"
            class="approval-button"
            loading={submitting() === "complete"}
            loadingLabel="Returning…"
            disabled={Boolean(submitting())}
            onClick={() => void submit("complete")}
          >
            I’m done
          </Button>
          <Button
            variant="secondary"
            size="sm"
            type="button"
            class="approval-button"
            loading={submitting() === "cancel"}
            loadingLabel="Cancelling…"
            disabled={Boolean(submitting())}
            onClick={() => void submit("cancel")}
          >
            Cancel
          </Button>
        </footer>
      </Show>
    </section>
  );
}

function browserPageDetails(tab: BrowserTab | undefined): { title: string; host: string } {
  const title = tab?.title.trim() || "Browser page";
  if (!tab?.url) return { title, host: "the browser" };
  try {
    return { title, host: new URL(tab.url).hostname || "the browser" };
  } catch {
    return { title, host: tab.url };
  }
}

function approvalTitle(approval: AgentApproval | undefined) {
  if (approval?.kind === "command") return "Run a command";
  if (approval?.kind === "file-change") return "Change files";
  return "Grant permissions";
}

function PermissionDetails(props: { permissions: AgentApproval["permissions"] }) {
  const details = createMemo(() => {
    const permissions = props.permissions;
    if (!permissions) return [];
    return [
      ...(permissions.network ? ["Network access"] : []),
      ...permissions.fileSystem.read.map((path) => `Read ${path}`),
      ...permissions.fileSystem.write.map((path) => `Write ${path}`),
    ];
  });
  return (
    <section class="approval-permissions" aria-label="Requested permissions">
      <For each={details()}>{(detail) => <span>{detail}</span>}</For>
    </section>
  );
}
