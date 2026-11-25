import type { WorkflowNode } from "@openbot/contracts/ipc";
import type { MobileTextKey } from "@openbot/i18n/mobile";
import { Typography } from "heroui-native";
import { Fragment } from "react";
import {
  FLOW_CARD_WIDTH,
  FlowAddButton,
  FlowCanvas,
  FlowLanes,
} from "@/features/workflows/components/workflow-flow-canvas";
import { FlowStepCard } from "@/features/workflows/components/workflow-flow-view";
import { type NodeCredits, useMediaCredits } from "@/features/workflows/model/use-media-credits";
import { openAddStep, openStep, useWorkflowStepMenu } from "@/features/workflows/model/use-workflow-step-menu";
import type { WorkflowDraft } from "@/features/workflows/model/workflow-draft";
import type { FlowList, WorkflowOutline } from "@/features/workflows/model/workflow-outline";
import type { MobileAgent } from "@/features/workspace/model/workspace-types";
import { useText } from "@/shared/lib/text";
import { typeScale } from "@/shared/lib/type-scale";

function AddHere({ list, index }: { list: FlowList; index: number }) {
  return <FlowAddButton onPress={() => openAddStep(list, index)} />;
}

function FlowStep({
  node,
  draft,
  agents,
  problem,
  credits,
}: {
  node: WorkflowNode;
  draft: WorkflowDraft;
  agents: readonly MobileAgent[];
  problem: string | undefined;
  credits: NodeCredits | undefined;
}) {
  const { t } = useText();
  const { structural, actions, onAction } = useWorkflowStepMenu(node, draft);
  return (
    <FlowStepCard
      node={node}
      agents={agents}
      problem={problem}
      credits={credits}
      press={{
        kind: "edit",
        actions: structural ? actions : [],
        onAction,
        open: () => openStep(node),
        hint: t("mobile.workflow.editor.flowStepHint"),
      }}
    />
  );
}

export function WorkflowFlow({
  draft,
  outline,
  agents,
  problems,
}: {
  draft: WorkflowDraft;
  outline: WorkflowOutline;
  agents: readonly MobileAgent[];
  problems: ReadonlyMap<string, string>;
}) {
  const { t } = useText();
  const byId = new Map(draft.graph.nodes.map((node) => [node.id, node]));
  const { byNode } = useMediaCredits(draft.serverId, draft.graph.nodes);
  const step = (id: string) => {
    const node = byId.get(id);
    return node ? (
      <FlowStep node={node} draft={draft} agents={agents} problem={problems.get(id)} credits={byNode.get(id)} />
    ) : null;
  };
  const list = (name: FlowList) => (
    <>
      {outline[name].map((id, index) => (
        <Fragment key={id}>
          <AddHere list={name} index={index} />
          {step(id)}
        </Fragment>
      ))}
      <AddHere list={name} index={outline[name].length} />
    </>
  );
  const note = (key: MobileTextKey) => (
    <Typography.Paragraph
      className="py-1 text-center text-grouped-secondary"
      style={[typeScale.small, { maxWidth: FLOW_CARD_WIDTH * 0.7 }]}
    >
      {t(key)}
    </Typography.Paragraph>
  );
  const condition = outline.condition;
  return (
    <FlowCanvas>
      {step(outline.trigger)}
      {list("main")}
      {condition ? (
        <>
          {step(condition)}
          <FlowLanes
            joined
            lanes={(["yes", "no"] as const).map((path) => ({
              key: path,
              label: (
                <Typography.Paragraph
                  className={`font-semibold ${path === "yes" ? "text-success-text" : "text-danger-text"}`}
                  style={typeScale.caption}
                >
                  {t(path === "yes" ? "mobile.workflow.path.yes" : "mobile.workflow.path.no")}
                </Typography.Paragraph>
              ),
              content: (
                <>
                  {list(path)}
                  {outline[path].length === 0
                    ? note(outline.after.length > 0 ? "mobile.workflow.path.joined" : "mobile.workflow.path.ends")
                    : null}
                </>
              ),
            }))}
          />
          <Typography.Paragraph className="px-1.5 font-semibold text-grouped-secondary" style={typeScale.caption}>
            {t("mobile.workflow.path.after")}
          </Typography.Paragraph>
          {list("after")}
          {outline.after.length === 0 ? note("mobile.workflow.editor.afterHint") : null}
        </>
      ) : null}
    </FlowCanvas>
  );
}
