import type { WorkflowNode, WorkflowStep } from "@openbot/contracts/ipc";
import { Button, Typography } from "heroui-native";
import { useState } from "react";
import { Pressable, View } from "react-native";
import { WorkflowKindTile } from "@/features/workflows/components/workflow-kind-tile";
import { STEP_STATUS_LABEL, stepLabel, stepText, triggerType } from "@/features/workflows/model/workflow-steps";
import type { MobileAgent } from "@/features/workspace/model/workspace-types";
import { haptics } from "@/shared/lib/haptics";
import { useText } from "@/shared/lib/text";
import { typeScale } from "@/shared/lib/type-scale";

const STATUS_CLASS: Record<WorkflowStep["status"], string> = {
  running: "text-accent-text",
  approval: "text-warning-text",
  done: "text-success-text",
  failed: "text-danger-text",
  stopped: "text-text-secondary",
  skipped: "text-text-secondary",
};

/**
 * One step of a run, or a step that ran alone: its status and output. The person approves or declines
 * a step that waits, retries a step that failed, and stops a step that runs.
 */
export function WorkflowRunStepRow({
  node,
  step,
  agents,
  busy,
  onDecide,
  onRetry,
  onStop,
}: {
  node: WorkflowNode;
  step: WorkflowStep | undefined;
  agents: readonly MobileAgent[];
  busy: boolean;
  onDecide: (step: WorkflowStep, approved: boolean) => void;
  onRetry: (step: WorkflowStep) => void;
  onStop: (step: WorkflowStep) => void;
}) {
  const { t } = useText();
  const [open, setOpen] = useState(false);
  const status = step?.status;
  const output = step?.output?.trim() ? step.output : null;
  return (
    <View className={`flex-row gap-3 px-4 py-3 ${status === "skipped" || !status ? "opacity-60" : ""}`}>
      <WorkflowKindTile kind={node.kind} trigger={node.kind === "trigger" ? triggerType(node) : undefined} size={30} />
      <View className="min-w-0 flex-1 gap-1">
        <View className="flex-row items-center justify-between gap-2">
          <Typography.Paragraph
            className="min-w-0 shrink text-text-secondary"
            numberOfLines={1}
            style={typeScale.small}
          >
            {stepLabel(node, agents, t)}
          </Typography.Paragraph>
          <Typography.Paragraph
            className={status ? STATUS_CLASS[status] : "text-text-secondary"}
            style={typeScale.small}
          >
            {status ? t(STEP_STATUS_LABEL[status]) : t("mobile.workflow.status.notRun")}
          </Typography.Paragraph>
        </View>
        <Typography.Paragraph style={typeScale.preview}>{stepText(node, t)}</Typography.Paragraph>
        {step?.branch ? (
          <Typography.Paragraph className="text-warning-text" style={typeScale.caption}>
            {t(step.branch === "yes" ? "mobile.workflow.run.answerYes" : "mobile.workflow.run.answerNo")}
          </Typography.Paragraph>
        ) : null}
        {step?.error ? (
          <Typography.Paragraph className="text-danger-text" style={typeScale.caption}>
            {step.error}
          </Typography.Paragraph>
        ) : null}
        {output ? (
          <View className="gap-1.5">
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ expanded: open }}
              className="self-start py-0.5"
              onPress={() => {
                void haptics.selection();
                setOpen((current) => !current);
              }}
            >
              <Typography.Paragraph className="font-medium text-accent-text" style={typeScale.caption}>
                {open ? t("mobile.workflow.run.hideOutput") : t("mobile.workflow.run.showOutput")}
              </Typography.Paragraph>
            </Pressable>
            {open ? (
              <View className="rounded-xl bg-control px-3 py-2.5">
                <Typography.Paragraph selectable className="text-text-secondary" style={typeScale.preview}>
                  {output}
                </Typography.Paragraph>
              </View>
            ) : null}
          </View>
        ) : null}
        {step && status === "approval" ? (
          <View className="mt-1 gap-3 rounded-2xl bg-control p-3">
            <Typography.Paragraph className="font-semibold" style={typeScale.body}>
              {stepText(node, t)}
            </Typography.Paragraph>
            <View className="flex-row gap-2">
              <Button className="flex-1" variant="tertiary" isDisabled={busy} onPress={() => onDecide(step, false)}>
                <Button.Label>{t("mobile.workflow.run.decline")}</Button.Label>
              </Button>
              <Button
                className="flex-1 bg-action"
                feedbackVariant="scale"
                isDisabled={busy}
                onPress={() => onDecide(step, true)}
              >
                <Button.Label className="text-action-foreground">{t("mobile.workflow.run.approve")}</Button.Label>
              </Button>
            </View>
          </View>
        ) : null}
        {step && status === "failed" ? (
          <Button
            size="sm"
            variant="tertiary"
            className="mt-1 self-start"
            isDisabled={busy}
            onPress={() => onRetry(step)}
          >
            <Button.Label>{t("mobile.workflow.run.retry")}</Button.Label>
          </Button>
        ) : null}
        {step && status === "running" ? (
          <Button
            size="sm"
            variant="tertiary"
            className="mt-1 self-start"
            isDisabled={busy}
            onPress={() => onStop(step)}
          >
            <Button.Label>{t("mobile.workflow.run.stopStep")}</Button.Label>
          </Button>
        ) : null}
      </View>
    </View>
  );
}
