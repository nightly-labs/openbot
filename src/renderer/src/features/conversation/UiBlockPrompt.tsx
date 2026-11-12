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
  /** A block the person answers through the prompt it sits beside. */
  block: ConversationUiBlock;
  agents: AgentProfile[];
  /** The agent that asks, which a Vault request names. */
  agentId?: string | undefined;
  onSelectAgent: (agentId: string) => void;
  onOpenLink: (url: string) => void;
  /**
   * Sends the answers to the block's fallback questions through the prompt route. Absent for a block
   * in the history, which only shows its stored state.
   */
  onAnswer?: ((answers: Record<string, string[]>, options?: PromptAnswerOptions) => Promise<boolean>) | undefined;
  /** The answer went through and the card shows it. */
  onAnswered?: (() => void) | undefined;
  /** Gets the card's element, and undefined once the card is gone. */
  elementRef?: ((element: HTMLElement | undefined) => void) | undefined;
}

/** The form values of a Vault item, keyed by the field ids of `UI_VAULT_REQUEST_FIELDS`. */
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

/** The `request_api_key` form with the choice of who can use the key, which the Vault card shows. */
interface ApiKeyRequest {
  /** The secret field, whose label is the name of the key. */
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

/**
 * An agent's blocking block as a card. The card's response goes out as the answers to the block's
 * fallback questions, the same way a client that only knows the questions answers, so the host
 * reads both alike. A skip answers every question with nothing.
 */
export function UiBlockPrompt(props: UiBlockPromptProps) {
  const { t, format, errorMessage } = useText();
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal<string>();
  // What this client sent, shown frozen until the host's stored state replaces it.
  const [sent, setSent] = createSignal<UiBlockState>();
  onCleanup(() => props.elementRef?.(undefined));
  const stored = (): UiBlockState =>
    props.block.state.status === "pending" ? (sent() ?? props.block.state) : props.block.state;
  // The host stores the outcome with English list commas; draw it again in the reader's language.
  const state = (): UiBlockState => {
    const current = stored();
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

  function respond(response: UiBlockResponse): void {
    const spec = props.block.spec;
    const outcome = uiBlockOutcomeText(spec, response);
    void send(uiBlockAnswersFromResponse(spec, response), {
      status: "answered",
      response,
      ...(outcome.trim() ? { outcome } : {}),
    });
  }

  function skip(): void {
    const answers = Object.fromEntries(uiBlockFallbackQuestions(props.block.spec).map((question) => [question.id, []]));
    void send(answers, { status: "closed" });
  }

  const apiKeyRequest = createMemo(() => apiKeyRequestOf(props.block));

  /** The fields that the agent filled in, or the name of a requested API key. */
  const prefill = () => {
    const apiKey = apiKeyRequest();
    if (apiKey) return { name: apiKey.name };
    const spec = props.block.spec;
    if (spec.type !== "form") return {};
    return Object.fromEntries(
      spec.fields.flatMap((field) => (field.kind === "text" && field.value ? [[field.id, field.value]] : [])),
    );
  };

  /** The answer of the form for the item, and the secret field ids, which the frozen state does not keep. */
  function itemAnswer(input: VaultSaveInput, scope: string | undefined): [Record<string, string>, readonly string[]] {
    const apiKey = apiKeyRequest();
    if (apiKey && input.kind === "apiKey")
      return [
        { [apiKey.keyFieldId]: input.key ?? "", [UI_API_KEY_SCOPE_FIELD_ID]: scope ?? apiKey.scope.value },
        [apiKey.keyFieldId],
      ];
    return [vaultFormValues(input), UI_VAULT_SECRET_FIELDS];
  }

  /**
   * Sends the item as the form's answer. The host saves it to the Vault and gives the agent only its
   * name. The frozen state keeps no secret value. A failure goes to the dialog.
   */
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

  // An API key request opens the Vault dialog when the host offers the Vault, which the scope field shows.
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
