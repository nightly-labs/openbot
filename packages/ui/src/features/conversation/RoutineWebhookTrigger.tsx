import type { EventFilterDraft } from "@openbot/contracts/event-filter-value";
import type { WebhookTestResult } from "@openbot/contracts/ipc-events";
import type { AppTextKey } from "@openbot/i18n";
import { Button, Check, ChevronDown, ChevronRight, Text, Webhook } from "@openbot/ui";
import type { JSX } from "@solidjs/web";
import { createEffect, createStore, Show } from "solid-js";
import { useText } from "../../text";
import { CodeBlock } from "./CodeBlock";
import { RoutineWebhookSecretField, RoutineWebhookUrlField } from "./RoutineWebhookEndpoint";
import { RoutineWebhookEvents } from "./RoutineWebhookEvents";

export interface RoutineWebhookTriggerProps {
  /** The URL the host made. Null until the relay registers the route. */
  url: string | null;
  /** True when the saved routine has a webhook trigger, so a URL and a secret exist. */
  saved: boolean;
  /** The relay connection of the host. Null when it is not known. */
  connected: boolean | null;
  eventType: string;
  filters: EventFilterDraft[];
  onEventTypeChange: (eventType: string) => void;
  onFiltersChange: (filters: EventFilterDraft[]) => void;
  /** The signing secret that the host returned once. Null when there is nothing to show. */
  secret: string | null;
  onSecretDismiss: () => void;
  /** Makes a new secret. The parent shows it through `secret`. */
  onRegenerateSecret: () => Promise<void>;
  /** A control at the end of the header, such as the menu that changes the trigger. */
  menu?: JSX.Element;
  /** Saves a new routine, so the host makes its URL and secret. Without it the card only asks for a save. */
  onSave?: (() => void) | undefined;
  saving?: boolean | undefined;
  /** Sends one signed test event to the saved routine. Without it the card leaves out the test step. */
  onSendTest?: (() => Promise<WebhookTestResult>) | undefined;
}

/** What the card keeps about its steps. A copy or a test in this view marks its step done. */
interface WebhookStepsState {
  urlCopied: boolean;
  secretCopied: boolean;
  exampleOpen: boolean;
  testing: boolean;
  result: WebhookTestResult | null;
  testError: string | null;
}

const IGNORED_TEXT = {
  "event-type": "routine.webhook.testIgnoredEventType",
  filter: "routine.webhook.testIgnoredFilter",
  inactive: "routine.webhook.testIgnoredInactive",
} as const satisfies Record<NonNullable<WebhookTestResult["reason"]>, AppTextKey>;

/** A request that a sender can copy. The secret stays in an environment variable, not in the text. */
function curlExample(url: string): string {
  return [
    `BODY='{"type":"order.created","data":{"order":{"status":"paid"}}}'`,
    "TS=$(date +%s); ID=$(openssl rand -hex 16)",
    `SIG=$(printf '%s.%s.%s' "$TS" "$ID" "$BODY" | openssl dgst -sha256 -hmac "$OPENBOT_WEBHOOK_SECRET" | sed 's/^.* //')`,
    `curl -X POST "${url}" \\`,
    `  -H "Content-Type: application/json" \\`,
    `  -H "X-OpenBot-Timestamp: $TS" \\`,
    `  -H "X-OpenBot-Delivery-Id: $ID" \\`,
    `  -H "X-OpenBot-Signature: sha256=$SIG" \\`,
    `  --data "$BODY"`,
  ].join("\n");
}

/**
 * The webhook trigger as one card with numbered steps: copy the URL, add the signing secret to the
 * sender, and send a test event. Each step shows a check when it is done. The events that start the
 * routine stay under the steps.
 */
export function RoutineWebhookTrigger(props: RoutineWebhookTriggerProps) {
  const { t, errorMessage } = useText();
  const [steps, setSteps] = createStore<WebhookStepsState>({
    urlCopied: false,
    secretCopied: false,
    exampleOpen: false,
    testing: false,
    result: null,
    testError: null,
  });
  // The editor can keep this card when it opens another routine, so a new endpoint clears the
  // steps. A new secret, such as after Regenerate, must be copied again.
  let shownUrl = props.url;
  createEffect(
    () => props.url,
    (url) => {
      if (shownUrl !== null && url !== shownUrl)
        setSteps((state) => {
          state.urlCopied = false;
          state.secretCopied = false;
          state.result = null;
          state.testError = null;
        });
      shownUrl = url;
    },
  );
  createEffect(
    () => props.secret,
    (secret) => {
      if (secret !== null)
        setSteps((state) => {
          state.secretCopied = false;
        });
    },
  );
  async function sendTest(): Promise<void> {
    const send = props.onSendTest;
    if (!send || steps.testing) return;
    setSteps((state) => {
      state.testing = true;
      state.result = null;
      state.testError = null;
    });
    try {
      const result = await send();
      setSteps((state) => {
        state.result = result;
      });
    } catch (cause) {
      const message = errorMessage(cause, t("routine.webhook.testFailed"));
      setSteps((state) => {
        state.testError = message;
      });
    } finally {
      setSteps((state) => {
        state.testing = false;
      });
    }
  }

  const testText = (result: WebhookTestResult) =>
    result.status === "started"
      ? t("routine.webhook.testStarted", { eventType: result.eventType })
      : t(IGNORED_TEXT[result.reason ?? "filter"]);

  return (
    <div class="routine-trigger-card">
      <div class="routine-trigger-card-header">
        <span class="routine-trigger-icon" aria-hidden="true">
          <Webhook />
        </span>
        <span class="routine-trigger-card-title">{t("routine.trigger.webhookDescription")}</span>
        <span class="routine-trigger-action">{props.menu}</span>
      </div>

      <ol class="routine-webhook-steps">
        <li>
          <StepMarker number={1} done={steps.urlCopied} />
          <div class="routine-webhook-step-body">
            <strong>{t("routine.webhook.stepUrl")}</strong>
            <Show
              when={props.saved}
              fallback={
                <>
                  <Text variant="caption" tone="muted">
                    {t("routine.webhook.urlAfterSave")}
                  </Text>
                  <Show when={props.onSave}>
                    {(save) => (
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        class="routine-webhook-step-button"
                        loading={props.saving === true}
                        loadingLabel={t("common.saving")}
                        onClick={() => save()()}
                      >
                        {t("routine.webhook.saveForUrl")}
                      </Button>
                    )}
                  </Show>
                </>
              }
            >
              <div class="routine-webhook-inset">
                <RoutineWebhookUrlField
                  url={props.url}
                  connected={props.connected}
                  onCopy={() =>
                    setSteps((state) => {
                      state.urlCopied = true;
                    })
                  }
                />
              </div>
              <Show
                when={props.url && props.connected === false}
                fallback={
                  <Text variant="caption" tone="muted">
                    {t("routine.webhook.stepUrlHint")}
                  </Text>
                }
              >
                <Text variant="caption" tone="warning">
                  {t("routine.webhook.relayOffline")}
                </Text>
              </Show>
            </Show>
          </div>
        </li>

        <li data-disabled={props.saved ? undefined : ""}>
          <StepMarker number={2} done={steps.secretCopied} />
          <div class="routine-webhook-step-body">
            <strong>{t("routine.webhook.stepSecret")}</strong>
            <Text variant="caption" tone="muted">
              {t("routine.webhook.stepSecretHint")}
            </Text>
            <Show when={props.saved}>
              <div class="routine-webhook-inset">
                <RoutineWebhookSecretField
                  secret={props.secret}
                  onSecretDismiss={props.onSecretDismiss}
                  onRegenerateSecret={props.onRegenerateSecret}
                  onCopy={() =>
                    setSteps((state) => {
                      state.secretCopied = true;
                    })
                  }
                />
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                class="routine-webhook-disclosure"
                aria-expanded={steps.exampleOpen ? "true" : "false"}
                onClick={() =>
                  setSteps((state) => {
                    state.exampleOpen = !state.exampleOpen;
                  })
                }
              >
                <Show
                  when={steps.exampleOpen}
                  fallback={<ChevronRight class="routine-webhook-disclosure-icon" aria-hidden="true" />}
                >
                  <ChevronDown class="routine-webhook-disclosure-icon" aria-hidden="true" />
                </Show>
                {t("routine.webhook.howToSign")}
              </Button>
              <Show when={steps.exampleOpen}>
                <CodeBlock
                  block={{ type: "code", language: "bash", code: curlExample(props.url ?? "https://<endpoint>") }}
                />
                <Text variant="caption" tone="muted">
                  {t("routine.webhook.howToSignHint")}
                </Text>
              </Show>
            </Show>
          </div>
        </li>

        <Show when={props.onSendTest}>
          <li data-disabled={props.saved ? undefined : ""}>
            <StepMarker number={3} done={steps.result?.status === "started"} />
            <div class="routine-webhook-step-body">
              <strong>{t("routine.webhook.stepTest")}</strong>
              <Text variant="caption" tone="muted">
                {t("routine.webhook.stepTestHint")}
              </Text>
              <Show when={props.saved}>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  class="routine-webhook-step-button"
                  loading={steps.testing}
                  loadingLabel={t("routine.webhook.sendingTest")}
                  onClick={() => void sendTest()}
                >
                  {t("routine.webhook.sendTest")}
                </Button>
              </Show>
              <Show when={steps.result}>
                {(result) => (
                  <Text
                    variant="caption"
                    tone={result().status === "started" ? "success" : "warning"}
                    role="status"
                    class="routine-webhook-test-result"
                  >
                    {testText(result())}
                  </Text>
                )}
              </Show>
              <Show when={steps.testError}>
                {(message) => (
                  <Text variant="caption" tone="danger" role="alert" class="routine-webhook-test-result">
                    {message()}
                  </Text>
                )}
              </Show>
            </div>
          </li>
        </Show>
      </ol>

      <RoutineWebhookEvents
        eventType={props.eventType}
        filters={props.filters}
        onEventTypeChange={props.onEventTypeChange}
        onFiltersChange={props.onFiltersChange}
      />
    </div>
  );
}

/** The number of a step, or a check when the step is done. The list itself gives the order. */
function StepMarker(props: { number: number; done: boolean }) {
  const { t } = useText();
  return (
    <span class="routine-webhook-step-marker" data-done={props.done ? "" : undefined}>
      <Show when={props.done} fallback={<span aria-hidden="true">{props.number}</span>}>
        <Check class="routine-webhook-step-check" aria-label={t("routine.webhook.stepDone")} />
      </Show>
    </span>
  );
}
