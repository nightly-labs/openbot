import { type VaultItemKind, type VaultSaveInput, vaultExpiryText } from "@openbot/contracts/ipc";
import {
  type ConversationUiBlock,
  isSecretFormField,
  UI_API_KEY_SCOPE_FIELD_ID,
  UI_BLOCK_SUBMIT_ACTION_ID,
  UI_VAULT_SECRET_FIELDS,
  type UiBlockResponse,
  type UiBlockState,
  uiBlockAnswersFromResponse,
  uiBlockFallbackQuestions,
  uiBlockOutcomeText,
  uiConfirmAnswersWithPreview,
} from "@openbot/contracts/ui-blocks";
import type { AgentProfile } from "@openbot/ui/data";
import { MarkdownMessageText } from "@openbot/ui/features/conversation/MarkdownMessageText";
import { UiBlockingBlock } from "@openbot/ui/features/conversation/ui-blocks/UiBlockingBlock";
import type { VaultRequestScope } from "@openbot/ui/features/vault/VaultPanel";
import { VaultRequestCard } from "@openbot/ui/features/vault/VaultRequestCard";
import { useText } from "@openbot/ui/text";
import { createMemo, createSignal, onCleanup, Show } from "solid-js";
import type { PromptAnswerOptions } from "./conversation-types";

export interface UiBlockPromptProps {
  block: ConversationUiBlock;
  agents: AgentProfile[];
  agentId?: string | undefined;
  onSelectAgent: (agentId: string) => void;
  onOpenLink: (url: string) => void;
  onAnswer?: ((answers: Record<string, string[]>, options?: PromptAnswerOptions) => Promise<boolean>) | undefined;
  canEditPreview?: boolean | undefined;
  onUnsentPreviewChange?: ((text: string | undefined) => void) | undefined;
  onAnswered?: (() => void) | undefined;
  elementRef?: ((element: HTMLElement | undefined) => void) | undefined;
}

function vaultFormValues(input: VaultSaveInput): Record<string, string> {
  switch (input.kind) {
    case "login":
      return { website: input.website, username: input.username, password: input.password ?? "" };
    case "card":
      return {
        label: input.label,
        nameOnCard: input.nameOnCard,
        number: input.number ?? "",
        expiry: vaultExpiryText(input.expMonth, input.expYear),
        securityCode: input.securityCode ?? "",
      };
    case "contact": {
      const { kind: _kind, id: _id, agents: _agents, ...fields } = input;
      return fields;
    }
    case "apiKey":
      return {};
  }
}

interface ApiKeyRequest {
  keyFieldId: string;
  name: string;
  placeholder: string | undefined;
  scope: VaultRequestScope;
}

function apiKeyRequestOf(block: ConversationUiBlock): ApiKeyRequest | undefined {
  const spec = block.spec;
  if (!block.apiKey || spec.type !== "form") return undefined;
  const key = spec.fields.find(isSecretFormField);
  const scope = spec.fields.find((field) => field.id === UI_API_KEY_SCOPE_FIELD_ID);
  if (!key || (scope?.kind !== "segmented" && scope?.kind !== "select")) return undefined;
  const [first] = scope.options;
  if (first === undefined) return undefined;
  return {
    keyFieldId: key.id,
    name: key.label ?? key.id,
    placeholder: "placeholder" in key ? key.placeholder : undefined,
    scope: { label: scope.label ?? scope.id, options: scope.options, value: scope.value ?? first },
  };
}

export function UiBlockPrompt(props: UiBlockPromptProps) {
  const { t, format, errorMessage, sourceText } = useText();
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal<string>();
  const [sent, setSent] = createSignal<UiBlockState>();
  onCleanup(() => props.elementRef?.(undefined));
  const stored = (): UiBlockState =>
    props.block.state.status === "pending" ? (sent() ?? props.block.state) : props.block.state;
  const state = (): UiBlockState => {
    const current = stored();
    if (current.status === "closed" && current.outcome) return { ...current, outcome: sourceText(current.outcome) };
    if (current.status !== "answered" || !current.response) return current;
    const outcome = uiBlockOutcomeText(props.block.spec, current.response, format.list);
    return outcome.trim() ? { ...current, outcome } : current;
  };

  async function send(answers: Record<string, string[]>, frozen: UiBlockState): Promise<void> {
    const answer = props.onAnswer;
    if (!answer || busy() || state().status !== "pending") return;
    setBusy(true);
    setError(undefined);
    let failure: string | undefined;
    const fail = (cause: unknown) => {
      failure = errorMessage(cause, t("uiBlock.error.answerFailed"));
    };
    let completed = false;
    try {
      completed = await answer(answers, { onError: fail });
    } catch (cause) {
      fail(cause);
    }
    setBusy(false);
    if (!completed) {
      setError(failure ?? t("uiBlock.error.answerFailed"));
      return;
    }
    setSent(frozen);
    props.onAnswered?.();
  }

  let previewDraft: string | undefined;
  const unsentPreview = () => {
    const spec = props.block.spec;
    return spec.type === "confirm" && previewDraft?.trim() && previewDraft !== spec.preview ? previewDraft : undefined;
  };

  function changePreviewDraft(draft: string | undefined): void {
    previewDraft = draft;
    props.onUnsentPreviewChange?.(unsentPreview());
  }

  function respond(response: UiBlockResponse, preview?: string): void {
    const spec = props.block.spec;
    const outcome = uiBlockOutcomeText(spec, response);
    props.onUnsentPreviewChange?.(undefined);
    void send(uiConfirmAnswersWithPreview(spec, response, preview), {
      status: "answered",
      response,
      ...(outcome.trim() ? { outcome } : {}),
    }).then(() => {
      if (state().status === "pending") props.onUnsentPreviewChange?.(unsentPreview());
    });
  }

  function skip(): void {
    const answers = Object.fromEntries(uiBlockFallbackQuestions(props.block.spec).map((question) => [question.id, []]));
    void send(answers, { status: "closed" });
  }

  const apiKeyRequest = createMemo(() => apiKeyRequestOf(props.block));

  const prefill = () => {
    const apiKey = apiKeyRequest();
    if (apiKey) return { name: apiKey.name };
    const spec = props.block.spec;
    if (spec.type !== "form") return {};
    return Object.fromEntries(
      spec.fields.flatMap((field) => (field.kind === "text" && field.value ? [[field.id, field.value]] : [])),
    );
  };

  function itemAnswer(input: VaultSaveInput, scope: string | undefined): [Record<string, string>, readonly string[]] {
    const apiKey = apiKeyRequest();
    if (apiKey && input.kind === "apiKey")
      return [
        { [apiKey.keyFieldId]: input.key ?? "", [UI_API_KEY_SCOPE_FIELD_ID]: scope ?? apiKey.scope.value },
        [apiKey.keyFieldId],
      ];
    return [vaultFormValues(input), UI_VAULT_SECRET_FIELDS];
  }

  async function saveVaultItem(input: VaultSaveInput, scope?: string): Promise<void> {
    const answer = props.onAnswer;
    if (!answer || state().status !== "pending") return;
    const [answerValues, secrets] = itemAnswer(input, scope);
    const values = Object.fromEntries(Object.entries(answerValues).filter(([, value]) => value !== ""));
    const response: UiBlockResponse = { actionId: UI_BLOCK_SUBMIT_ACTION_ID, values };
    const kept = Object.fromEntries(Object.entries(values).filter(([id]) => !secrets.includes(id)));
    let failure: unknown;
    setBusy(true);
    setError(undefined);
    const completed = await answer(uiBlockAnswersFromResponse(props.block.spec, response), {
      onError: (cause) => {
        failure = cause;
      },
    }).catch((cause: unknown) => {
      failure = cause;
      return false;
    });
    setBusy(false);
    if (!completed) throw failure ?? new Error(t("uiBlock.error.answerFailed"));
    setSent({ status: "answered", response: { actionId: UI_BLOCK_SUBMIT_ACTION_ID, values: kept } });
    props.onAnswered?.();
  }

  const vaultRequest = (): VaultItemKind | undefined =>
    props.block.vault?.kind ?? (apiKeyRequest() ? "apiKey" : undefined);

  return (
    <Show when={vaultRequest()} fallback={uiBlockCard()}>
      {(kind) => (
        <VaultRequestCard
          kind={kind()}
          title={props.block.spec.title ?? ""}
          agentName={props.agents.find((agent) => agent.id === props.agentId)?.name}
          prefill={prefill()}
          scope={apiKeyRequest()?.scope}
          keyPlaceholder={apiKeyRequest()?.placeholder}
          status={state().status}
          closedOutcome={state().outcome}
          saved={props.block.vault?.saved}
          values={state().response?.values}
          error={error()}
          busy={busy()}
          onSave={props.onAnswer ? saveVaultItem : undefined}
          onSkip={props.onAnswer ? skip : undefined}
          elementRef={(element) => props.elementRef?.(element)}
        />
      )}
    </Show>
  );

  function uiBlockCard() {
    return (
      <UiBlockingBlock
        spec={props.block.spec}
        state={state()}
        busy={busy()}
        error={error()}
        disabled={!props.onAnswer}
        onRespond={respond}
        canEditPreview={props.canEditPreview}
        onPreviewDraftChange={changePreviewDraft}
        onSkip={props.onAnswer ? skip : undefined}
        elementRef={(element) => props.elementRef?.(element)}
        renderPreview={(markdown) => (
          <div class="message-markdown">
            <MarkdownMessageText
              imagesAsLinks
              body={markdown}
              agents={props.agents}
              onSelectAgent={props.onSelectAgent}
              onOpenLink={props.onOpenLink}
            />
          </div>
        )}
      />
    );
  }
}
