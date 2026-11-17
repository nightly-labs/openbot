import type { WorkflowNode } from "@openbot/contracts/ipc";
import type { MobileTextKey } from "@openbot/i18n/mobile";
import { Typography } from "heroui-native";
import TriangleAlert from "lucide-react-native/icons/triangle-alert";
import { Fragment, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { useCSSVariable } from "uniwind";
import {
  FLOW_CARD_WIDTH,
  FlowAddButton,
  FlowCanvas,
  FlowLanes,
} from "@/features/workflows/components/workflow-flow-canvas";
import { WorkflowKindTile } from "@/features/workflows/components/workflow-kind-tile";
import { WorkflowStepMenuLayer } from "@/features/workflows/components/workflow-step-menu-layer";
import { openAddStep, openStep, useWorkflowStepMenu } from "@/features/workflows/model/use-workflow-step-menu";
import type { WorkflowDraft } from "@/features/workflows/model/workflow-draft";
import type { FlowList, WorkflowOutline } from "@/features/workflows/model/workflow-outline";
import { stepLabel, stepText, triggerType } from "@/features/workflows/model/workflow-steps";
import type { MobileAgent } from "@/features/workspace/model/workspace-types";
import { useText } from "@/shared/lib/text";
import { typeScale } from "@/shared/lib/type-scale";

/** A place between two steps of the outline: a tap adds a step there. */
function AddHere({ list, index }: { list: FlowList; index: number }) {
  return <FlowAddButton onPress={() => openAddStep(list, index)} />;
}

/**
 * A step of the flow: a tap opens its page, a long press opens the same menu as the list. A step with a
 * problem has a red edge and shows the problem. The trigger has no menu: a tap opens its page.
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
  const [danger, control, grouped] = useCSSVariable([
    "--openbot-danger-text",
    "--openbot-bg-control",
    "--openbot-bg-grouped",
  ]);
  const [size, setSize] = useState<{ width: number; height: number }>();
  const [pressed, setPressed] = useState(false);
  const { structural, actions, onAction } = useWorkflowStepMenu(node, draft);
  const label = stepLabel(node, agents, t);
  return (
    <View
      style={{ width: FLOW_CARD_WIDTH }}
      onLayout={(event) => setSize({ width: event.nativeEvent.layout.width, height: event.nativeEvent.layout.height })}
    >
      <View
        className="flex-row items-center gap-3 rounded-grouped px-3 py-2.5"
        style={{
          backgroundColor: String(pressed ? control : grouped),
          ...(problem ? { borderWidth: 1.5, borderColor: String(danger) } : null),
        }}
      >
        <WorkflowKindTile
          kind={node.kind}
          trigger={node.kind === "trigger" ? triggerType(node) : undefined}
          size={30}
        />
        <View className="min-w-0 flex-1">
          <Typography.Paragraph className="text-grouped-secondary" numberOfLines={1} style={typeScale.small}>
            {label}
          </Typography.Paragraph>
          <Typography.Paragraph numberOfLines={4} style={typeScale.caption}>
            {stepText(node, t)}
          </Typography.Paragraph>
          {problem ? (
            <Typography.Paragraph className="font-medium text-danger-text" numberOfLines={3} style={typeScale.small}>
              {problem}
            </Typography.Paragraph>
          ) : null}
        </View>
        {problem ? <TriangleAlert color={String(danger)} size={16} strokeWidth={2} /> : null}
      </View>
      {structural ? (
        <WorkflowStepMenuLayer
          actions={actions}
          label={`${label}, ${problem ?? stepText(node, t)}`}
          hint={t("mobile.workflow.editor.flowStepHint")}
          size={size}
          onAction={onAction}
          onPress={() => openStep(node)}
          onPressedChange={setPressed}
        />
      ) : (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${label}, ${problem ?? stepText(node, t)}`}
          style={StyleSheet.absoluteFill}
          onPressIn={() => setPressed(true)}
          onPressOut={() => setPressed(false)}
          onPress={() => openStep(node)}
        />
      )}
    </View>
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
