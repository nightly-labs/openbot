import {
  WORKFLOW_MEDIA_CUSTOM_ASPECT,
  type WorkflowMediaModel,
  type WorkflowNode,
  workflowMediaResolutions,
  workflowVideoDurations,
  workflowVideoLengthChoices,
} from "@openbot/contracts/ipc";
import { Typography } from "heroui-native";
import { useUniwind } from "uniwind";
import { SettingsRow, SettingsSection } from "@/features/settings/components/settings-content";
import { SettingsPicker } from "@/features/settings/components/settings-controls";
import { mediaChoice, useMediaCredits } from "@/features/workflows/model/use-media-credits";
import { useWorkflowDraft, type WorkflowDraft } from "@/features/workflows/model/workflow-draft";
import { fieldText } from "@/features/workflows/model/workflow-node-fields";
import { useMobileWorkspaceSelector } from "@/features/workspace/context/mobile-workspace-context";
import { SheetFormField } from "@/shared/components/sheet-form-field";
import { useText } from "@/shared/lib/text";

const FIELD_LIMIT = 20_000;

interface Choice<T extends string | number> {
  value: T;
  label: string;
}

function withSaved<T extends string | number>(options: Choice<T>[], saved: Choice<T> | null): Choice<T>[] {
  return saved === null || options.some((option) => option.value === saved.value) ? options : [...options, saved];
}

function PickerRow<T extends string | number>({
  label,
  value,
  options,
  enabled = true,
  onChange,
}: {
  label: string;
  value: T;
  options: Choice<T>[];
  enabled?: boolean;
  onChange: (value: T) => void;
}) {
  const { theme } = useUniwind();
  return (
    <SettingsRow
      trailing={
        <SettingsPicker<T>
          value={value}
          enabled={enabled}
          dark={theme === "dark"}
          label={label}
          options={options}
          onChange={onChange}
        />
      }
    >
      <Typography.Paragraph>{label}</Typography.Paragraph>
    </SettingsRow>
  );
}

function modelLabel(option: WorkflowMediaModel, t: ReturnType<typeof useText>["t"]): string {
  return option.credits
    ? t("mobile.workflow.media.creditModelLabel", { name: option.name, source: option.subscription })
    : t("mobile.workflow.media.modelLabel", { name: option.name, source: option.subscription });
}

export function MediaFields({ node, draft }: { node: WorkflowNode; draft: WorkflowDraft }) {
  const { t, format } = useText();
  const setFields = useWorkflowDraft((state) => state.setFields);
  const sizeHost = useMobileWorkspaceSelector((current) => current.canUseWorkflowMediaSize(draft.serverId));
  const { byNode, available, catalog } = useMediaCredits(draft.serverId, [node]);
  const { kind, models, model, hostAspects, specs } = mediaChoice(node, catalog.data ?? [], sizeHost);
  const savedModel = fieldText(node, "model");
  const custom = kind === "image" && sizeHost && fieldText(node, "aspect") === WORKFLOW_MEDIA_CUSTOM_ASPECT;
  const aspect = custom
    ? WORKFLOW_MEDIA_CUSTOM_ASPECT
    : hostAspects.includes(specs.aspect)
      ? specs.aspect
      : (hostAspects[0] ?? "");
  const durations = workflowVideoDurations(model);
  const resolutions = workflowMediaResolutions(model, kind);
  const seconds = (value: number) => t("mobile.workflow.duration.seconds", { seconds: value });
  const price = byNode.get(node.id);
  const credits = price?.credits ?? null;
  const short = price?.short ?? false;
  const amount = (count: number) => t("mobile.workflow.media.credits", { count, amount: format.number(count) });

  return (
    <>
      <SheetFormField
        label={t("mobile.workflow.step.prompt")}
        multiline
        maxLength={FIELD_LIMIT}
        autoCapitalize="sentences"
        placeholder={t(kind === "video" ? "mobile.workflow.step.videoDefault" : "mobile.workflow.step.imageDefault")}
        value={fieldText(node, "prompt")}
        onChangeText={(value) => setFields(node.id, { prompt: value })}
      />
      <SettingsSection
        title={t("mobile.workflow.media.settings")}
        footer={
          catalog.isError
            ? t("mobile.workflow.step.modelsFailed")
            : short && available !== null
              ? t("mobile.workflow.media.notEnough", { available: amount(available) })
              : undefined
        }
      >
        <PickerRow<string>
          label={t("mobile.workflow.step.model")}
          value={savedModel}
          enabled={!catalog.isLoading}
          options={withSaved(
            [
              { value: "", label: t("mobile.workflow.media.automatic") },
              ...models.map((option) => ({ value: option.id, label: modelLabel(option, t) })),
            ],
            savedModel ? { value: savedModel, label: model?.id === savedModel ? model.name : savedModel } : null,
          )}
          onChange={(next) => setFields(node.id, { model: next || undefined, account: undefined })}
        />
        {hostAspects.length > 0 ? (
          <PickerRow<string>
            label={t("mobile.workflow.media.aspect")}
            value={aspect}
            options={withSaved(
              hostAspects.map((value) => ({ value, label: value })),
              custom ? { value: WORKFLOW_MEDIA_CUSTOM_ASPECT, label: t("mobile.workflow.media.customSize") } : null,
            )}
            onChange={(next) => setFields(node.id, { aspect: next })}
          />
        ) : null}
        {kind === "video" && durations.length > 1 ? (
          <PickerRow<number>
            label={t("mobile.workflow.media.length")}
            value={specs.duration}
            options={withSaved(
              workflowVideoLengthChoices(durations).map((value) => ({ value, label: seconds(value) })),
              { value: specs.duration, label: seconds(specs.duration) },
            ).sort((left, right) => left.value - right.value)}
            onChange={(next) => setFields(node.id, { duration: next })}
          />
        ) : null}
        {kind === "video" && resolutions.length > 1 ? (
          <PickerRow<string>
            label={t("mobile.workflow.media.resolution")}
            value={specs.resolution ?? ""}
            options={resolutions.map((value) => ({ value, label: value }))}
            onChange={(next) => setFields(node.id, { resolution: next })}
          />
        ) : null}
        {credits !== null ? (
          <SettingsRow
            disclosure={false}
            trailing={
              <Typography.Paragraph className={short ? "font-medium text-danger-text" : "text-grouped-secondary"}>
                {amount(credits)}
              </Typography.Paragraph>
            }
          >
            <Typography.Paragraph>{t("mobile.workflow.media.price")}</Typography.Paragraph>
          </SettingsRow>
        ) : null}
      </SettingsSection>
    </>
  );
}
