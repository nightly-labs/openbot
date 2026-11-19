import { WORKFLOW_PORTS, type WorkflowDetail, type WorkflowNode } from "@openbot/contracts/ipc";
import { useQueryClient } from "@tanstack/react-query";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { Typography } from "heroui-native";
import Ellipsis from "lucide-react-native/icons/ellipsis";
import Plus from "lucide-react-native/icons/plus";
import TriangleAlert from "lucide-react-native/icons/triangle-alert";
import { useEffect, useRef, useState } from "react";
import { Alert, Pressable, View } from "react-native";
import { useCSSVariable, useUniwind } from "uniwind";
import { useQueryScope } from "@/features/auth/context/mobile-session-context";
import {
  SettingsContent,
  SettingsNote,
  SettingsRow,
  SettingsSection,
} from "@/features/settings/components/settings-content";
import { WorkflowFlow } from "@/features/workflows/components/workflow-flow";
import { WorkflowFlowView } from "@/features/workflows/components/workflow-flow-view";
import { WorkflowEditorHeader } from "@/features/workflows/components/workflow-header-actions";
import { WorkflowKindTile } from "@/features/workflows/components/workflow-kind-tile";
import { FlowRowNote, rowIndent } from "@/features/workflows/components/workflow-steps-list";
import { useWorkflowCommands } from "@/features/workflows/model/use-workflow-commands";
import {
  openAddStep,
  openAddStepAt,
  openStep,
  useWorkflowStepMenu,
} from "@/features/workflows/model/use-workflow-step-menu";
import { useWorkflowDetail } from "@/features/workflows/model/use-workflows";
import {
  draftChanged,
  draftFrom,
  draftGraph,
  draftGraphChanged,
  useWorkflowDraft,
  type WorkflowDraft,
} from "@/features/workflows/model/workflow-draft";
import { useWorkflowEditorView } from "@/features/workflows/model/workflow-editor-view";
import { flowRows, workflowFlowTree } from "@/features/workflows/model/workflow-flow-tree";
import { placeAfter } from "@/features/workflows/model/workflow-graph-edit";
import type { FlowList } from "@/features/workflows/model/workflow-outline";
import { draftProblems } from "@/features/workflows/model/workflow-problems";
import { stepLabel, stepText, triggerType } from "@/features/workflows/model/workflow-steps";
import {
  useMobileWorkspaceActions,
  useMobileWorkspaceSelector,
} from "@/features/workspace/context/mobile-workspace-context";
import { queryKeys } from "@/features/workspace/model/query-keys";
import type { MobileAgent } from "@/features/workspace/model/workspace-types";
import { type MenuComponentRef, MenuView } from "@/shared/components/menu-view";
import { SheetFormField } from "@/shared/components/sheet-form-field";
import { haptics } from "@/shared/lib/haptics";
import { isAndroid } from "@/shared/lib/platform";
import { useText } from "@/shared/lib/text";
import { typeScale } from "@/shared/lib/type-scale";
import { useDiscardGuard } from "@/shared/lib/use-discard-guard";

const TITLE_LIMIT = 160;

function AddAfterButton({ node, draft }: { node: WorkflowNode; draft: WorkflowDraft }) {
  const { t } = useText();
  const { theme } = useUniwind();
  const accent = String(useCSSVariable("--openbot-accent-text"));
  const menu = useRef<MenuComponentRef | null>(null);
  const label = t("mobile.workflow.editor.addAfter");
  const button = (onPress?: () => void) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={6}
      className="size-10 items-center justify-center rounded-full"
      onPress={onPress}
    >
      <Plus color={accent} size={20} strokeWidth={2} />
    </Pressable>
  );
  if (node.kind !== "condition")
    return (
      <View className="mr-2 size-10">
        {button(() => {
          void haptics.selection();
          openAddStepAt(placeAfter(draft.graph, node.id));
        })}
      </View>
    );
  return (
    <View className="mr-2 size-10">
      <MenuView
        style={{ width: 40, height: 40 }}
        {...(isAndroid ? { ref: menu, colorScheme: theme === "dark" ? ("dark" as const) : ("light" as const) } : null)}
        actions={[
          { id: "yes", title: t("mobile.workflow.editor.addOnYes"), image: "plus" },
          { id: "no", title: t("mobile.workflow.editor.addOnNo"), image: "plus" },
        ]}
        onPressAction={(event) => {
          const branch = event.nativeEvent.event === "no" ? "no" : "yes";
          openAddStepAt(placeAfter(draft.graph, node.id, branch));
        }}
      >
        {button(() => {
          if (isAndroid) menu.current?.show();
        })}
      </MenuView>
    </View>
  );
}

function EditorStepRow({
  node,
  agents,
  draft,
  editable,
  problem,
  depth = 0,
}: {
  node: WorkflowNode;
  agents: readonly MobileAgent[];
  draft: WorkflowDraft;
  editable: boolean;
  problem: string | undefined;
  depth?: number;
}) {
  const { t } = useText();
  const { theme } = useUniwind();
  const [muted, danger] = useCSSVariable(["--openbot-text-grouped-secondary", "--openbot-danger-text"]);
  const menu = useRef<MenuComponentRef | null>(null);
  const { structural, actions, onAction } = useWorkflowStepMenu(node, draft);
  const opens = editable || node.kind === "trigger";
  return (
    <View className="flex-row items-center" style={depth > 0 ? { paddingLeft: rowIndent(depth) - 16 } : undefined}>
      <View className="min-w-0 flex-1">
        <SettingsRow
          leading={
            <WorkflowKindTile
              kind={node.kind}
              trigger={node.kind === "trigger" ? triggerType(node) : undefined}
              size={32}
            />
          }
          trailing={problem ? <TriangleAlert color={String(danger)} size={18} strokeWidth={2} /> : undefined}
          disclosure={!structural}
          disabled={!opens}
          accessibilityLabel={`${stepLabel(node, agents, t)}, ${problem ?? stepText(node, t)}`}
          onPress={opens ? () => openStep(node) : undefined}
        >
          <Typography.Paragraph className="text-grouped-secondary" numberOfLines={1} style={typeScale.small}>
            {stepLabel(node, agents, t)}
          </Typography.Paragraph>
          <Typography.Paragraph numberOfLines={2} style={typeScale.preview}>
            {editable ? stepText(node, t) : t("mobile.workflow.step.computerOnly")}
          </Typography.Paragraph>
          {problem ? (
            <Typography.Paragraph className="font-medium text-danger-text" style={typeScale.caption}>
              {problem}
            </Typography.Paragraph>
          ) : null}
        </SettingsRow>
      </View>
      {structural ? (
        <MenuView
          {...(isAndroid
            ? { ref: menu, colorScheme: theme === "dark" ? ("dark" as const) : ("light" as const) }
            : null)}
          actions={actions}
          onPressAction={(event) => onAction(event.nativeEvent.event)}
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("mobile.workflow.editor.stepMenu", { step: stepLabel(node, agents, t) })}
            hitSlop={6}
            className="mr-2 size-10 items-center justify-center rounded-full"
            onPress={() => {
              if (isAndroid) menu.current?.show();
            }}
          >
            <Ellipsis color={String(muted)} size={20} strokeWidth={2} />
          </Pressable>
        </MenuView>
      ) : draft.mode === "fields" && WORKFLOW_PORTS[node.kind].out.length > 0 ? (
        <AddAfterButton node={node} draft={draft} />
      ) : null}
    </View>
  );
}

function AddRow({ list, index, label }: { list: FlowList; index: number; label: string }) {
  const accent = String(useCSSVariable("--openbot-accent-text"));
  return (
    <SettingsRow
      disclosure={false}
      leading={<Plus color={accent} size={20} strokeWidth={2} />}
      onPress={() => openAddStep(list, index)}
    >
      <Typography.Paragraph className="text-accent-text">{label}</Typography.Paragraph>
    </SettingsRow>
  );
}

export function WorkflowEditorScreen() {
  const { t, errorMessage } = useText();
  const { serverId, workflowId } = useLocalSearchParams<{ serverId: string; workflowId?: string }>();
  const queryClient = useQueryClient();
  const queryScope = useQueryScope();
  const danger = String(useCSSVariable("--openbot-danger-text"));
  const detail = useWorkflowDetail(serverId, workflowId ?? "");
  const draft = useWorkflowDraft((state) => state.draft);
  const { start, setTitle, graphSaved } = useWorkflowDraft.getState();
  const agents = useMobileWorkspaceSelector((current) => current.agents);
  const serverAgents = agents.filter((agent) => agent.serverId === serverId);
  const { createWorkflow, saveWorkflowGraph, renameWorkflow } = useMobileWorkspaceActions();
  const commands = useWorkflowCommands(serverId);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<unknown>(null);
  const [savedId, setSavedId] = useState<string | null>(null);
  const isNew = !workflowId;
  const view = useWorkflowEditorView((state) => state.view);
  const setView = useWorkflowEditorView((state) => state.setView);

  const loaded = detail.data;
  useEffect(() => {
    const current = useWorkflowDraft.getState().draft;
    if (current && current.serverId === serverId && current.workflowId === (workflowId ?? null)) return;
    if (isNew) start(draftFrom(serverId, null));
    else if (loaded) start(draftFrom(serverId, loaded));
  }, [isNew, loaded, serverId, workflowId, start]);

  const changed = draft ? draftChanged(draft) : false;
  const problems = draft ? draftProblems(draft, serverAgents, t) : null;
  const firstProblem = problems?.first ?? null;
  useDiscardGuard(!savedId && changed, { warn: true });

  const finish = (id: string) => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.serverWorkflows(queryScope, serverId) });
    void haptics.notification("success");
    setSavedId(id);
  };
  const { open } = commands;
  const closed = useRef(false);
  useEffect(() => {
    if (!savedId || closed.current) return;
    closed.current = true;
    router.back();
    if (isNew) open(savedId);
  }, [savedId, isNew, open]);

  const save = async (base: number) => {
    if (!draft || firstProblem) return;
    setSaving(true);
    setSaveError(null);
    const title = draft.title.trim();
    try {
      if (!draft.workflowId) {
        const created = await createWorkflow({ title, graph: draftGraph(draft) }, serverId);
        finish(created.summary.id);
        return;
      }
      if (draftGraphChanged(draft)) {
        const result = await saveWorkflowGraph(
          { workflowId: draft.workflowId, baseRevision: base, graph: draftGraph(draft) },
          serverId,
        );
        if (!result.ok) {
          askAboutConflict(result.conflict);
          return;
        }
        graphSaved(result.revision);
      }
      if (title !== draft.savedTitle) await renameWorkflow({ workflowId: draft.workflowId, title }, serverId);
      finish(draft.workflowId);
    } catch (error) {
      void haptics.notification("error");
      setSaveError(error);
    } finally {
      setSaving(false);
    }
  };

  const askAboutConflict = (saved: WorkflowDetail) => {
    void haptics.notification("warning");
    Alert.alert(t("mobile.workflow.conflict.title"), t("mobile.workflow.conflict.body"), [
      { text: t("mobile.workflow.conflict.keepMine"), onPress: () => void save(saved.revision) },
      {
        text: t("mobile.workflow.conflict.loadSaved"),
        style: "destructive",
        onPress: () => start(draftFrom(serverId, saved)),
      },
    ]);
  };

  const screenTitle = (
    <Stack.Screen
      options={{ title: isNew ? t("mobile.workflow.editor.newTitle") : t("mobile.workflow.editor.title") }}
    />
  );
  const header = (canSave: boolean) => (
    <WorkflowEditorHeader
      view={view}
      onView={setView}
      backDisabled={saving}
      onBack={() => router.back()}
      save={
        draft && draft.mode !== "read-only"
          ? {
              dirty: changed || isNew,
              canSave: canSave && !saving,
              pending: saving,
              label: isNew ? t("mobile.workflow.editor.create") : t("mobile.workflow.editor.save"),
              onSave: () => void save(draft.baseRevision),
            }
          : undefined
      }
    />
  );

  if (!draft || !problems || (workflowId && draft.workflowId !== workflowId))
    return (
      <SettingsContent>
        {screenTitle}
        {header(false)}
        <SettingsNote>
          {detail.isError
            ? errorMessage(detail.error, t("mobile.workflow.detail.loadFailed"))
            : t("mobile.workflow.list.loading")}
        </SettingsNote>
      </SettingsContent>
    );

  const byId = new Map(draft.graph.nodes.map((node) => [node.id, node]));
  const editable = draft.mode !== "read-only";
  const stepRow = (node: WorkflowNode, canEdit = editable, depth = 0) => (
    <EditorStepRow
      key={node.id}
      node={node}
      agents={serverAgents}
      draft={draft}
      editable={canEdit}
      problem={problems.steps.get(node.id)}
      depth={depth}
    />
  );
  const labelOf = (id: string) => {
    const node = byId.get(id);
    return node ? stepLabel(node, serverAgents, t) : "";
  };
  const row = (id: string) => {
    const node = byId.get(id);
    return node ? stepRow(node) : null;
  };
  const outline = draft.mode === "outline" ? draft.outline : null;
  const trigger = draft.graph.nodes.find((node) => node.kind === "trigger");
  const problemNode = firstProblem?.nodeId ? byId.get(firstProblem.nodeId) : undefined;
  const problemShown = Boolean(firstProblem?.nodeId) || changed;

  return (
    <SettingsContent>
      {screenTitle}
      {header(!firstProblem)}
      <SheetFormField
        label={t("mobile.workflow.editor.name")}
        value={draft.title}
        maxLength={TITLE_LIMIT}
        autoCapitalize="sentences"
        autoFocus={isNew}
        editable={!saving && editable}
        onChangeText={setTitle}
      />
      {saveError ? (
        <Typography.Paragraph className="px-4 text-danger-text" style={typeScale.caption}>
          {errorMessage(saveError, t("mobile.workflow.editor.saveFailed"))}
        </Typography.Paragraph>
      ) : null}
      {firstProblem && problemShown ? (
        <SettingsSection>
          <SettingsRow
            leading={<TriangleAlert color={danger} size={20} strokeWidth={2} />}
            disclosure={Boolean(problemNode)}
            accessibilityLabel={firstProblem.text}
            onPress={problemNode ? () => openStep(problemNode) : undefined}
          >
            <Typography.Paragraph className="font-medium text-danger-text">{firstProblem.text}</Typography.Paragraph>
            {problems.steps.size > 1 ? (
              <Typography.Paragraph className="text-grouped-secondary" style={typeScale.caption}>
                {t("mobile.workflow.problem.more", { count: problems.steps.size - 1 })}
              </Typography.Paragraph>
            ) : null}
          </SettingsRow>
        </SettingsSection>
      ) : null}
      {draft.mode === "read-only" ? <SettingsNote>{t("mobile.workflow.detail.newerApp")}</SettingsNote> : null}
      {trigger && view !== "flow" ? (
        <SettingsSection title={t("mobile.workflow.detail.trigger")}>{stepRow(trigger)}</SettingsSection>
      ) : null}
      {outline && view === "flow" ? (
        <>
          <WorkflowFlow draft={draft} outline={outline} agents={serverAgents} problems={problems.steps} />
          {outline.loose.length > 0 ? (
            <SettingsSection title={t("mobile.workflow.editor.loose")} footer={t("mobile.workflow.editor.looseHint")}>
              {outline.loose.map(row)}
            </SettingsSection>
          ) : null}
          <SettingsNote>{t("mobile.workflow.editor.flowHint")}</SettingsNote>
        </>
      ) : outline ? (
        <>
          <SettingsSection title={t("mobile.workflow.detail.stepsTitle")}>
            {outline.main.map(row)}
            <AddRow list="main" index={outline.main.length} label={t("mobile.workflow.editor.addStep")} />
            {outline.condition ? row(outline.condition) : null}
          </SettingsSection>
          {outline.condition ? (
            <>
              {(["yes", "no"] as const).map((path) => (
                <SettingsSection
                  key={path}
                  title={t(path === "yes" ? "mobile.workflow.path.yes" : "mobile.workflow.path.no")}
                  footer={
                    outline[path].length === 0
                      ? t(outline.after.length > 0 ? "mobile.workflow.path.joined" : "mobile.workflow.path.ends")
                      : undefined
                  }
                >
                  {outline[path].map(row)}
                  <AddRow list={path} index={outline[path].length} label={t("mobile.workflow.editor.addStep")} />
                </SettingsSection>
              ))}
              <SettingsSection
                title={t("mobile.workflow.path.after")}
                footer={outline.after.length === 0 ? t("mobile.workflow.editor.afterHint") : undefined}
              >
                {outline.after.map(row)}
                <AddRow list="after" index={outline.after.length} label={t("mobile.workflow.editor.addStep")} />
              </SettingsSection>
            </>
          ) : null}
          {outline.loose.length > 0 ? (
            <SettingsSection title={t("mobile.workflow.editor.loose")} footer={t("mobile.workflow.editor.looseHint")}>
              {outline.loose.map(row)}
            </SettingsSection>
          ) : null}
        </>
      ) : view === "flow" ? (
        <WorkflowFlowView
          graph={draftGraph(draft)}
          agents={serverAgents}
          problems={problems.steps}
          onOpenStep={openStep}
          onAdd={draft.mode === "fields" ? openAddStepAt : undefined}
          canOpenStep={(node) =>
            node.kind === "trigger" || (draft.mode === "fields" && node.kind !== "image" && node.kind !== "asset")
          }
        />
      ) : (
        <SettingsSection title={t("mobile.workflow.detail.stepsTitle")}>
          {flowRows(workflowFlowTree(draftGraph(draft))).map((item) => {
            if (item.type !== "step")
              return <FlowRowNote key={item.type === "loose" ? "loose" : item.key} row={item} labelOf={labelOf} />;
            const node = byId.get(item.id);
            if (!node || node.kind === "trigger") return null;
            return stepRow(node, draft.mode === "fields" && node.kind !== "image" && node.kind !== "asset", item.depth);
          })}
        </SettingsSection>
      )}
      {draft.graph.nodes.some((node) => node.kind === "note" || node.kind === "text" || node.kind === "shape") ||
      draft.graph.strokes.length > 0 ? (
        <SettingsNote>{t("mobile.workflow.editor.annotationsKept")}</SettingsNote>
      ) : null}
    </SettingsContent>
  );
}
