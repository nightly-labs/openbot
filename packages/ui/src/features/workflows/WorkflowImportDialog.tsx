import {
  matchWorkflowFileReferences,
  type StoredFileRow,
  type WorkflowFile,
  type WorkflowFileReferenceKind,
  type WorkflowGraph,
  workflowFileAssetBytes,
  workflowFromFile,
} from "@openbot/contracts/ipc";
import { ConfirmDialog, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Upload } from "@openbot/ui";
import { createSignal, createStore, For, Show, untrack } from "solid-js";
import { useText } from "../../text";
import { workflowAppLabel, workflowStepLabel } from "./workflow-file-text";

export interface WorkflowImportCandidate {
  id: string;
  name: string;
  title?: string | undefined;
}

export interface WorkflowImportDialogProps {
  file: WorkflowFile;
  agents: readonly WorkflowImportCandidate[];
  channels: readonly WorkflowImportCandidate[];
  paused: boolean;
  upload?: ((file: File) => Promise<StoredFileRow>) | undefined;
  onCancel: () => void;
  onImport: (input: { title: string; graph: WorkflowGraph }) => void;
}

interface ReferenceRow {
  key: string;
  kind: WorkflowFileReferenceKind;
  name: string;
}

const KIND_LABEL = {
  agent: "workflow.file.import.agents",
  channel: "workflow.file.import.channels",
} as const;

const KINDS: readonly WorkflowFileReferenceKind[] = ["agent", "channel"];

function candidateLabel(candidate: WorkflowImportCandidate): string {
  return candidate.title ? `${candidate.name} · ${candidate.title}` : candidate.name;
}

export function WorkflowImportDialog(props: WorkflowImportDialogProps) {
  const { t, errorMessage } = useText();
  const { file, candidates } = untrack(() => ({
    file: props.file,
    candidates: { agent: [...props.agents], channel: [...props.channels] },
  }));
  const later: WorkflowImportCandidate = { id: "", name: "" };
  const options = { agent: [later, ...candidates.agent], channel: [later, ...candidates.channel] };
  const rows: ReferenceRow[] = Object.entries(file.references).map(([key, reference]) => ({
    key,
    kind: reference.kind,
    name: reference.title ? `${reference.name} · ${reference.title}` : reference.name,
  }));
  const [choices, setChoices] = createStore<Record<string, string>>(
    Object.fromEntries(matchWorkflowFileReferences(file, candidates)),
  );
  const assets = Object.entries(file.assets);
  const [error, setError] = createSignal<string>();
  const optionLabel = (candidate: WorkflowImportCandidate) =>
    candidate.id ? candidateLabel(candidate) : t("workflow.file.import.choose");
  const stepLabel = (id: string) => {
    const node = file.graph.nodes.find((candidate) => candidate.id === id);
    return node ? workflowStepLabel(t, node) : id;
  };

  const build = async () => {
    const uploaded = new Map<string, { id: string; name: string }>();
    const upload = props.upload;
    if (upload)
      for (const [key, asset] of assets) {
        const row = await upload(
          new File([new Uint8Array(workflowFileAssetBytes(asset))], asset.name, { type: asset.type }),
        );
        uploaded.set(key, { id: row.id, name: row.name });
      }
    const references = new Map<string, string>();
    for (const row of rows) {
      const id = choices[row.key];
      if (id) references.set(row.key, id);
    }
    props.onImport(workflowFromFile(file, { references, assets: uploaded }));
  };
  const confirm = async () => {
    setError(undefined);
    try {
      await build();
    } catch (cause) {
      setError(errorMessage(cause, t("workflow.file.import.failed")));
    }
  };

  return (
    <ConfirmDialog
      open={true}
      tone="default"
      icon={<Upload />}
      title={t("workflow.file.import.title", { name: file.title })}
      description={props.paused ? t("workflow.file.import.paused") : undefined}
      confirmLabel={t("workflow.file.import.confirm")}
      class="wfi-dialog"
      onCancel={props.onCancel}
      error={error()}
      onConfirm={confirm}
    >
      <For each={KINDS}>
        {(kind) => (
          <Show when={rows.some((row) => row.kind === kind)}>
            <section class="wfi-section">
              <h3 class="wfi-heading">{t(KIND_LABEL[kind])}</h3>
              <For each={rows.filter((row) => row.kind === kind)}>
                {(row) => (
                  <div class="wfi-row">
                    <span class="wfi-name">{row.name}</span>
                    <Select<WorkflowImportCandidate>
                      options={options[row.kind]}
                      optionValue="id"
                      optionTextValue="name"
                      placeholder={t("workflow.file.import.choose")}
                      value={options[row.kind].find((option) => option.id === (choices[row.key] ?? ""))}
                      onChange={(choice) => {
                        const id = choice?.id ?? "";
                        if (id !== (choices[row.key] ?? ""))
                          setChoices((draft) => {
                            draft[row.key] = id;
                          });
                      }}
                      itemComponent={(item) => (
                        <SelectItem item={item.item}>{optionLabel(item.item.rawValue)}</SelectItem>
                      )}
                    >
                      <SelectTrigger class="wfi-trigger" aria-label={row.name}>
                        <SelectValue<WorkflowImportCandidate>>
                          {(state) => {
                            return optionLabel(state.selectedOption() ?? later);
                          }}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent />
                    </Select>
                  </div>
                )}
              </For>
            </section>
          </Show>
        )}
      </For>
      <Show when={file.links.length > 0}>
        <section class="wfi-section">
          <h3 class="wfi-heading">{t("workflow.file.import.links")}</h3>
          <ul>
            <For each={file.links}>
              {(link) => (
                <li>
                  {t("workflow.file.import.link", { step: stepLabel(link.node), app: workflowAppLabel(t, link.app) })}
                </li>
              )}
            </For>
          </ul>
        </section>
      </Show>
      <Show when={assets.length > 0}>
        <p class="wfi-note">
          {props.upload
            ? t("workflow.file.import.files", { count: assets.length })
            : t("workflow.file.import.noUpload")}
        </p>
      </Show>
    </ConfirmDialog>
  );
}
