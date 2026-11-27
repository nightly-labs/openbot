import { ProviderLogo } from "@openbot/brand";
import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import type {
  CustomProviderHarness,
  CustomProviderInputKind,
  CustomProviderReasoningEffort,
  ProviderRuntimeStatus,
  SaveCustomProviderInput,
} from "@openbot/contracts/ipc";
import {
  agentProviderName,
  CUSTOM_PROVIDER_DEFAULT_INPUTS,
  CUSTOM_PROVIDER_HARNESS_INPUT_KINDS,
  CUSTOM_PROVIDER_LIMITS,
  CUSTOM_PROVIDER_REASONING_EFFORTS,
  DEFAULT_CUSTOM_PROVIDER_HARNESS,
} from "@openbot/contracts/ipc";
import type { AppTextKey } from "@openbot/i18n";
import {
  ArrowLeft,
  Button,
  buttonVariants,
  Dialog,
  Download,
  Field,
  Heading,
  IconButton,
  Input,
  RefreshCw,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  SlidersHorizontal,
  Spinner,
  Text,
  X,
} from "@openbot/ui";
import { createEffect, createSignal, createStore, Match, onSettled, Show, Switch, untrack } from "solid-js";
import { createScrollFades } from "../../components/createScrollFades";
import { REASONING_LABEL } from "../../components/ProviderModelPicker";
import { useText } from "../../text";
import {
  blankModel,
  type CustomProviderDraft,
  type CustomProviderEndpoint,
  type CustomProviderErrors,
  customProviderEndpoint,
  customProviderValue,
  type DiscoveredModel,
  emptyCustomProviderDraft,
  fillFoundValues,
  hasCustomProviderError,
  holdsFoundValues,
  keepsHeaderValue,
  type ModelDiscovery,
  tokenCountEditText,
  tokenCountRestText,
  tokenCountText,
  validateCustomProvider,
} from "./custom-provider-form";
import { FoundModelPicker } from "./FoundModelPicker";
import { ModelChoiceMenu } from "./ModelChoiceMenu";
import { type RepeatableColumn, RepeatableRows, type RepeatableTable } from "./RepeatableRows";

const PROVIDER_ID_PLACEHOLDER = "my-provider";
const BASE_URL_PLACEHOLDER = "http://127.0.0.1:11434/v1";
const MODEL_ID_PLACEHOLDER = "model-id";
const HEADER_NAME_PLACEHOLDER = "Header-Name";

const INPUT_KIND_LABEL = {
  image: "customProvider.model.inputImage",
  pdf: "customProvider.model.inputPdf",
} as const satisfies Record<CustomProviderInputKind, AppTextKey>;

export interface CustomProviderHarnessChoice {
  id: CustomProviderHarness;
  ready: boolean;
  runtime?: ProviderRuntimeStatus | undefined;
}

function harnessDownload(choice: CustomProviderHarnessChoice): ProviderRuntimeStatus["phase"] | null {
  const phase = choice.ready ? null : choice.runtime?.phase;
  return phase && phase !== "ready" ? phase : null;
}

function startsDownload(phase: ProviderRuntimeStatus["phase"] | null): boolean {
  return phase === "not-downloaded" || phase === "download-error";
}

type ModelRow = CustomProviderDraft["models"][number];
type HeaderRow = CustomProviderDraft["headers"][number];

function cloneDraft(draft: CustomProviderDraft): CustomProviderDraft {
  return {
    ...draft,
    models: draft.models.map((model) => ({
      ...model,
      ...(model.reasoningEfforts ? { reasoningEfforts: [...model.reasoningEfforts] } : {}),
      ...(model.inputs ? { inputs: [...model.inputs] } : {}),
    })),
    headers: draft.headers.map((header) => ({ ...header })),
  };
}

interface CustomProviderDialogProps {
  open: boolean;
  draft?: CustomProviderDraft | undefined;
  showErrors?: boolean | undefined;
  busy?: boolean | undefined;
  submitError?: string | null | undefined;
  takenProviderIds?: readonly string[] | undefined;
  providerIdLocked?: boolean | undefined;
  apiKeyKept?: boolean | undefined;
  contextWindows?: boolean | undefined;
  harnesses?: readonly CustomProviderHarnessChoice[] | undefined;
  onDownloadHarness?: ((harness: CustomProviderHarness) => void) | undefined;
  harnessError?: string | undefined;
  discovery?: ModelDiscovery | undefined;
  onDiscoverModels?: ((endpoint: CustomProviderEndpoint) => void) | undefined;
  onSubmit: (value: SaveCustomProviderInput) => void;
  onCancel: () => void;
  onBack?: (() => void) | undefined;
}

export function CustomProviderDialog(props: CustomProviderDialogProps) {
  const { t, format } = useText();
  const [draft, setDraft] = createStore<CustomProviderDraft>(
    untrack(() => (props.draft ? cloneDraft(props.draft) : emptyCustomProviderDraft())),
  );
  const [submitted, setSubmitted] = createSignal(untrack(() => Boolean(props.showErrors)));

  let fillNextList = false;

  createEffect(
    () => props.open,
    (open, previous) => {
      if (!open || previous) return;
      const next = untrack(() => props.draft);
      setDraft(() => (next ? cloneDraft(next) : emptyCustomProviderDraft()));
      setSubmitted(untrack(() => Boolean(props.showErrors)));
      fillNextList = false;
    },
  );

  const errors = () =>
    validateCustomProvider(draft, { taken: props.takenProviderIds, locked: props.providerIdLocked }, t, format);
  const shown = (): CustomProviderErrors | null => (submitted() ? errors() : null);
  const busy = () => Boolean(props.busy);
  const discovery = (): ModelDiscovery => props.discovery ?? { status: "idle" };
  const [mount, setMount] = createSignal<HTMLElement | undefined>(undefined);
  const harness = (): CustomProviderHarness =>
    draft.harness ?? props.harnesses?.find((choice) => choice.ready)?.id ?? DEFAULT_CUSTOM_PROVIDER_HARNESS;
  const choiceOf = (id: CustomProviderHarness): CustomProviderHarnessChoice =>
    props.harnesses?.find((choice) => choice.id === id) ?? { id, ready: true };
  const downloading = (id: CustomProviderHarness): ProviderRuntimeStatus["phase"] | null => {
    const phase = harnessDownload(choiceOf(id));
    return phase === "downloading" || phase === "finishing" ? phase : null;
  };
  function downloadText(phase: ProviderRuntimeStatus["phase"], progress: number | null | undefined): string {
    if (phase === "downloading")
      return t("provider.picker.downloading", { percent: format.percent(Math.round(progress ?? 0) / 100) });
    if (phase === "finishing") return t("provider.status.settingUp");
    if (phase === "download-error") return t("common.retry");
    return t("common.download");
  }

  const fades = createScrollFades();
  onSettled(() => fades.stop);
  createEffect(
    () => ({
      models: draft.models.length,
      headers: draft.headers.length,
      errors: shown(),
      discovery: discovery().status,
    }),
    () => fades.remeasure(),
  );

  const modelNameColumns: readonly [RepeatableColumn<ModelRow>, RepeatableColumn<ModelRow>] = [
    {
      label: (number) => t("customProvider.model.id", { number }),
      placeholder: () => MODEL_ID_PLACEHOLDER,
      maxlength: INPUT_LIMITS.modelName,
      identifier: true,
      read: (row) => row.id,
      write: (index, value) =>
        setDraft((state) => {
          const model = state.models[index];
          if (model) model.id = value;
        }),
    },
    {
      label: (number) => t("customProvider.model.name", { number }),
      placeholder: () => t("customProvider.model.namePlaceholder"),
      maxlength: INPUT_LIMITS.modelName,
      read: (row) => row.name,
      write: (index, value) =>
        setDraft((state) => {
          const model = state.models[index];
          if (model) model.name = value;
        }),
    },
  ];

  const contextWindowColumn: RepeatableColumn<ModelRow> = {
    label: (number) => t("customProvider.model.contextWindow", { number }),
    placeholder: () => t("customProvider.model.contextWindowPlaceholder"),
    maxlength: 16,
    identifier: true,
    numeric: true,
    read: (row) => row.contextWindow ?? "",
    editText: tokenCountEditText,
    restText: (value) => tokenCountRestText(value, format),
    write: (index, value) =>
      setDraft((state) => {
        const model = state.models[index];
        if (model) model.contextWindow = value;
      }),
  };
  const maxOutputColumn: RepeatableColumn<ModelRow> = {
    label: (number) => t("customProvider.model.maxOutput", { number }),
    placeholder: () => t("customProvider.model.maxOutputPlaceholder"),
    maxlength: 16,
    identifier: true,
    numeric: true,
    read: (row) => row.maxOutput ?? "",
    editText: tokenCountEditText,
    restText: (value) => tokenCountRestText(value, format),
    write: (index, value) =>
      setDraft((state) => {
        const model = state.models[index];
        if (model) model.maxOutput = value;
      }),
  };
  const tableColumns: readonly RepeatableColumn<ModelRow>[] = [
    { ...modelNameColumns[0], mono: true },
    modelNameColumns[1],
    contextWindowColumn,
    maxOutputColumn,
  ];
  const modelColumns = () => (props.contextWindows ? tableColumns : modelNameColumns);

  function setEffort(index: number, effort: CustomProviderReasoningEffort, checked: boolean): void {
    setDraft((state) => {
      const model = state.models[index];
      if (!model) return;
      model.reasoningEfforts ??= [];
      const at = model.reasoningEfforts.indexOf(effort);
      if (checked && at < 0) model.reasoningEfforts.push(effort);
      if (!checked && at >= 0) model.reasoningEfforts.splice(at, 1);
      if (model.reasoningEfforts.length === 0) delete model.reasoningEfforts;
    });
  }

  function setNoEffort(index: number, on: boolean): void {
    setDraft((state) => {
      const model = state.models[index];
      if (!model) return;
      if (on) model.reasoningEfforts = [];
      else delete model.reasoningEfforts;
    });
  }

  const modelEfforts = (row: ModelRow): readonly CustomProviderReasoningEffort[] => row.reasoningEfforts ?? [];
  const noEfforts = () =>
    harness() === "pi" ? t("customProvider.model.effortsNone") : t("customProvider.model.effortsDefault");

  const modelInputs = (row: ModelRow): readonly CustomProviderInputKind[] =>
    row.inputs ?? CUSTOM_PROVIDER_DEFAULT_INPUTS[harness()];

  function setInput(index: number, kind: CustomProviderInputKind, checked: boolean): void {
    setDraft((state) => {
      const model = state.models[index];
      if (!model) return;
      model.inputs ??= [...CUSTOM_PROVIDER_DEFAULT_INPUTS[harness()]];
      const at = model.inputs.indexOf(kind);
      if (checked && at < 0) model.inputs.push(kind);
      if (!checked && at >= 0) model.inputs.splice(at, 1);
    });
  }

  const modelTable: RepeatableTable<ModelRow> = {
    get header() {
      return [
        t("customProvider.model.idColumn"),
        t("customProvider.field.displayName"),
        t("customProvider.model.contextWindowColumn"),
        t("customProvider.model.maxOutputColumn"),
        t("customProvider.model.effortsLabel"),
        t("customProvider.model.inputsLabel"),
      ];
    },
    cells: (row, index) => (
      <>
        <ModelChoiceMenu
          label={t("customProvider.model.efforts", { number: index() + 1 })}
          empty={noEfforts()}
          none={harness() === "pi" ? undefined : t("customProvider.model.effortsNone")}
          noneChosen={row.reasoningEfforts?.length === 0}
          onNone={(on) => setNoEffort(index(), on)}
          choices={CUSTOM_PROVIDER_REASONING_EFFORTS}
          name={(effort) => t(REASONING_LABEL[effort])}
          chosen={modelEfforts(row)}
          busy={busy()}
          mount={mount()}
          onToggle={(effort, on) => setEffort(index(), effort, on)}
        />
        <ModelChoiceMenu
          label={t("customProvider.model.inputs", { number: index() + 1 })}
          empty={t("customProvider.model.inputsNone")}
          choices={CUSTOM_PROVIDER_HARNESS_INPUT_KINDS[harness()]}
          name={(kind) => t(INPUT_KIND_LABEL[kind])}
          chosen={modelInputs(row)}
          busy={busy()}
          mount={mount()}
          onToggle={(kind, on) => setInput(index(), kind, on)}
        />
      </>
    ),
  };
  const modelsTable = () => (props.contextWindows ? modelTable : undefined);
  const dialogClass = () =>
    props.contextWindows ? "custom-provider-dialog custom-provider-dialog-wide" : "custom-provider-dialog";

  const headerColumns: readonly [RepeatableColumn<HeaderRow>, RepeatableColumn<HeaderRow>] = [
    {
      label: (number) => t("customProvider.header.name", { number }),
      placeholder: () => HEADER_NAME_PLACEHOLDER,
      maxlength: INPUT_LIMITS.identifier,
      identifier: true,
      read: (row) => row.name,
      write: (index, value) =>
        setDraft((state) => {
          const header = state.headers[index];
          if (header) header.name = value;
        }),
    },
    {
      label: (number) => t("customProvider.header.value", { number }),
      placeholder: (row) =>
        keepsHeaderValue(row)
          ? t("customProvider.header.keptPlaceholder")
          : t("customProvider.header.valuePlaceholder"),
      maxlength: CUSTOM_PROVIDER_LIMITS.apiKey,
      identifier: true,
      read: (row) => row.value,
      write: (index, value) =>
        setDraft((state) => {
          const header = state.headers[index];
          if (header) header.value = value;
        }),
    },
  ];

  const discoveryFailed = () => {
    const state = discovery();
    return state.status === "failed" ? state.message : undefined;
  };
  const discovered = () => {
    const state = discovery();
    return state.status === "found" ? state.models : undefined;
  };
  const listed = (id: string) => draft.models.some((model) => model.id.trim() === id);

  createEffect(discovery, (list) => {
    if (list.status === "loading") return;
    const fill = fillNextList;
    fillNextList = false;
    if (!fill || list.status !== "found") return;
    const models = list.models;
    if (models.length > 0) setPicking(true);
    if (!untrack(() => props.contextWindows)) return;
    setDraft((state) => {
      for (const row of state.models) {
        const found = models.find((model) => model.id === row.id.trim());
        if (found) fillFoundValues(row, found, format);
      }
    });
  });

  const [picking, setPicking] = createSignal(false);
  const full = () => draft.models.filter((row) => !blankModel(row)).length >= CUSTOM_PROVIDER_LIMITS.models;

  function addRow(state: CustomProviderDraft, model: DiscoveredModel): void {
    if (state.models.some((row) => row.id.trim() === model.id)) return;
    const row = {
      id: model.id,
      name: model.name ?? model.id,
      contextWindow: model.contextWindow === undefined ? "" : tokenCountText(model.contextWindow, format),
      maxOutput: model.maxOutput === undefined ? "" : tokenCountText(model.maxOutput, format),
      ...(model.reasoningEfforts ? { reasoningEfforts: [...model.reasoningEfforts] } : {}),
      ...(model.inputs ? { inputs: [...model.inputs] } : {}),
    };
    const blank = state.models.findIndex(blankModel);
    if (blank >= 0) state.models[blank] = row;
    else state.models.push(row);
  }

  function removeRow(state: CustomProviderDraft, model: DiscoveredModel): void {
    const index = state.models.findIndex((row) => row.id.trim() === model.id);
    if (index >= 0) state.models.splice(index, 1);
    if (state.models.length === 0) state.models.push({ id: "", name: "" });
  }

  function toggleModel(model: DiscoveredModel, checked: boolean): void {
    setDraft((state) => {
      if (checked) addRow(state, model);
      else removeRow(state, model);
    });
  }

  function toggleModels(models: readonly DiscoveredModel[], checked: boolean): void {
    setDraft((state) => {
      for (const model of models) {
        if (!checked) {
          removeRow(state, model);
          continue;
        }
        if (state.models.some((row) => row.id.trim() === model.id)) continue;
        if (state.models.filter((row) => !blankModel(row)).length >= CUSTOM_PROVIDER_LIMITS.models) break;
        addRow(state, model);
      }
    });
  }

  function submit(): void {
    setSubmitted(true);
    if (busy() || hasCustomProviderError(errors())) return;
    const value = customProviderValue(draft);
    props.onSubmit(props.harnesses ? { ...value, harness: harness() } : value);
  }

  return (
    <Dialog.Root open={props.open} onOpenChange={(open) => !open && props.onCancel()}>
      <Dialog.Portal>
        <Dialog.Overlay class="custom-provider-backdrop">
          <Dialog.Content as="section" class={dialogClass()} aria-busy={busy() ? "true" : undefined} ref={setMount}>
            <Dialog.Title class="sr-only">
              {props.providerIdLocked ? t("customProvider.form.editTitle") : t("customProvider.form.title")}
            </Dialog.Title>
            <Dialog.Description class="sr-only">{t("customProvider.form.description")}</Dialog.Description>

            <header class="custom-provider-header">
              <Show when={props.onBack}>
                <IconButton
                  label={t("common.back")}
                  variant="ghost"
                  disabled={busy()}
                  data-cuelume-tap="navigate"
                  onClick={() => props.onBack?.()}
                >
                  <ArrowLeft />
                </IconButton>
              </Show>
              <span class="custom-provider-mark" aria-hidden="true">
                <SlidersHorizontal />
              </span>
              <div class="custom-provider-title">
                <Heading as="h2" size="md">
                  {t("customProvider.form.heading")}
                </Heading>
                <Text tone="muted" variant="caption">
                  {t("customProvider.form.subtitle")}
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
                <div class="custom-provider-fields">
                  <Field
                    label={t("customProvider.field.providerId")}
                    description={t("customProvider.field.providerIdHint")}
                    error={shown()?.providerId}
                    required
                  >
                    <Input
                      value={draft.providerId}
                      onValueChange={(value) =>
                        setDraft((state) => {
                          state.providerId = value;
                        })
                      }
                      placeholder={PROVIDER_ID_PLACEHOLDER}
                      autocomplete="off"
                      spellcheck={false}
                      maxlength={INPUT_LIMITS.identifier}
                      disabled={busy() || Boolean(props.providerIdLocked)}
                    />
                  </Field>

                  <Field label={t("customProvider.field.displayName")} error={shown()?.displayName} required>
                    <Input
                      value={draft.displayName}
                      onValueChange={(value) =>
                        setDraft((state) => {
                          state.displayName = value;
                        })
                      }
                      placeholder={t("customProvider.field.displayNamePlaceholder")}
                      maxlength={INPUT_LIMITS.agentName}
                      disabled={busy()}
                    />
                  </Field>

                  <Field label={t("customProvider.field.baseUrl")} error={shown()?.baseUrl} required>
                    <Input
                      value={draft.baseUrl}
                      onValueChange={(value) =>
                        setDraft((state) => {
                          state.baseUrl = value;
                        })
                      }
                      placeholder={BASE_URL_PLACEHOLDER}
                      inputmode="url"
                      autocomplete="off"
                      spellcheck={false}
                      maxlength={CUSTOM_PROVIDER_LIMITS.baseUrl}
                      disabled={busy()}
                    />
                  </Field>

                  <Show when={props.harnesses}>
                    {(choices) => (
                      <Field
                        label={t("customProvider.field.harness")}
                        description={t("customProvider.field.harnessHint")}
                        error={props.harnessError || undefined}
                      >
                        <Select<CustomProviderHarness>
                          options={choices()
                            .filter(
                              (choice) =>
                                choice.ready ||
                                choice.id === harness() ||
                                (props.onDownloadHarness && harnessDownload(choice)),
                            )
                            .map((choice) => choice.id)}
                          value={harness()}
                          onChange={(next) => {
                            const chosen = next ?? harness();
                            setDraft((state) => {
                              state.harness = chosen;
                            });
                            if (startsDownload(harnessDownload(choiceOf(chosen)))) props.onDownloadHarness?.(chosen);
                          }}
                          disabled={busy()}
                          placement="bottom-start"
                          itemComponent={(itemProps) => (
                            <SelectItem
                              item={itemProps.item}
                              class="custom-provider-harness-item"
                              data-action={harnessDownload(choiceOf(itemProps.item.rawValue)) ? "" : undefined}
                            >
                              <HarnessLabel harness={itemProps.item.rawValue} />
                              <Show when={harnessDownload(choiceOf(itemProps.item.rawValue))}>
                                {(phase) => (
                                  <Show
                                    when={startsDownload(phase())}
                                    fallback={
                                      <Text tone="muted" variant="caption" class="custom-provider-harness-action">
                                        {downloadText(phase(), choiceOf(itemProps.item.rawValue).runtime?.progress)}
                                      </Text>
                                    }
                                  >
                                    <span
                                      class={buttonVariants({
                                        variant: "default",
                                        size: "xs",
                                        class: "custom-provider-harness-action custom-provider-harness-button",
                                      })}
                                    >
                                      <Show when={phase() === "not-downloaded"}>
                                        <Download aria-hidden="true" />
                                      </Show>
                                      {downloadText(phase(), null)}
                                    </span>
                                  </Show>
                                )}
                              </Show>
                            </SelectItem>
                          )}
                        >
                          <SelectTrigger size="sm" aria-label={t("customProvider.field.harness")}>
                            <SelectValue<CustomProviderHarness> class="custom-provider-harness-value">
                              {(state) => (
                                <>
                                  <HarnessLabel harness={state.selectedOption()} />
                                  <Show when={downloading(state.selectedOption())}>
                                    {(phase) => (
                                      <span class="custom-provider-harness-progress">
                                        <Spinner size="sm" />
                                        {downloadText(phase(), choiceOf(state.selectedOption()).runtime?.progress)}
                                      </span>
                                    )}
                                  </Show>
                                </>
                              )}
                            </SelectValue>
                          </SelectTrigger>
                          <SelectContent mount={mount()} />
                        </Select>
                      </Field>
                    )}
                  </Show>

                  <Field
                    label={t("customProvider.field.apiKey")}
                    description={
                      props.apiKeyKept ? t("customProvider.field.apiKeyKeptHint") : t("customProvider.field.apiKeyHint")
                    }
                    error={shown()?.apiKey}
                  >
                    <Input
                      type="password"
                      value={draft.apiKey}
                      onValueChange={(value) =>
                        setDraft((state) => {
                          state.apiKey = value;
                        })
                      }
                      autocomplete="off"
                      spellcheck={false}
                      maxlength={CUSTOM_PROVIDER_LIMITS.apiKey}
                      disabled={busy()}
                    />
                  </Field>
                </div>

                <RepeatableRows
                  label={t("customProvider.models")}
                  removeLabel={(number) => t("customProvider.model.remove", { number })}
                  addLabel={t("customProvider.model.add")}
                  columns={modelColumns()}
                  rows={draft.models}
                  limit={CUSTOM_PROVIDER_LIMITS.models}
                  busy={busy()}
                  sectionError={shown()?.models}
                  rowError={(index) => shown()?.modelRows[index]}
                  table={modelsTable()}
                  onAdd={() =>
                    setDraft((state) => {
                      state.models.push({ id: "", name: "" });
                    })
                  }
                  onRemove={(index) =>
                    setDraft((state) => {
                      state.models.splice(index, 1);
                    })
                  }
                  action={
                    <Show when={props.onDiscoverModels}>
                      {(discover) => (
                        <Button
                          type="button"
                          variant="ghost"
                          size="xs"
                          class="custom-provider-discover"
                          disabled={busy() || !draft.baseUrl.trim() || discovery().status === "loading"}
                          onClick={() => {
                            fillNextList = true;
                            discover()(customProviderEndpoint(draft));
                          }}
                        >
                          <RefreshCw />
                          {discovery().status === "idle"
                            ? t("customProvider.discovery.find")
                            : t("customProvider.discovery.refresh")}
                        </Button>
                      )}
                    </Show>
                  }
                >
                  <Switch>
                    <Match when={discovery().status === "loading"}>
                      <div class="custom-provider-discovery-status" role="status">
                        <Spinner size="sm" />
                        <Text tone="muted" variant="caption">
                          {t("customProvider.discovery.loading", { url: draft.baseUrl.trim() })}
                        </Text>
                      </div>
                    </Match>
                    <Match when={discoveryFailed()}>
                      {(message) => (
                        <Text class="custom-provider-rows-error" tone="danger" variant="caption" role="alert">
                          {message()}
                        </Text>
                      )}
                    </Match>
                    <Match when={discovered()}>
                      {(models) => (
                        <Show
                          when={models().length > 0}
                          fallback={
                            <Text tone="muted" variant="caption" role="status">
                              {t("customProvider.discovery.empty")}
                            </Text>
                          }
                        >
                          <Text tone="muted" variant="caption" role="status">
                            {t("customProvider.discovery.found", { count: models().length })}
                          </Text>
                          <Show
                            when={
                              props.contextWindows &&
                              draft.models.some((row) =>
                                models().some((model) => model.id === row.id.trim() && holdsFoundValues(row, model)),
                              )
                            }
                          >
                            <Text tone="muted" variant="caption">
                              {t("customProvider.model.foundValuesHint")}
                            </Text>
                          </Show>
                          <FoundModelPicker
                            models={models()}
                            listed={listed}
                            full={full()}
                            busy={busy()}
                            open={picking()}
                            mount={mount()}
                            onOpenChange={setPicking}
                            onToggle={toggleModel}
                            onToggleAll={toggleModels}
                          />
                        </Show>
                      )}
                    </Match>
                  </Switch>
                </RepeatableRows>

                <RepeatableRows
                  label={t("customProvider.headers")}
                  removeLabel={(number) => t("customProvider.header.remove", { number })}
                  addLabel={t("customProvider.header.add")}
                  columns={headerColumns}
                  rows={draft.headers}
                  limit={CUSTOM_PROVIDER_LIMITS.headers}
                  busy={busy()}
                  rowError={(index) => shown()?.headerRows[index]}
                  onAdd={() =>
                    setDraft((state) => {
                      state.headers.push({ name: "", value: "" });
                    })
                  }
                  onRemove={(index) =>
                    setDraft((state) => {
                      state.headers.splice(index, 1);
                    })
                  }
                />
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
                  {t("customProvider.submit")}
                </Button>
              </footer>
            </form>
          </Dialog.Content>
        </Dialog.Overlay>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function HarnessLabel(props: { harness: CustomProviderHarness }) {
  return (
    <span class="custom-provider-harness">
      <ProviderLogo provider={props.harness} class="provider-picker-logo" />
      {agentProviderName(props.harness)}
    </span>
  );
}
