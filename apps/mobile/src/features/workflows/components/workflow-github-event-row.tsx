import type { WorkflowGitHubDelivery, WorkflowGitHubHistory, WorkflowRun } from "@openbot/contracts/ipc";
import type { MobileTranslate } from "@openbot/i18n/mobile";
import { Typography } from "heroui-native";
import { Linking } from "react-native";
import { SettingsRow } from "@/features/settings/components/settings-content";
import {
  GITHUB_EVENT_LABEL,
  GITHUB_SKIP_LABEL,
  githubItemLabel,
  githubItemUrl,
  sameGitHubItem,
} from "@/features/workflows/model/workflow-github";
import { isActiveRun } from "@/features/workflows/model/workflow-steps";
import { useText } from "@/shared/lib/text";
import { typeScale } from "@/shared/lib/type-scale";

/** The open run on the item of an event that waits for it, from the runs that the page has read. */
function waitsFor(delivery: WorkflowGitHubDelivery, history: WorkflowGitHubHistory, runs: readonly WorkflowRun[]) {
  const item = delivery.item;
  if (!item) return undefined;
  for (const entry of history.runs) {
    const run = runs.find((candidate) => candidate.id === entry.runId);
    if (run && sameGitHubItem(entry.item, item) && isActiveRun(run.status)) return run;
  }
  return undefined;
}

/** What the host did with an event, as the desktop Events menu says it. */
function outcomeText(
  delivery: WorkflowGitHubDelivery,
  history: WorkflowGitHubHistory,
  runs: readonly WorkflowRun[],
  t: MobileTranslate,
): string {
  const runName = (run: WorkflowRun) => t("mobile.workflow.run.title", { number: run.number });
  if (delivery.outcome === "waiting") {
    const run = waitsFor(delivery, history, runs);
    return run
      ? t("mobile.workflow.github.history.waitsFor", { run: runName(run) })
      : t("mobile.workflow.github.history.waiting");
  }
  if (delivery.outcome === "skipped") return t(GITHUB_SKIP_LABEL[delivery.reason ?? "filter"]);
  const run = delivery.runId ? runs.find((candidate) => candidate.id === delivery.runId) : undefined;
  if (!run) return t("mobile.workflow.github.history.started");
  switch (run.status) {
    case "running":
    case "stopping":
      return t("mobile.workflow.github.history.running", { run: runName(run) });
    case "approval":
      return t("mobile.workflow.github.history.approval", { run: runName(run) });
    case "failed":
      return t("mobile.workflow.github.history.failed", { run: runName(run) });
    case "stopped":
      return t("mobile.workflow.github.history.stopped", { run: runName(run) });
    default:
      return runName(run);
  }
}

/**
 * One event that GitHub sent to a trigger: its item, its event and what it did. A run opens its page;
 * a skipped event opens its issue or pull request on GitHub.
 */
export function WorkflowGitHubEventRow({
  delivery,
  history,
  runs,
  onOpenRun,
}: {
  delivery: WorkflowGitHubDelivery;
  history: WorkflowGitHubHistory;
  runs: readonly WorkflowRun[];
  onOpenRun: (runId: string) => void;
}) {
  const { t, format } = useText();
  const waited = delivery.outcome === "waiting" ? waitsFor(delivery, history, runs) : undefined;
  const runId = delivery.outcome === "started" ? delivery.runId : (waited?.id ?? null);
  const item = delivery.item;
  const onPress = runId
    ? () => onOpenRun(runId)
    : item
      ? () => void Linking.openURL(githubItemUrl(item)).catch(() => undefined)
      : undefined;
  const time = format.date(new Date(delivery.receivedAt), {
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  });
  return (
    <SettingsRow onPress={onPress}>
      <Typography.Paragraph numberOfLines={2}>
        {item ? githubItemLabel(item) : t("mobile.workflow.github.history.offline")}
      </Typography.Paragraph>
      <Typography.Paragraph className="text-grouped-secondary" style={typeScale.caption}>
        {[t(GITHUB_EVENT_LABEL[delivery.event]), time].join(" · ")}
      </Typography.Paragraph>
      <Typography.Paragraph
        className={delivery.outcome === "skipped" ? "text-text-secondary" : "text-accent-text"}
        style={typeScale.caption}
      >
        {outcomeText(delivery, history, runs, t)}
      </Typography.Paragraph>
    </SettingsRow>
  );
}
