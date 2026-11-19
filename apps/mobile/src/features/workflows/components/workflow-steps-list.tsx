import type { WorkflowBranch, WorkflowGraph, WorkflowNode } from "@openbot/contracts/ipc";
import type { MobileTranslate } from "@openbot/i18n/mobile";
import { Typography } from "heroui-native";
import CornerDownLeft from "lucide-react-native/icons/corner-down-left";
import { useState } from "react";
import { View } from "react-native";
import { useCSSVariable } from "uniwind";
import { WorkflowKindTile } from "@/features/workflows/components/workflow-kind-tile";
import { WorkflowStepMenuLayer } from "@/features/workflows/components/workflow-step-menu-layer";
import { type FlowRow, flowRows, workflowFlowTree } from "@/features/workflows/model/workflow-flow-tree";
import { workflowOutline } from "@/features/workflows/model/workflow-outline";
import { stepLabel, stepText, triggerType } from "@/features/workflows/model/workflow-steps";
import type { MobileAgent } from "@/features/workspace/model/workspace-types";
import type { MenuAction } from "@/shared/components/menu-view";
import { useText } from "@/shared/lib/text";
import { typeScale } from "@/shared/lib/type-scale";

export interface WorkflowStepMenu {
  actions: (node: WorkflowNode) => MenuAction[];
  onAction: (node: WorkflowNode, actionId: string) => void;
}

const TEXT_LINES = 4;

export function rowIndent(depth: number) {
  return 16 + depth * 20;
}

export function pathLabel(branch: WorkflowBranch | null, index: number, t: MobileTranslate): string {
  return branch === "yes"
    ? t("mobile.workflow.path.yes")
    : branch === "no"
      ? t("mobile.workflow.path.no")
      : t("mobile.workflow.flow.path", { number: index + 1 });
}

export function pathTone(branch: WorkflowBranch | null) {
  return branch === "yes" ? "text-success-text" : branch === "no" ? "text-danger-text" : "text-grouped-secondary";
}

export function FlowRowNote({
  row,
  labelOf,
}: {
  row: Exclude<FlowRow, { type: "step" }>;
  labelOf: (id: string) => string;
}) {
  const { t } = useText();
  const muted = String(useCSSVariable("--openbot-text-grouped-secondary"));
  if (row.type === "path" || row.type === "loose") {
    const text = row.type === "loose" ? t("mobile.workflow.editor.loose") : pathLabel(row.branch, row.index, t);
    const tone = row.type === "path" ? pathTone(row.branch) : "text-grouped-secondary";
    return (
      <View className="pt-2.5 pr-4 pb-1" style={{ paddingLeft: rowIndent(row.depth) }}>
        <Typography.Paragraph className={`font-semibold ${tone}`} style={typeScale.small}>
          {text}
        </Typography.Paragraph>
      </View>
    );
  }
  return (
    <View className="flex-row items-center gap-1.5 py-2 pr-4" style={{ paddingLeft: rowIndent(row.depth) }}>
      {row.type === "jump" ? <CornerDownLeft color={muted} size={14} strokeWidth={2} /> : null}
      <Typography.Paragraph className="shrink text-grouped-secondary" style={typeScale.caption}>
        {row.type === "jump"
          ? t(row.loop ? "mobile.workflow.flow.loop" : "mobile.workflow.flow.jump", { step: labelOf(row.to) })
          : t(row.goesOn ? "mobile.workflow.path.joined" : "mobile.workflow.path.ends")}
      </Typography.Paragraph>
    </View>
  );
}

function WorkflowStepLine({
  node,
  agents,
  inset = false,
  depth,
  menu,
}: {
  node: WorkflowNode;
  agents: readonly MobileAgent[];
  inset?: boolean;
  depth?: number;
  menu?: WorkflowStepMenu | undefined;
}) {
  const { t } = useText();
  const [size, setSize] = useState<{ width: number; height: number }>();
  const actions = menu?.actions(node) ?? [];
  const label = stepLabel(node, agents, t);
  const hasMenu = Boolean(menu) && actions.length > 0;
  return (
    <View
      onLayout={
        hasMenu
          ? (event) => setSize({ width: event.nativeEvent.layout.width, height: event.nativeEvent.layout.height })
          : undefined
      }
    >
      <View
        className={`min-h-12 flex-row items-center gap-3 py-2.5 pr-4 ${depth !== undefined ? "" : inset ? "pl-12" : "pl-4"}`}
        style={depth !== undefined ? { paddingLeft: rowIndent(depth) } : undefined}
      >
        <WorkflowKindTile
          kind={node.kind}
          trigger={node.kind === "trigger" ? triggerType(node) : undefined}
          size={26}
        />
        <View className="min-w-0 flex-1">
          <Typography.Paragraph className="text-text-secondary" numberOfLines={1} style={typeScale.small}>
            {label}
          </Typography.Paragraph>
          <Typography.Paragraph numberOfLines={TEXT_LINES} style={typeScale.preview}>
            {stepText(node, t)}
          </Typography.Paragraph>
        </View>
      </View>
      {menu && hasMenu ? (
        <WorkflowStepMenuLayer
          actions={actions}
          label={t("mobile.workflow.editor.stepMenu", { step: label })}
          size={size}
          onAction={(id) => menu.onAction(node, id)}
        />
      ) : null}
    </View>
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
  if (!outline) {
    const labelOf = (id: string) => {
      const node = byId.get(id);
      return node ? stepLabel(node, agents, t) : "";
    };
    return flowRows(workflowFlowTree(graph)).map((row) => {
      if (row.type !== "step")
        return <FlowRowNote key={row.type === "loose" ? "loose" : row.key} row={row} labelOf={labelOf} />;
      const node = byId.get(row.id);
      return node ? <WorkflowStepLine key={row.id} node={node} agents={agents} depth={row.depth} menu={menu} /> : null;
    });
  }
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
