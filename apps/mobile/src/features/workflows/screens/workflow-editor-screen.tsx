import type { WorkflowDetail, WorkflowNode } from "@openbot/contracts/ipc";
import { useQueryClient } from "@tanstack/react-query";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { usePreventRemove } from "expo-router/react-navigation";
import { Typography } from "heroui-native";
import Ellipsis from "lucide-react-native/icons/ellipsis";
import Plus from "lucide-react-native/icons/plus";
import TriangleAlert from "lucide-react-native/icons/triangle-alert";
import X from "lucide-react-native/icons/x";
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
import { WorkflowKindTile } from "@/features/workflows/components/workflow-kind-tile";
import { useWorkflowCommands } from "@/features/workflows/model/use-workflow-commands";
import { useWorkflowDetail } from "@/features/workflows/model/use-workflows";
import {
  draftChanged,
  draftFrom,
  draftGraph,
  draftGraphChanged,
  useWorkflowDraft,
  type WorkflowDraft,
} from "@/features/workflows/model/workflow-draft";
import { canMove, type FlowList, outlineListOf, readingOrder } from "@/features/workflows/model/workflow-outline";
import { draftProblems } from "@/features/workflows/model/workflow-problems";
import { stepLabel, stepText, triggerType } from "@/features/workflows/model/workflow-steps";
import {
  useMobileWorkspaceActions,
  useMobileWorkspaceSelector,
} from "@/features/workspace/context/mobile-workspace-context";
import { queryKeys } from "@/features/workspace/model/query-keys";
import type { MobileAgent } from "@/features/workspace/model/workspace-types";
import { AndroidHeaderButton } from "@/shared/components/android-header-button";
import { type MenuAction, type MenuComponentRef, MenuView } from "@/shared/components/menu-view";
import { SheetFormField } from "@/shared/components/sheet-form-field";
import { SheetSaveAction } from "@/shared/components/sheet-save-action";
import { haptics } from "@/shared/lib/haptics";
import { isAndroid } from "@/shared/lib/platform";
import { currentText, useText } from "@/shared/lib/text";
import { typeScale } from "@/shared/lib/type-scale";

/** The longest name that `workflows-v1` carries. */
const TITLE_LIMIT = 160;

/** Opens the page of a step: the trigger page for the trigger. */
function openStep(node: WorkflowNode) {
  if (node.kind === "trigger") router.push({ pathname: "/workflow-editor/trigger", params: { nodeId: node.id } });
  else router.push({ pathname: "/workflow-editor/step", params: { nodeId: node.id } });
}

/**
 * A step of the editor: a tap opens its page, and its menu moves, copies, adds after or deletes it. A
 * step with a problem shows the problem in red, with a warning sign.
 */
function EditorStepRow({
  node,
  agents,
  draft,
  editable,
  problem,
}: {
  node: WorkflowNode;
  agents: readonly MobileAgent[];
  draft: WorkflowDraft;
  /** False for a kind that only the desktop changes, such as an image step. */
  editable: boolean;
  problem: string | undefined;
}) {
  const { t } = useText();
  const { theme } = useUniwind();
  const [muted, danger] = useCSSVariable(["--openbot-text-grouped-secondary", "--openbot-danger-text"]);
  const menu = useRef<MenuComponentRef | null>(null);
  const { move, duplicate, remove, connect } = useWorkflowDraft.getState();
  const outline = draft.mode === "outline" ? draft.outline : null;
  const list = outline ? outlineListOf(outline, node.id) : null;
  const loose = list === "loose";
  const structural = Boolean(outline) && node.kind !== "trigger";
  const flowList: FlowList | null = list && list !== "loose" ? list : null;
  const actions: MenuAction[] = loose
    ? [
        ...(node.kind === "condition"
          ? []
          : [{ id: "connect", title: t("mobile.workflow.editor.connect"), image: "plus" } satisfies MenuAction]),
        {
          id: "delete-group",
          title: "",
          displayInline: true,
          subactions: [
            {
              id: "delete",
              title: t("mobile.workflow.editor.delete"),
              image: "trash",
              attributes: { destructive: true },
            },
          ],
        },
      ]
    : [
        ...(outline && flowList && canMove(outline, node.id, -1)
          ? [{ id: "up", title: t("mobile.workflow.editor.moveUp"), image: "arrow.up" } satisfies MenuAction]
          : []),
        ...(outline && flowList && canMove(outline, node.id, 1)
          ? [{ id: "down", title: t("mobile.workflow.editor.moveDown"), image: "arrow.down" } satisfies MenuAction]
          : []),
        ...(flowList
          ? [{ id: "copy", title: t("mobile.workflow.editor.duplicate"), image: "doc.on.doc" } satisfies MenuAction]
          : []),
        ...(flowList
          ? [{ id: "add", title: t("mobile.workflow.editor.addAfter"), image: "plus" } satisfies MenuAction]
          : []),
        {
          id: "delete-group",
          title: "",
          displayInline: true,
          subactions: [
            {
              id: "delete",
              title: t("mobile.workflow.editor.delete"),
              image: "trash",
              attributes: { destructive: true },
            },
          ],
        },
      ];
  const onAction = (id: string) => {
    if (id === "up") move(node.id, -1);
    else if (id === "down") move(node.id, 1);
    else if (id === "copy") duplicate(node.id);
    else if (id === "connect") {
      void haptics.selection();
      connect(node.id);
    } else if (id === "delete") confirmRemove(node, draft, remove);
    else if (id === "add" && flowList && outline)
      router.push({
        pathname: "/workflow-editor/add",
        params: { list: flowList, index: String(outline[flowList].indexOf(node.id) + 1) },
      });
  };
  const opens = editable || node.kind === "trigger";
  return (
    <View className="flex-row items-center">
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
      ) : null}
    </View>
  );
}

/** Deleting a condition deletes its two paths, so it asks first. */
function confirmRemove(node: WorkflowNode, draft: WorkflowDraft, remove: (id: string) => void) {
  const text = currentText();
  if (node.kind !== "condition" || !draft.outline) {
    void haptics.selection();
    remove(node.id);
    return;
  }
  const count = draft.outline.yes.length + draft.outline.no.length;
  Alert.alert(
    text.t("mobile.workflow.editor.deleteConditionTitle"),
    count > 0
      ? text.t("mobile.workflow.editor.deleteConditionPaths", { count })
      : text.t("mobile.workflow.editor.deleteConditionBody"),
    [
      { text: text.t("common.cancel"), style: "cancel" },
      { text: text.t("mobile.workflow.editor.delete"), style: "destructive", onPress: () => remove(node.id) },
    ],
  );
}

/** The last row of a list: it adds a step at its end. */
function AddRow({ list, index, label }: { list: FlowList; index: number; label: string }) {
  const accent = String(useCSSVariable("--openbot-accent-text"));
  return (
    <SettingsRow
      disclosure={false}
      leading={<Plus color={accent} size={20} strokeWidth={2} />}
      onPress={() => router.push({ pathname: "/workflow-editor/add", params: { list, index: String(index) } })}
    >
      <Typography.Paragraph className="text-accent-text">{label}</Typography.Paragraph>
    </SettingsRow>
  );
}

/**
 * Workflows > a workflow > Edit, or Workflows > New: the first page of the editor sheet. It shows the
 * name, the trigger and the steps, and saves the draft that the step and trigger pages change.
 */
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
  /** The id of the saved workflow: the sheet closes on the next render, when the discard guard is off. */
  const [savedId, setSavedId] = useState<string | null>(null);
  const isNew = !workflowId;

  // The draft starts once, from the saved workflow; a later read of the host does not reset it.
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
  const [discarding, setDiscarding] = useState(false);
  usePreventRemove(!discarding && !savedId && changed, ({ repeat }) => {
    void haptics.notification("warning");
    Alert.alert(t("mobile.agent.discard.title"), t("mobile.agent.discard.body"), [
      { text: t("mobile.agent.discard.keepEditing"), style: "cancel" },
      {
        text: t("mobile.agent.discard.discard"),
        style: "destructive",
        onPress: () => {
          setDiscarding(true);
          repeat();
        },
      },
    ]);
  });

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
    // A new workflow opens after the sheet closes, over the list.
    if (isNew) open(savedId);
  }, [savedId, isNew, open]);

  /** Saves the draft over `base`: the revision that it started from, or the newer one of a conflict. */
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

  /** Another device saved first: keep this draft over its revision, or load the saved workflow. */
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
  const closeButton = isNew ? (
    isAndroid ? (
      <AndroidHeaderButton
        placement="left"
        icon={X}
        accessibilityLabel={t("common.close")}
        disabled={saving}
        onPress={() => router.back()}
      />
    ) : (
      <Stack.Toolbar placement="left">
        <Stack.Toolbar.Button
          icon="xmark"
          accessibilityLabel={t("common.close")}
          disabled={saving}
          onPress={() => router.back()}
        >
          {t("common.close")}
        </Stack.Toolbar.Button>
      </Stack.Toolbar>
    )
  ) : null;

  if (!draft || !problems || (workflowId && draft.workflowId !== workflowId))
    return (
      <SettingsContent>
        {screenTitle}
        {closeButton}
        <SettingsNote>
          {detail.isError
            ? errorMessage(detail.error, t("mobile.workflow.detail.loadFailed"))
            : t("mobile.workflow.list.loading")}
        </SettingsNote>
      </SettingsContent>
    );

  const byId = new Map(draft.graph.nodes.map((node) => [node.id, node]));
  const editable = draft.mode !== "read-only";
  const stepRow = (node: WorkflowNode, canEdit = editable) => (
    <EditorStepRow
      key={node.id}
      node={node}
      agents={serverAgents}
      draft={draft}
      editable={canEdit}
      problem={problems.steps.get(node.id)}
    />
  );
  const row = (id: string) => {
    const node = byId.get(id);
    return node ? stepRow(node) : null;
  };
  const outline = draft.mode === "outline" ? draft.outline : null;
  const trigger = draft.graph.nodes.find((node) => node.kind === "trigger");
  // The first problem names its step; a tap opens that step. The name has no page, so it only shows.
  const problemNode = firstProblem?.nodeId ? byId.get(firstProblem.nodeId) : undefined;
  // A new workflow has no name yet: that shows only after the first change.
  const problemShown = Boolean(firstProblem?.nodeId) || changed;

  return (
    <SettingsContent>
      {screenTitle}
      {closeButton}
      {editable ? (
        <SheetSaveAction
          dirty={changed || isNew}
          canSave={!firstProblem && !saving}
          pending={saving}
          label={isNew ? t("mobile.workflow.editor.create") : t("mobile.workflow.editor.save")}
          onSave={() => void save(draft.baseRevision)}
        />
      ) : null}
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
      {draft.mode === "fields" ? <SettingsNote>{t("mobile.workflow.editor.fieldsOnly")}</SettingsNote> : null}
      {draft.mode === "read-only" ? <SettingsNote>{t("mobile.workflow.detail.newerApp")}</SettingsNote> : null}
      {trigger ? (
        <SettingsSection title={t("mobile.workflow.detail.trigger")}>{stepRow(trigger)}</SettingsSection>
      ) : null}
      {outline ? (
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
      ) : (
        <SettingsSection title={t("mobile.workflow.detail.stepsTitle")}>
          {readingOrder(draftGraph(draft))
            .filter((node) => node.kind !== "trigger")
            .map((node) => stepRow(node, draft.mode === "fields" && node.kind !== "image" && node.kind !== "asset"))}
        </SettingsSection>
      )}
      {draft.graph.nodes.some((node) => node.kind === "note" || node.kind === "text" || node.kind === "shape") ||
      draft.graph.strokes.length > 0 ? (
        <SettingsNote>{t("mobile.workflow.editor.annotationsKept")}</SettingsNote>
      ) : null}
    </SettingsContent>
  );
}
