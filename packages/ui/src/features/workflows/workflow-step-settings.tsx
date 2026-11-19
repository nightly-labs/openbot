import {
  AGENT_REASONING_EFFORTS,
  WORKFLOW_RUNTIME_FIELDS,
  type WorkflowFields,
  type WorkflowNodeKind,
  type WorkflowStepSettings,
  type WorkflowStepSource,
} from "@openbot/contracts/ipc";
import type { AppTranslate } from "@openbot/i18n";
import { Button, CopyButton, Popover, Skeleton, SlidersHorizontal } from "@openbot/ui";
import type { JSX } from "@solidjs/web";
import { createSignal, createStore, For, Match, onSettled, Show, Switch } from "solid-js";
import { useText } from "../../text";
import { PORT_NAME, useBoard, type WfnBoard, type WfnFields, type WfnResult } from "./workflow-board";
import type { WorkflowCatalogs } from "./workflow-model";
import { EFFORT_LABEL, modelOption } from "./workflow-model-pills";
import { PortIcon, resultName, resultTime, ToolAction } from "./workflow-node-parts";

interface SettingLine {
  key: string;
  label: string;
  value: string;
  long?: boolean;
}

interface SettingsView {
  open: boolean;
  result: WfnResult | null;
  phase: "loading" | "ready" | "failed";
  saved: WorkflowStepSettings | null;
  message: string;
}

function settingLines(
  t: AppTranslate,
  catalogs: WorkflowCatalogs,
  kind: WorkflowNodeKind,
  settings: WorkflowFields,
): SettingLine[] {
  const text = (key: string) => {
    const value = settings[key];
    return value === undefined ? undefined : String(value);
  };
  const imageModel = () => catalogs.imageModels.find((model) => model.id === text("model"));
  const line = (key: string, label: string, value: string | undefined, long?: boolean): SettingLine[] =>
    value === undefined ? [] : [{ key, label, value, ...(long ? { long } : {}) }];
  const named = (key: string): SettingLine[] => {
    const value = text(key);
    switch (key) {
      case "agentId":
        return line(
          key,
          t("workflow.agent.title"),
          value === undefined
            ? undefined
            : (catalogs.agents.find((agent) => agent.id === value)?.name ?? t("workflow.agent.removed")),
        );
      case "task":
        return line(key, t("workflow.agent.task"), value, true);
      case "model":
        return line(
          key,
          t("provider.picker.model"),
          kind === "image"
            ? (imageModel()?.name ?? value)
            : value === undefined
              ? undefined
              : (modelOption(catalogs.models, value)?.name ?? value),
        );
      case "effort": {
        const effort = AGENT_REASONING_EFFORTS.find((choice) => choice === value);
        return line(key, t("provider.picker.effort"), effort ? t(EFFORT_LABEL[effort]) : value);
      }
      case "account":
        return line(
          key,
          t("workflow.media.payers"),
          value === undefined ? undefined : (imageModel()?.accounts?.find((row) => row.id === value)?.label ?? value),
        );
      case "prompt":
        return line(key, t("workflow.prompt.title"), value, true);
      case "system":
        return line(key, t("workflow.llm.system"), value, true);
      case "rule":
        return line(key, t("workflow.condition.rule"), value, true);
      case "aspect":
        return line(key, t("workflow.image.aspect"), value === "custom" ? undefined : value);
      case "width": {
        const height = text("height");
        return line(
          "size",
          t("workflow.image.size"),
          value === undefined || height === undefined
            ? undefined
            : t("workflow.image.sizeValue", { width: value, height }),
        );
      }
      case "background":
        return line(
          key,
          t("workflow.image.background"),
          value === "transparent"
            ? t("workflow.image.background.transparent")
            : value === "solid"
              ? t("workflow.image.background.solid")
              : value,
        );
      case "duration":
        return line(
          key,
          t("workflow.video.length"),
          value === undefined ? undefined : t("workflow.video.seconds", { value }),
        );
      case "resolution":
        return line(key, t("workflow.video.resolution"), value);
      case "voice":
        return line(key, t("workflow.video.voice"), value);
      default:
        return [];
    }
  };
  return WORKFLOW_RUNTIME_FIELDS[kind].flatMap(named);
}

function restoredFields(kind: WorkflowNodeKind, settings: WorkflowFields): WfnFields {
  return Object.fromEntries(WORKFLOW_RUNTIME_FIELDS[kind].map((key) => [key, settings[key] ?? ""]));
}

function inUse(board: WfnBoard, id: string, fields: WfnFields): boolean {
  return Object.entries(fields).every(([key, value]) => (board.field(id, key) ?? "") === value);
}

function sourceName(t: AppTranslate, settings: WorkflowFields, source: WorkflowStepSource): string {
  if (source.type !== "image") return t(PORT_NAME[source.type]);
  const first = settings.firstFrame === source.from;
  const last = settings.lastFrame === source.from;
  if (first && last) return t("workflow.video.role.both");
  if (first) return t("workflow.video.role.first");
  if (last) return t("workflow.video.role.last");
  return t(PORT_NAME.image);
}

function ClampedText(props: { value: string }) {
  const { t } = useText();
  const [open, setOpen] = createSignal(false);
  const [overflows, setOverflows] = createSignal(false);
  let body: HTMLDivElement | undefined;
  onSettled(() => {
    if (body) setOverflows(body.scrollHeight > body.clientHeight + 1);
  });
  return (
    <div class="wfn-step-text" data-clamped={overflows() && !open() ? "" : undefined}>
      <div ref={body} class="wfn-step-text-body" data-open={open() ? "" : undefined}>
        {props.value}
      </div>
      <Show when={overflows()}>
        <Button
          variant="link"
          size="xs"
          class="wfn-step-text-toggle"
          aria-expanded={open() ? "true" : "false"}
          onClick={() => {
            setOpen((value) => !value);
          }}
        >
          {open() ? t("workflow.node.settings.showLess") : t("workflow.node.settings.showMore")}
        </Button>
      </Show>
    </div>
  );
}

function TextBlock(props: { title: JSX.Element; value: string }) {
  return (
    <section class="wfn-step-block">
      <div class="wfn-step-block-head">
        <h3 class="wfn-step-block-title">{props.title}</h3>
        <CopyButton class="wfn-step-block-copy" value={props.value} iconOnly size="icon-xs" />
      </div>
      <ClampedText value={props.value} />
    </section>
  );
}

function SourceRow(props: { source: WorkflowStepSource; settings: WorkflowFields }) {
  const board = useBoard();
  const { t } = useText();
  const picture = () => {
    const attachment = props.source.attachmentId;
    return attachment ? (board.catalogs().mediaPreview?.(attachment) ?? undefined) : undefined;
  };
  const sent = () => {
    if (props.source.type !== "text") return undefined;
    const step = props.source.stepId;
    return board.results(props.source.from).find((result) => result.id === step && !result.failed)?.value;
  };
  const title = () => (
    <span class="wfn-step-source-head">
      <PortIcon type={props.source.type} />
      {sourceName(t, props.settings, props.source)}
    </span>
  );
  return (
    <li class="wfn-step-source">
      <Show when={sent()} fallback={<h3 class="wfn-step-block-title">{title()}</h3>}>
        {(value) => <TextBlock title={title()} value={value()} />}
      </Show>
      <Show when={picture()}>{(src) => <img class="wfn-step-source-picture" src={src()} alt="" />}</Show>
    </li>
  );
}

export function StepSettingsAction(props: { id: string; kind: WorkflowNodeKind }) {
  const board = useBoard();
  const { t, format } = useText();
  const [view, setView] = createStore<SettingsView>({
    open: false,
    result: null,
    phase: "loading",
    saved: null,
    message: "",
  });
  const known = new Map<string, WorkflowStepSettings>();
  let trigger: HTMLButtonElement | undefined;
  const available = () => board.catalogs().stepSettings !== undefined && board.shown(props.id) !== undefined;
  const load = (result: WfnResult) => {
    const read = board.catalogs().stepSettings;
    const cached = known.get(result.id);
    setView((draft) => {
      draft.open = true;
      draft.result = result;
      draft.phase = cached ? "ready" : "loading";
      draft.saved = cached ?? null;
    });
    if (cached || !read) return;
    read(result.id).then(
      (saved) => {
        known.set(result.id, saved);
        if (view.result?.id !== result.id) return;
        setView((draft) => {
          draft.phase = "ready";
          draft.saved = saved;
        });
      },
      (error: unknown) => {
        if (view.result?.id !== result.id) return;
        setView((draft) => {
          draft.phase = "failed";
          draft.message = error instanceof Error && error.message ? error.message : t("workflow.node.settings.failed");
        });
      },
    );
  };
  const toggle = () => {
    const result = board.shown(props.id);
    if (view.open || !result) {
      setView((draft) => {
        draft.open = false;
      });
      return;
    }
    load(result);
  };
  const recorded = () => view.saved?.settings ?? undefined;
  const recordedFields = () => recorded() ?? {};
  const lines = () => {
    const settings = recorded();
    return settings ? settingLines(t, board.catalogs(), props.kind, settings) : [];
  };
  const facts = () => lines().filter((line) => !line.long);
  const texts = () => lines().filter((line) => line.long);
  const sources = () => view.saved?.sources ?? [];
  const restored = () => {
    const settings = recorded();
    return settings ? restoredFields(props.kind, settings) : undefined;
  };
  const usable = () => {
    const fields = restored();
    return fields !== undefined && !board.isLocked(props.id) && !inUse(board, props.id, fields);
  };
  const use = () => {
    const fields = restored();
    if (!fields || !usable()) return;
    board.setFields(props.id, fields);
    setView((draft) => {
      draft.open = false;
    });
  };
  const when = () => {
    const result = view.result;
    return result
      ? t("workflow.node.result.hint", { name: resultName(t, result), time: resultTime(format, result.at) })
      : "";
  };
  return (
    <Show when={available()}>
      <ToolAction
        text={t("workflow.node.settings.open")}
        label={t("workflow.node.settings.openLabel")}
        icon={<SlidersHorizontal />}
        expanded={view.open}
        ref={(element) => {
          trigger = element;
        }}
        onClick={toggle}
      />
      <Popover.Root
        open={view.open}
        onOpenChange={(open: boolean) =>
          setView((draft) => {
            draft.open = open;
          })
        }
        anchorRef={() => trigger}
        placement="bottom-start"
        gutter={8}
      >
        <Popover.Portal>
          <Popover.Content
            class="ui-popover-menu-surface wfn-popover wfn-step-settings"
            data-wfn-portal=""
            onInteractOutside={(event) => {
              if (event.target instanceof Node && trigger?.contains(event.target)) event.preventDefault();
            }}
          >
            <header class="wfn-step-settings-head">
              <Popover.Title class="wfn-popover-title">{t("workflow.node.settings.title")}</Popover.Title>
              <span class="wfn-step-settings-when">{when()}</span>
            </header>
            <Switch>
              <Match when={view.phase === "loading"}>
                <div class="wfn-step-settings-body">
                  <Skeleton class="wfn-step-settings-loading" />
                </div>
              </Match>
              <Match when={view.phase === "failed"}>
                <p class="wfn-step-settings-body wfn-step-settings-note">{view.message}</p>
              </Match>
              <Match when={recorded() === undefined}>
                <p class="wfn-step-settings-body wfn-step-settings-note">{t("workflow.node.settings.notRecorded")}</p>
              </Match>
              <Match when={view.phase === "ready"}>
                <div class="wfn-step-settings-body">
                  <Show when={facts().length > 0}>
                    <dl class="wfn-step-facts">
                      <For each={facts()}>
                        {(line) => (
                          <div class="wfn-step-fact">
                            <dt>{line.label}</dt>
                            <dd title={line.value}>{line.value}</dd>
                          </div>
                        )}
                      </For>
                    </dl>
                  </Show>
                  <For each={texts()}>{(line) => <TextBlock title={line.label} value={line.value} />}</For>
                  <Show when={sources().length > 0}>
                    <section class="wfn-step-sources">
                      <h3 class="wfn-step-sources-title">{t("workflow.node.settings.inputs")}</h3>
                      <ul>
                        <For each={sources()}>
                          {(source) => <SourceRow source={source} settings={recordedFields()} />}
                        </For>
                      </ul>
                    </section>
                  </Show>
                </div>
                <footer class="wfn-step-settings-foot">
                  <Button size="sm" variant="secondary" disabled={!usable()} onClick={use}>
                    {t("workflow.node.settings.use")}
                  </Button>
                </footer>
              </Match>
            </Switch>
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
    </Show>
  );
}
