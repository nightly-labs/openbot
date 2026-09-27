import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import {
  Alert,
  AlertContent,
  AlertDescription,
  AlertIcon,
  AlertTitle,
  ArrowLeft,
  Bot,
  Button,
  CircleCheck,
  Dialog,
  Field,
  Heading,
  IconButton,
  Input,
  Plug,
  ShieldCheck,
  Spinner,
  Text,
  TriangleAlert,
  X,
} from "@openbot/ui";
import { createEffect, createSignal, createStore, For, Match, onSettled, Show, Switch, untrack } from "solid-js";
import { createScrollFades } from "../../components/createScrollFades";
import { useText } from "../../text";
import {
  type AcpAgentCheck,
  type CustomAcpAgentDraft,
  type CustomAcpAgentErrors,
  type CustomAcpAgentPreset,
  customAcpAgentValue,
  emptyCustomAcpAgentDraft,
  hasCustomAcpAgentError,
  presetAcpAgentDraft,
  validateCustomAcpAgent,
} from "./custom-acp-agent-form";
import { type RepeatableColumn, RepeatableRows } from "./RepeatableRows";

// Examples of identifiers and commands. They are not words, so they are the same in each language.
const AGENT_ID_PLACEHOLDER = "my-agent";
const COMMAND_PLACEHOLDER = "my-agent";
const ARGS_PLACEHOLDER = "acp";
const ENV_NAME_PLACEHOLDER = "NAME";
const ENV_LIMIT = 16;

type EnvRow = CustomAcpAgentDraft["env"][number];

function cloneDraft(draft: CustomAcpAgentDraft): CustomAcpAgentDraft {
  return { ...draft, env: draft.env.map((row) => ({ ...row })) };
}

interface CustomAcpAgentDialogProps {
  open: boolean;
  draft?: CustomAcpAgentDraft;
  /** Known agents whose command fills the form in one press. */
  presets?: readonly CustomAcpAgentPreset[];
  /** The last trial start. The host owns it because it starts a process. */
  check?: AcpAgentCheck;
  onCheck?: (value: CustomAcpAgentDraft) => void;
  showErrors?: boolean;
  busy?: boolean;
  submitError?: string | null;
  takenAgentIds?: readonly string[];
  onSubmit: (value: CustomAcpAgentDraft) => void;
  onCancel: () => void;
  onBack?: () => void;
}

export function CustomAcpAgentDialog(props: CustomAcpAgentDialogProps) {
  const { t } = useText();
  const [draft, setDraft] = createStore<CustomAcpAgentDraft>(
    untrack(() => (props.draft ? cloneDraft(props.draft) : emptyCustomAcpAgentDraft())),
  );
  const [submitted, setSubmitted] = createSignal(untrack(() => Boolean(props.showErrors)));

  // The same reopen rule as the endpoint form: a second open starts from the given draft again.
  createEffect(
    () => props.open,
    (open, previous) => {
      if (!open || previous) return;
      setDraft(() => (props.draft ? cloneDraft(props.draft) : emptyCustomAcpAgentDraft()));
      setSubmitted(Boolean(props.showErrors));
    },
  );

  const errors = () => validateCustomAcpAgent(draft, props.takenAgentIds, t);
  const shown = (): CustomAcpAgentErrors | null => (submitted() ? errors() : null);
  const busy = () => Boolean(props.busy);
  const check = (): AcpAgentCheck => props.check ?? { status: "idle" };
  const checkPassed = () => {
    const state = check();
    return state.status === "ok" ? state : undefined;
  };
  const checkFailed = () => {
    const state = check();
    return state.status === "failed" ? state.message : undefined;
  };

  const fades = createScrollFades();
  onSettled(() => fades.stop);
  createEffect(
    () => ({ env: draft.env.length, errors: shown(), check: check().status }),
    () => fades.remeasure(),
  );

  const envColumns: readonly [RepeatableColumn<EnvRow>, RepeatableColumn<EnvRow>] = [
    {
      label: (number) => t("customProvider.acp.env.name", { number }),
      placeholder: () => ENV_NAME_PLACEHOLDER,
      maxlength: INPUT_LIMITS.identifier,
      identifier: true,
      read: (row) => row.name,
      write: (index, value) =>
        setDraft((state) => {
          const row = state.env[index];
          if (row) row.name = value;
        }),
    },
    {
      label: (number) => t("customProvider.acp.env.value", { number }),
      placeholder: () => t("customProvider.header.valuePlaceholder"),
      maxlength: INPUT_LIMITS.path,
      identifier: true,
      read: (row) => row.value,
      write: (index, value) =>
        setDraft((state) => {
          const row = state.env[index];
          if (row) row.value = value;
        }),
    },
  ];

  function applyPreset(preset: CustomAcpAgentPreset): void {
    setDraft((state) => {
      const next = presetAcpAgentDraft(preset);
      state.agentId = next.agentId;
      state.displayName = next.displayName;
      state.command = next.command;
      state.args = next.args;
    });
  }

  function submit(): void {
    setSubmitted(true);
    if (busy() || hasCustomAcpAgentError(errors())) return;
    props.onSubmit(customAcpAgentValue(draft));
  }

  return (
    <Dialog.Root open={props.open} onOpenChange={(open) => !open && props.onCancel()}>
      <Dialog.Portal>
        <Dialog.Overlay class="custom-provider-backdrop">
          <Dialog.Content as="section" class="custom-provider-dialog" aria-busy={busy() ? "true" : undefined}>
            <Dialog.Title class="sr-only">{t("customProvider.acp.title")}</Dialog.Title>
            <Dialog.Description class="sr-only">{t("customProvider.acp.description")}</Dialog.Description>

            <header class="custom-provider-header">
              <Show when={props.onBack}>
                <IconButton label={t("common.back")} variant="ghost" disabled={busy()} onClick={() => props.onBack?.()}>
                  <ArrowLeft />
                </IconButton>
              </Show>
              <span class="custom-provider-mark" aria-hidden="true">
                <Bot />
              </span>
              <div class="custom-provider-title">
                <Heading as="h2" size="md">
                  {t("customProvider.acp.heading")}
                </Heading>
                <Text tone="muted" variant="caption">
                  {t("customProvider.acp.subtitle")}
                </Text>
              </div>
              <IconButton
                class="custom-provider-close"
                label={t("common.close")}
                variant="ghost"
                disabled={busy()}
                onClick={props.onCancel}
              >
                <X />
              </IconButton>
            </header>

            <form
              class="custom-provider-body"
              onSubmit={(event) => {
                event.preventDefault();
                submit();
              }}
            >
              <div class={["custom-provider-form", fades.classes()]} ref={fades.bind} onScroll={fades.measure}>
                <Show when={props.presets?.length ? props.presets : undefined}>
                  {(presets) => (
                    <section class="custom-provider-rows" aria-label={t("customProvider.acp.presets")}>
                      <Text variant="label-sm">{t("customProvider.acp.presets")}</Text>
                      <div class="custom-acp-presets">
                        <For each={presets()}>
                          {(preset) => (
                            <Button
                              type="button"
                              variant={draft.agentId === preset.id ? "secondary" : "outline"}
                              size="xs"
                              aria-pressed={draft.agentId === preset.id ? "true" : "false"}
                              disabled={busy()}
                              onClick={() => applyPreset(preset)}
                            >
                              {preset.name}
                            </Button>
                          )}
                        </For>
                      </div>
                    </section>
                  )}
                </Show>

                <Field label={t("customProvider.field.displayName")} error={shown()?.displayName} required>
                  <Input
                    value={draft.displayName}
                    onValueChange={(value) =>
                      setDraft((state) => {
                        state.displayName = value;
                      })
                    }
                    placeholder={t("customProvider.acp.displayNamePlaceholder")}
                    maxlength={INPUT_LIMITS.agentName}
                    disabled={busy()}
                  />
                </Field>

                <Field
                  label={t("customProvider.acp.agentId")}
                  description={t("customProvider.field.providerIdHint")}
                  error={shown()?.agentId}
                  required
                >
                  <Input
                    value={draft.agentId}
                    onValueChange={(value) =>
                      setDraft((state) => {
                        state.agentId = value;
                      })
                    }
                    placeholder={AGENT_ID_PLACEHOLDER}
                    autocomplete="off"
                    spellcheck={false}
                    maxlength={INPUT_LIMITS.identifier}
                    disabled={busy()}
                  />
                </Field>

                <Field
                  label={t("customProvider.acp.command")}
                  description={t("customProvider.acp.commandHint")}
                  error={shown()?.command}
                  required
                >
                  <Input
                    class="custom-acp-code"
                    value={draft.command}
                    onValueChange={(value) =>
                      setDraft((state) => {
                        state.command = value;
                      })
                    }
                    placeholder={COMMAND_PLACEHOLDER}
                    autocomplete="off"
                    spellcheck={false}
                    maxlength={INPUT_LIMITS.path}
                    disabled={busy()}
                  />
                </Field>

                <Field label={t("customProvider.acp.args")} description={t("customProvider.acp.argsHint")}>
                  <Input
                    class="custom-acp-code"
                    value={draft.args}
                    onValueChange={(value) =>
                      setDraft((state) => {
                        state.args = value;
                      })
                    }
                    placeholder={ARGS_PLACEHOLDER}
                    autocomplete="off"
                    spellcheck={false}
                    maxlength={INPUT_LIMITS.path}
                    disabled={busy()}
                  />
                </Field>

                <RepeatableRows
                  label={t("customProvider.acp.env")}
                  removeLabel={(number) => t("customProvider.acp.env.remove", { number })}
                  addLabel={t("customProvider.acp.env.add")}
                  columns={envColumns}
                  rows={draft.env}
                  limit={ENV_LIMIT}
                  busy={busy()}
                  rowError={(index) => shown()?.envRows[index]}
                  onAdd={() =>
                    setDraft((state) => {
                      state.env.push({ name: "", value: "" });
                    })
                  }
                  onRemove={(index) =>
                    setDraft((state) => {
                      state.env.splice(index, 1);
                    })
                  }
                />

                <Show when={props.onCheck}>
                  {(runCheck) => (
                    <section class="custom-provider-rows" aria-label={t("customProvider.acp.check")}>
                      <div class="custom-provider-rows-heading">
                        <Text variant="label-sm">{t("customProvider.acp.check")}</Text>
                        <Button
                          type="button"
                          variant="ghost"
                          size="xs"
                          class="custom-provider-discover"
                          disabled={busy() || !draft.command.trim() || check().status === "checking"}
                          onClick={() => runCheck()(customAcpAgentValue(draft))}
                        >
                          <Plug />
                          {t("customProvider.acp.checkRun")}
                        </Button>
                      </div>
                      <Switch
                        fallback={
                          <Text tone="muted" variant="caption">
                            {t("customProvider.acp.checkIdle")}
                          </Text>
                        }
                      >
                        <Match when={check().status === "checking"}>
                          <div class="custom-provider-discovery-status" role="status">
                            <Spinner size="sm" />
                            <Text tone="muted" variant="caption">
                              {t("customProvider.acp.checking", { command: draft.command.trim() })}
                            </Text>
                          </div>
                        </Match>
                        <Match when={checkPassed()}>
                          {(passed) => (
                            <Alert tone="success" role="status">
                              <AlertIcon>
                                <CircleCheck />
                              </AlertIcon>
                              <AlertContent>
                                <AlertTitle>
                                  {passed().version
                                    ? t("customProvider.acp.checkOkVersion", {
                                        name: passed().agentName,
                                        version: passed().version ?? "",
                                      })
                                    : t("customProvider.acp.checkOk", { name: passed().agentName })}
                                </AlertTitle>
                                <AlertDescription>
                                  {t("customProvider.acp.checkProtocol", { version: passed().protocolVersion })}
                                  <Show when={passed().capabilities.length > 0}>
                                    {` · ${passed().capabilities.join(", ")}`}
                                  </Show>
                                </AlertDescription>
                              </AlertContent>
                            </Alert>
                          )}
                        </Match>
                        <Match when={checkFailed()}>
                          {(message) => (
                            <Alert tone="danger" role="alert">
                              <AlertIcon>
                                <TriangleAlert />
                              </AlertIcon>
                              <AlertContent>
                                <AlertTitle>{t("customProvider.acp.checkFailed")}</AlertTitle>
                                <AlertDescription>{message()}</AlertDescription>
                              </AlertContent>
                            </Alert>
                          )}
                        </Match>
                      </Switch>
                    </section>
                  )}
                </Show>

                <Alert tone="warning">
                  <AlertIcon>
                    <ShieldCheck />
                  </AlertIcon>
                  <AlertContent>
                    <AlertTitle>{t("customProvider.acp.trustTitle")}</AlertTitle>
                    <AlertDescription>{t("customProvider.acp.trustDescription")}</AlertDescription>
                  </AlertContent>
                </Alert>
              </div>

              <footer class="custom-provider-actions">
                <Show when={props.submitError}>
                  {(message) => (
                    <Text class="custom-provider-submit-error" tone="danger" variant="caption" role="alert">
                      {message()}
                    </Text>
                  )}
                </Show>
                <Button type="submit" variant="default" loading={busy()} loadingLabel={t("common.saving")}>
                  {t("customProvider.acp.submit")}
                </Button>
              </footer>
            </form>
          </Dialog.Content>
        </Dialog.Overlay>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
