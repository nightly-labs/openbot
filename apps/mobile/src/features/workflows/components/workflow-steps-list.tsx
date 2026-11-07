import type { WorkflowGraph, WorkflowNode } from "@openbot/contracts/ipc";
import type { MobileTranslate } from "@openbot/i18n/mobile";
import { Typography } from "heroui-native";
import { useRef } from "react";
import { Pressable, View } from "react-native";
import { useUniwind } from "uniwind";
import { WorkflowKindTile } from "@/features/workflows/components/workflow-kind-tile";
import { readingOrder, workflowOutline } from "@/features/workflows/model/workflow-outline";
import { stepLabel, stepText, triggerType } from "@/features/workflows/model/workflow-steps";
import type { MobileAgent } from "@/features/workspace/model/workspace-types";
import { type MenuAction, type MenuComponentRef, MenuView } from "@/shared/components/menu-view";
import { isAndroid } from "@/shared/lib/platform";
import { useText } from "@/shared/lib/text";
import { typeScale } from "@/shared/lib/type-scale";

/** The actions that a step row offers, such as Run from here. A step without actions has no menu. */
export interface WorkflowStepMenu {
  actions: (node: WorkflowNode) => MenuAction[];
  onAction: (node: WorkflowNode, actionId: string) => void;
}

/** One step of a workflow, read-only: its kind and what it does. A tap opens its menu, when it has one. */
function WorkflowStepLine({
  node,
  agents,
  inset = false,
  menu,
}: {
  node: WorkflowNode;
  agents: readonly MobileAgent[];
  /** A step of a condition path sits under the condition. */
  inset?: boolean;
  menu?: WorkflowStepMenu | undefined;
}) {
  const { t } = useText();
  const { theme } = useUniwind();
  const ref = useRef<MenuComponentRef | null>(null);
  const actions = menu?.actions(node) ?? [];
  const line = (
    <View className={`min-h-12 flex-row items-center gap-3 py-2.5 pr-4 ${inset ? "pl-12" : "pl-4"}`}>
      <WorkflowKindTile kind={node.kind} trigger={node.kind === "trigger" ? triggerType(node) : undefined} size={26} />
      <View className="min-w-0 flex-1">
        <Typography.Paragraph className="text-text-secondary" numberOfLines={1} style={typeScale.small}>
          {stepLabel(node, agents, t)}
        </Typography.Paragraph>
        <Typography.Paragraph numberOfLines={1} style={typeScale.preview}>
          {stepText(node, t)}
        </Typography.Paragraph>
      </View>
    </View>
  );
  if (!menu || actions.length === 0) return line;
  return (
    <MenuView
      {...(isAndroid ? { ref, colorScheme: theme === "dark" ? ("dark" as const) : ("light" as const) } : null)}
      actions={actions}
      onPressAction={(event) => menu.onAction(node, event.nativeEvent.event)}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t("mobile.workflow.editor.stepMenu", { step: stepLabel(node, agents, t) })}
        onPress={() => {
          if (isAndroid) ref.current?.show();
        }}
      >
        {line}
      </Pressable>
    </MenuView>
  );
}

function PathLabel({ text }: { text: string }) {
  return (
    <View className="pt-2 pl-12">
      <Typography.Paragraph className="font-semibold text-warning-text" style={typeScale.small}>
        {text}
      </Typography.Paragraph>
    </View>
  );
}

/**
 * The steps of a workflow as rows of one group. A workflow of the outline shape shows its condition
 * paths under the condition; any other one shows its steps from left to right, as the canvas does.
 */
export function workflowStepRows(
  graph: WorkflowGraph,
  agents: readonly MobileAgent[],
  t: MobileTranslate,
  menu?: WorkflowStepMenu,
) {
  const outline = workflowOutline(graph);
  const byId = new Map(graph.nodes.map((node) => [node.id, node]));
  const line = (id: string, inset = false) => {
    const node = byId.get(id);
    return node ? <WorkflowStepLine key={id} node={node} agents={agents} inset={inset} menu={menu} /> : null;
  };
  if (!outline)
    return readingOrder(graph).map((node) => (
      <WorkflowStepLine key={node.id} node={node} agents={agents} menu={menu} />
    ));
  const rows = [line(outline.trigger), ...outline.main.map((id) => line(id))];
  if (outline.condition) {
    rows.push(line(outline.condition));
    for (const path of ["yes", "no"] as const) {
      const ids = outline[path];
      rows.push(
        <View key={`path-${path}`}>
          <PathLabel text={t(path === "yes" ? "mobile.workflow.path.yes" : "mobile.workflow.path.no")} />
          {ids.length > 0 ? (
            ids.map((id) => line(id, true))
          ) : (
            <View className="py-2.5 pl-12">
              <Typography.Paragraph className="text-text-secondary" style={typeScale.caption}>
                {t(outline.after.length > 0 ? "mobile.workflow.path.joined" : "mobile.workflow.path.ends")}
              </Typography.Paragraph>
            </View>
          )}
        </View>,
      );
    }
    if (outline.after.length > 0)
      rows.push(
        <View key="path-after">
          <PathLabel text={t("mobile.workflow.path.after")} />
          {outline.after.map((id) => line(id))}
        </View>,
      );
  }
  if (outline.loose.length > 0)
    rows.push(
      <View key="loose">
        <PathLabel text={t("mobile.workflow.editor.loose")} />
        {outline.loose.map((id) => line(id, true))}
      </View>,
    );
  return rows;
}
