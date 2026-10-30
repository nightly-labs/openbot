import type { WorkflowRunDetail } from "@openbot/contracts/ipc";
import { Typography } from "heroui-native";
import { SettingsRow } from "@/features/settings/components/settings-content";
import { runStatusClass } from "@/features/workflows/components/workflow-row";
import { formatRunDuration } from "@/features/workflows/model/workflow-duration";
import { RUN_STATUS_LABEL } from "@/features/workflows/model/workflow-steps";
import { formatUpdatedAt } from "@/shared/lib/format-updated-at";
import { useText } from "@/shared/lib/text";
import { typeScale } from "@/shared/lib/type-scale";

/** A run in a Runs group: its number, its status and when it started. */
export function WorkflowRunRow({ detail, onPress }: { detail: WorkflowRunDetail; onPress: () => void }) {
  const { t, format } = useText();
  const { run } = detail;
  const duration = formatRunDuration(run.startedAt, run.endedAt, t);
  return (
    <SettingsRow onPress={onPress}>
      <Typography.Paragraph>{t("mobile.workflow.run.title", { number: run.number })}</Typography.Paragraph>
      <Typography.Paragraph
        className={runStatusClass({ status: run.status, at: run.startedAt })}
        style={typeScale.caption}
      >
        {[t(RUN_STATUS_LABEL[run.status]), formatUpdatedAt(run.startedAt, format), duration]
          .filter(Boolean)
          .join(" · ")}
      </Typography.Paragraph>
      {run.error ? (
        <Typography.Paragraph className="text-danger-text" numberOfLines={2} style={typeScale.caption}>
          {run.error}
        </Typography.Paragraph>
      ) : null}
    </SettingsRow>
  );
}
