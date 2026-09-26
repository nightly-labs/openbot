import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import type {
  AgentApproval,
  BrowserPreview,
  BrowserTab,
  BrowserTakeoverRequest,
  RespondToBrowserSecretInput,
} from "@openbot/contracts/ipc";
import { Badge, Button, Check, Input, LoaderCircle, Maximize2, Monitor, RadioGroup, toast, X } from "@openbot/ui";
import { StandingApprovalConfirmation } from "@openbot/ui/components/StandingApprovalConfirmation";
import { BrowserSecretCard } from "@openbot/ui/features/conversation/BrowserSecretCard";
import { BrowserTakeoverPreview } from "@openbot/ui/features/conversation/BrowserTakeoverPreview";
import { type TextValue, useText } from "@openbot/ui/text";
import { createMemo, createSignal, For, Show } from "solid-js";

export function ChoiceCard(props: {
  title: string;
  hint?: string;
  choices: string[];
  customChoice?: string;
  pending?: boolean;
  onSubmit: (answer: string) => Promise<boolean>;
}) {
  const { t } = useText();
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
          <LoaderCircle class="conversation-interaction-spinner" data-icon="inline-start" aria-hidden="true" />
          {props.pending ? t("common.sending") : t("prompt.inputRequired")}
        </Badge>
      </header>
      <p class="choice-card-hint">{props.hint ?? t("prompt.choice.hint")}</p>
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
        placeholder={t("prompt.customPlaceholder")}
        aria-label={t("prompt.choice.customLabel")}
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
  /**
   * Grants this agent a standing approval, then accepts the request in hand. Absent where the grant
   * cannot be given: a `permissions` request, or an agent on a remote server whose own computer
   * owns that choice. The card then reads exactly as it did before this option existed.
   */
  onAlwaysAllow?: () => Promise<boolean>;
  /** The agent this grant would cover, for the confirmation the grant deserves. */
  agentName?: string;
}) {
  const { t, errorMessage } = useText();
  const [submitting, setSubmitting] = createSignal(false);
  const [confirmingAlways, setConfirmingAlways] = createSignal(false);
  let alwaysAllowButton: HTMLButtonElement | undefined;
  const submit = async (decision: "accept" | "decline") => {
    if (submitting()) return;
    setSubmitting(true);
    try {
      const completed = await (decision === "accept" ? props.onApprove() : props.onReject());
      if (!completed) setSubmitting(false);
    } catch (error) {
      toast.error(errorMessage(error, t("prompt.approval.answerFailed")));
      setSubmitting(false);
    }
  };
  const alwaysAllow = async () => {
    const grant = props.onAlwaysAllow;
    if (!grant || submitting()) return;
    setConfirmingAlways(false);
    setSubmitting(true);
    try {
      const completed = await grant();
      if (!completed) setSubmitting(false);
    } catch (error) {
      toast.error(errorMessage(error, t("prompt.approval.grantFailed")));
      setSubmitting(false);
    }
  };

  return (
    <section
      class="approval-card conversation-interaction-card"
      aria-label={t("prompt.approval.label")}
      aria-busy={submitting() ? "true" : undefined}
    >
      <header class="approval-card-header conversation-interaction-header">
        <strong>{t(approvalTitle(props.approval))}</strong>
        <Badge variant="warning-light" class="conversation-interaction-status" role="status">
          <LoaderCircle class="conversation-interaction-spinner" data-icon="inline-start" aria-hidden="true" />
          {t("prompt.approval.badge")}
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
            <span class="approval-detail-label">{t("prompt.approval.files")}</span>
            <strong>{props.approval.grantRoot ?? t("prompt.approval.agentWorkspace")}</strong>
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
          {submitting() ? t("common.sending") : t("prompt.approval.allow")}
        </Button>
        <Show when={props.onAlwaysAllow}>
          <Button
            ref={alwaysAllowButton}
            variant="secondary"
            type="button"
            class="approval-button"
            disabled={submitting()}
            onClick={() => setConfirmingAlways(true)}
          >
            {t("prompt.approval.alwaysAllow")}
          </Button>
        </Show>
        <Button
          variant="secondary"
          type="button"
          class="approval-button"
          disabled={submitting()}
          onClick={() => void submit("decline")}
        >
          {submitting() ? t("prompt.approval.waiting") : t("prompt.approval.deny")}
        </Button>
      </footer>
      <StandingApprovalConfirmation
        open={confirmingAlways()}
        agentName={props.agentName}
        onCancel={() => setConfirmingAlways(false)}
        onConfirm={() => void alwaysAllow()}
        restoreFocusTarget={alwaysAllowButton}
      />
    </section>
  );
}

interface BrowserTakeoverCardProps {
  request?: BrowserTakeoverRequest;
  agentName: string;
  tab: BrowserTab | undefined;
  preview: BrowserPreview | null;
  previewStatus: "idle" | "loading" | "ready" | "failed";
  decision?: "complete" | "cancel" | null;
  onOpen?: () => void;
  onComplete: () => Promise<boolean>;
  onCancel: () => Promise<boolean>;
  browserSecret?: {
    loadPreview?: (tabId: string) => Promise<BrowserPreview>;
    onRespond: (input: RespondToBrowserSecretInput) => Promise<void>;
  };
}

export function BrowserTakeoverCard(props: BrowserTakeoverCardProps) {
  const secretRequest = () =>
    props.request?.secret && !props.request.secret.requiresReload && props.browserSecret ? props.request : undefined;
  return (
    <Show when={secretRequest()} fallback={<BrowserManualTakeoverCard {...props} />}>
      {(request) => {
        const actions = props.browserSecret;
        if (!actions) return null;
        return (
          <BrowserSecretCard
            request={request()}
            onOpen={props.onOpen}
            loadPreview={actions.loadPreview}
            onRespond={actions.onRespond}
          />
        );
      }}
    </Show>
  );
}

function BrowserManualTakeoverCard(props: BrowserTakeoverCardProps) {
  const { t } = useText();
  const [submitting, setSubmitting] = createSignal<"complete" | "cancel" | null>(null);
  const pageDetails = createMemo(() => browserPageDetails(props.tab, t));
  const completed = () => props.decision === "complete";
  const cancelled = () => props.decision === "cancel";
  const accessibleLabel = () =>
    t(
      completed()
        ? "prompt.browser.label.complete"
        : cancelled()
          ? "prompt.browser.label.cancelled"
          : "prompt.browser.label.pending",
    );
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
          {t(
            completed()
              ? "prompt.browser.title.complete"
              : cancelled()
                ? "prompt.browser.title.cancelled"
                : "prompt.browser.title.pending",
            { host: pageDetails().host },
          )}
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
              {completed() ? t("common.done") : t("prompt.browser.cancelled")}
            </Badge>
          }
        >
          <Badge variant="warning-light" class="conversation-interaction-status" role="status">
            <LoaderCircle class="conversation-interaction-spinner" data-icon="inline-start" aria-hidden="true" />
            {t("prompt.browser.actionRequired")}
          </Badge>
        </Show>
      </header>
      <Show when={props.request?.secret?.requiresReload}>
        <p>{t("prompt.browser.reload")}</p>
      </Show>
      <div class="browser-takeover-copy">
        <p>
          {completed()
            ? t("prompt.browser.continuing", { name: props.agentName })
            : cancelled()
              ? t("prompt.browser.cancelledBody")
              : t("prompt.browser.pendingBody", { name: props.agentName })}
        </p>
      </div>

      <figure class="browser-takeover-preview">
        <figcaption class="browser-takeover-preview-bar">
          <Monitor aria-hidden="true" />
          <span title={pageDetails().title}>{pageDetails().title}</span>
          <small title={pageDetails().host}>{pageDetails().host}</small>
        </figcaption>
        <Show
          when={props.onOpen}
          fallback={
            <div class="browser-takeover-preview-viewport">
              <BrowserTakeoverPreview
                preview={props.preview}
                previewStatus={props.previewStatus}
                page={pageDetails()}
              />
            </div>
          }
        >
          <Button
            variant="ghost"
            type="button"
            class="browser-takeover-preview-viewport browser-takeover-preview-open"
            aria-label={t("prompt.browser.openPage", { title: pageDetails().title })}
            onClick={() => props.onOpen?.()}
          >
            <BrowserTakeoverPreview preview={props.preview} previewStatus={props.previewStatus} page={pageDetails()} />
            <span class="browser-takeover-preview-open-label" aria-hidden="true">
              <Maximize2 />
              {t("common.open")}
            </span>
          </Button>
        </Show>
      </figure>

      <Show when={!props.decision}>
        <footer class="browser-takeover-actions">
          <Button
            variant="default"
            size="sm"
            type="button"
            class="approval-button"
            loading={submitting() === "complete"}
            loadingLabel={t("prompt.browser.returning")}
            disabled={Boolean(submitting())}
            onClick={() => void submit("complete")}
          >
            {t("prompt.browser.done")}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            type="button"
            class="approval-button"
            loading={submitting() === "cancel"}
            loadingLabel={t("prompt.browser.cancelling")}
            disabled={Boolean(submitting())}
            onClick={() => void submit("cancel")}
          >
            {t("common.cancel")}
          </Button>
        </footer>
      </Show>
    </section>
  );
}

function browserPageDetails(tab: BrowserTab | undefined, t: TextValue["t"]): { title: string; host: string } {
  const title = tab?.title.trim() || t("prompt.browser.pageFallback");
  if (!tab?.url) return { title, host: t("prompt.browser.hostFallback") };
  try {
    return { title, host: new URL(tab.url).hostname || t("prompt.browser.hostFallback") };
  } catch {
    return { title, host: tab.url };
  }
}

function approvalTitle(approval: AgentApproval | undefined) {
  if (approval?.kind === "command") return "prompt.approval.title.command";
  if (approval?.kind === "file-change") return "prompt.approval.title.fileChange";
  return "prompt.approval.title.permissions";
}

function PermissionDetails(props: { permissions: AgentApproval["permissions"] }) {
  const { t } = useText();
  const details = createMemo(() => {
    const permissions = props.permissions;
    if (!permissions) return [];
    return [
      ...(permissions.network ? [t("prompt.approval.network")] : []),
      ...permissions.fileSystem.read.map((path) => t("prompt.approval.read", { path })),
      ...permissions.fileSystem.write.map((path) => t("prompt.approval.write", { path })),
    ];
  });
  return (
    <section class="approval-permissions" aria-label={t("prompt.approval.permissions")}>
      <For each={details()}>{(detail) => <span>{detail}</span>}</For>
    </section>
  );
}
