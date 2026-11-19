import type { WorkflowGraph, WorkflowNode, WorkflowStep } from "@openbot/contracts/ipc";
import { Typography } from "heroui-native";
import CornerDownLeft from "lucide-react-native/icons/corner-down-left";
import TriangleAlert from "lucide-react-native/icons/triangle-alert";
import { Fragment, useMemo, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { useCSSVariable } from "uniwind";
import {
  FLOW_CARD_WIDTH,
  FlowAddButton,
  FlowCanvas,
  FlowConnector,
  FlowLanes,
} from "@/features/workflows/components/workflow-flow-canvas";
import { WorkflowKindTile } from "@/features/workflows/components/workflow-kind-tile";
import {
  RunConnector,
  RunningRing,
  RunStepStatus,
  type RunTone,
} from "@/features/workflows/components/workflow-run-visuals";
import { WorkflowStepMenuLayer } from "@/features/workflows/components/workflow-step-menu-layer";
import type { WorkflowStepMenu } from "@/features/workflows/components/workflow-steps-list";
import { type FlowItem, type FlowPath, workflowFlowTree } from "@/features/workflows/model/workflow-flow-tree";
import type { GraphPlace } from "@/features/workflows/model/workflow-graph-edit";
import { stepLabel, stepText, triggerType } from "@/features/workflows/model/workflow-steps";
import type { MobileAgent } from "@/features/workspace/model/workspace-types";
import type { MenuAction } from "@/shared/components/menu-view";
import { useText } from "@/shared/lib/text";
import { typeScale } from "@/shared/lib/type-scale";

const GROUPED_RADIUS = 16;

export type StepPress =
  | { kind: "menu"; menu: WorkflowStepMenu }
  | { kind: "open"; open: (node: WorkflowNode) => void; canOpen: (node: WorkflowNode) => boolean }
  | { kind: "edit"; actions: MenuAction[]; onAction: (id: string) => void; open: () => void; hint: string };

export function FlowStepCard({
  node,
  agents,
  press,
  problem,
  run,
}: {
  node: WorkflowNode;
  agents: readonly MobileAgent[];
  press: StepPress | undefined;
  problem: string | undefined;
  run?: { step: WorkflowStep | undefined; selected: boolean } | undefined;
}) {
  const { t } = useText();
  const [control, grouped, danger, warning, accent] = useCSSVariable([
    "--openbot-bg-control",
    "--openbot-bg-grouped",
    "--openbot-danger-text",
    "--openbot-warning",
    "--openbot-accent",
  ]);
  const status = run?.step?.status;
  const ring = problem
    ? { borderWidth: 1.5, borderColor: String(danger) }
    : run?.selected
      ? { borderWidth: 2, borderColor: String(accent) }
      : status === "approval"
        ? { borderWidth: 1.5, borderColor: String(warning) }
        : null;
  const quiet = run !== undefined && (!status || status === "skipped" || status === "stopped");
  const [size, setSize] = useState<{ width: number; height: number }>();
  const [pressed, setPressed] = useState(false);
  const label = stepLabel(node, agents, t);
  const text = stepText(node, t);
  const actions = press?.kind === "menu" ? press.menu.actions(node) : press?.kind === "edit" ? press.actions : [];
  const hasMenu = actions.length > 0;
  const opens = (press?.kind === "open" && press.canOpen(node)) || press?.kind === "edit";
  return (
    <View
      style={{ width: FLOW_CARD_WIDTH, opacity: quiet ? 0.6 : 1 }}
      onLayout={(event) => setSize({ width: event.nativeEvent.layout.width, height: event.nativeEvent.layout.height })}
    >
      <View
        accessible={!hasMenu && !opens}
        accessibilityLabel={hasMenu || opens ? undefined : `${label}, ${problem ?? text}`}
        className="flex-row items-center gap-3 rounded-grouped px-3 py-2.5"
        style={{
          backgroundColor: String(pressed ? control : grouped),
          ...ring,
        }}
      >
        <WorkflowKindTile
          kind={node.kind}
          trigger={node.kind === "trigger" ? triggerType(node) : undefined}
          size={30}
        />
        <View className="min-w-0 flex-1">
          <View className="flex-row items-center justify-between gap-2">
            <Typography.Paragraph className="shrink text-grouped-secondary" numberOfLines={1} style={typeScale.small}>
              {label}
            </Typography.Paragraph>
            {run ? <RunStepStatus step={run.step} /> : null}
          </View>
          <Typography.Paragraph numberOfLines={4} style={typeScale.caption}>
            {text}
          </Typography.Paragraph>
          {problem ? (
            <Typography.Paragraph className="font-medium text-danger-text" numberOfLines={3} style={typeScale.small}>
              {problem}
            </Typography.Paragraph>
          ) : null}
        </View>
        {problem ? <TriangleAlert color={String(danger)} size={16} strokeWidth={2} /> : null}
      </View>
      {status === "running" && size ? (
        <RunningRing width={size.width} height={size.height} radius={GROUPED_RADIUS} />
      ) : null}
      {press?.kind === "menu" && hasMenu ? (
        <WorkflowStepMenuLayer
          actions={actions}
          label={t("mobile.workflow.editor.stepMenu", { step: label })}
          size={size}
          onAction={(id) => press.menu.onAction(node, id)}
          onPressedChange={setPressed}
        />
      ) : null}
      {press?.kind === "edit" && hasMenu ? (
        <WorkflowStepMenuLayer
          actions={actions}
          label={`${label}, ${problem ?? text}`}
          hint={press.hint}
          size={size}
          onAction={press.onAction}
          onPress={press.open}
          onPressedChange={setPressed}
        />
      ) : null}
      {press?.kind === "edit" && !hasMenu ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${label}, ${problem ?? text}`}
          style={StyleSheet.absoluteFill}
          onPressIn={() => setPressed(true)}
          onPressOut={() => setPressed(false)}
          onPress={press.open}
        />
      ) : null}
      {press?.kind === "open" && opens ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${label}, ${problem ?? text}`}
          style={StyleSheet.absoluteFill}
          onPressIn={() => setPressed(true)}
          onPressOut={() => setPressed(false)}
          onPress={() => press.open(node)}
        />
      ) : null}
    </View>
  );
}

function FlowJump({ label, loop }: { label: string; loop: boolean }) {
  const { t } = useText();
  const muted = String(useCSSVariable("--openbot-text-grouped-secondary"));
  return (
    <View className="flex-row items-center justify-center gap-1.5 px-2 py-1" style={{ maxWidth: FLOW_CARD_WIDTH }}>
      <CornerDownLeft color={muted} size={14} strokeWidth={2} />
      <Typography.Paragraph className="shrink text-grouped-secondary" numberOfLines={2} style={typeScale.small}>
        {t(loop ? "mobile.workflow.flow.loop" : "mobile.workflow.flow.jump", { step: label })}
      </Typography.Paragraph>
    </View>
  );
}

function PathLabel({ path, index }: { path: FlowPath; index: number }) {
  const { t } = useText();
  const text =
    path.branch === "yes"
      ? t("mobile.workflow.path.yes")
      : path.branch === "no"
        ? t("mobile.workflow.path.no")
        : t("mobile.workflow.flow.path", { number: index + 1 });
  const tone =
    path.branch === "yes" ? "text-success-text" : path.branch === "no" ? "text-danger-text" : "text-grouped-secondary";
  return (
    <Typography.Paragraph className={`font-semibold ${tone}`} style={typeScale.caption}>
      {text}
    </Typography.Paragraph>
  );
}

export function WorkflowFlowView({
  graph,
  agents,
  menu,
  onOpenStep,
  canOpenStep = () => true,
  problems,
  onAdd,
  run,
}: {
  graph: WorkflowGraph;
  agents: readonly MobileAgent[];
  menu?: WorkflowStepMenu;
  onOpenStep?: (node: WorkflowNode) => void;
  canOpenStep?: (node: WorkflowNode) => boolean;
  problems?: ReadonlyMap<string, string>;
  onAdd?: (place: GraphPlace) => void;
  run?: {
    steps: ReadonlyMap<string, WorkflowStep>;
    selectedId: string | null;
    onSelect: (node: WorkflowNode) => void;
  };
}) {
  const { t } = useText();
  const tree = useMemo(() => workflowFlowTree(graph), [graph]);
  const byId = new Map(graph.nodes.map((node) => [node.id, node]));
  const press: StepPress | undefined = run
    ? { kind: "open", open: run.onSelect, canOpen: () => true }
    : onOpenStep
      ? { kind: "open", open: onOpenStep, canOpen: canOpenStep }
      : menu
        ? { kind: "menu", menu }
        : undefined;
  const labelOf = (id: string) => {
    const node = byId.get(id);
    return node ? stepLabel(node, agents, t) : "";
  };
  const edges = new Map(graph.edges.map((edge) => [edge.id, edge]));
  const edgeTone = (edgeId: string): RunTone => {
    const edge = edges.get(edgeId);
    if (!edge || !run) return "idle";
    const fromKind = byId.get(edge.from)?.kind;
    const fromDone = run.steps.get(edge.from)?.status === "done" || fromKind === "prompt" || fromKind === "asset";
    const to = run.steps.get(edge.to)?.status;
    if (fromDone && to === "running") return "run";
    if (fromDone && to === "done") return "done";
    return "idle";
  };

  const keyOf = (item: FlowItem) =>
    item.type === "step"
      ? item.id
      : item.type === "jump"
        ? `jump-${item.from}-${item.to}`
        : item.type === "split"
          ? `split-${item.from}`
          : item.place.kind === "edge"
            ? `add-${item.place.edgeId}`
            : `add-${item.place.nodeId}-${item.place.branch ?? ""}`;
  const ownLine = (item: FlowItem | undefined) => item?.type === "add" || item?.type === "split";
  const list = (all: readonly FlowItem[]) => {
    const items = onAdd ? all : all.filter((item) => item.type !== "add" || item.place.kind === "edge");
    return items.map((item, index) => (
      <Fragment key={keyOf(item)}>
        {index > 0 && !ownLine(item) && !ownLine(items[index - 1]) ? <FlowConnector /> : null}
        {itemView(item)}
      </Fragment>
    ));
  };

  function itemView(item: FlowItem) {
    if (item.type === "add") {
      const place = item.place;
      if (onAdd) return <FlowAddButton onPress={() => onAdd(place)} />;
      return run && place.kind === "edge" ? <RunConnector tone={edgeTone(place.edgeId)} /> : <FlowConnector />;
    }
    if (item.type === "jump") return <FlowJump label={labelOf(item.to)} loop={item.loop} />;
    if (item.type === "step") {
      const node = byId.get(item.id);
      return node ? (
        <FlowStepCard
          node={node}
          agents={agents}
          press={press}
          problem={problems?.get(item.id)}
          run={run ? { step: run.steps.get(item.id), selected: run.selectedId === item.id } : undefined}
        />
      ) : null;
    }
    const taken = run?.steps.get(item.from)?.branch ?? null;
    return (
      <FlowLanes
        joined={item.joined}
        lanes={item.paths.map((path, index) => ({
          key: path.key,
          label: <PathLabel path={path} index={index} />,
          dimmed: Boolean(taken && path.branch && path.branch !== taken),
          content: (
            <>
              {list(path.items)}
              {path.items.every((child) => child.type === "add") ? (
                <Typography.Paragraph
                  className="px-1.5 py-1 text-center text-grouped-secondary"
                  style={[typeScale.small, { maxWidth: FLOW_CARD_WIDTH * 0.7 }]}
                >
                  {t(path.goesOn ? "mobile.workflow.path.joined" : "mobile.workflow.path.ends")}
                </Typography.Paragraph>
              ) : null}
            </>
          ),
        }))}
      />
    );
  }

  return (
    <View className="gap-6">
      <FlowCanvas>{list(tree.items)}</FlowCanvas>
      {tree.loose.length > 0 ? (
        <View className="gap-2">
          <Typography.Paragraph className="px-1 text-grouped-secondary" style={typeScale.caption}>
            {t("mobile.workflow.editor.loose")}
          </Typography.Paragraph>
          <FlowCanvas>
            <View className="gap-2">
              {tree.loose.map((id) => (
                <Fragment key={id}>{itemView({ type: "step", id })}</Fragment>
              ))}
            </View>
          </FlowCanvas>
        </View>
      ) : null}
    </View>
  );
}
