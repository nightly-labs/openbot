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
import { openAddStep, openStep, useWorkflowStepMenu } from "@/features/workflows/model/use-workflow-step-menu";
import type { WorkflowDraft } from "@/features/workflows/model/workflow-draft";
import type { FlowList, WorkflowOutline } from "@/features/workflows/model/workflow-outline";
import type { MobileAgent } from "@/features/workspace/model/workspace-types";
import { useText } from "@/shared/lib/text";
import { typeScale } from "@/shared/lib/type-scale";

/** A place between two steps of the outline: a tap adds a step there. */
function AddHere({ list, index }: { list: FlowList; index: number }) {
  return <FlowAddButton onPress={() => openAddStep(list, index)} />;
}

/**
 * A step of the outline flow: a tap opens its page, a long press opens the same menu as the list. The
 * card is the card of every flow; the trigger has no menu.
 */
function FlowStep({
  node,
  draft,
  agents,
  problem,
}: {
  node: WorkflowNode;
  draft: WorkflowDraft;
  agents: readonly MobileAgent[];
  problem: string | undefined;
}) {
  const { t } = useText();
  const { structural, actions, onAction } = useWorkflowStepMenu(node, draft);
  return (
    <FlowStepCard
      node={node}
      agents={agents}
      problem={problem}
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

/**
 * The flow view of the editor, on the canvas of the workflow page: the trigger, the steps before the
 * condition, its two paths one under the other and the steps after they join, from left to right. A "+" between two steps adds a
 * step at that place. The steps that the trigger does not reach are not part of the flow; the editor
 * lists them below it.
 */
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
  const step = (id: string) => {
    const node = byId.get(id);
    return node ? <FlowStep node={node} draft={draft} agents={agents} problem={problems.get(id)} /> : null;
  };
  /** The steps of a list with a place to add before, between and after them. */
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
