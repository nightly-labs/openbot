import type { WorkflowNode } from "@openbot/contracts/ipc";
import { router } from "expo-router";
import { Alert } from "react-native";
import { useWorkflowDraft, type WorkflowDraft } from "@/features/workflows/model/workflow-draft";
import { type GraphPlace, placeParams } from "@/features/workflows/model/workflow-graph-edit";
import { canMove, type FlowList, outlineListOf } from "@/features/workflows/model/workflow-outline";
import type { MenuAction } from "@/shared/components/menu-view";
import { haptics } from "@/shared/lib/haptics";
import { currentText, useText } from "@/shared/lib/text";

/** Opens the page of a step: the trigger page for the trigger. */
export function openStep(node: WorkflowNode) {
  if (node.kind === "trigger") router.push({ pathname: "/workflow-editor/trigger", params: { nodeId: node.id } });
  else router.push({ pathname: "/workflow-editor/step", params: { nodeId: node.id } });
}

/** Opens Add a step at a place of a list. */
export function openAddStep(list: FlowList, index: number) {
  router.push({ pathname: "/workflow-editor/add", params: { list, index: String(index) } });
}

/** Opens Add a step at a place of a workflow that the outline cannot hold. */
export function openAddStepAt(place: GraphPlace) {
  router.push({ pathname: "/workflow-editor/add", params: placeParams(place) });
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

/**
 * The menu of a step in the editor, the same in the list and in the flow: move, duplicate, add after
 * and delete a step of the outline, or connect and delete a step that the trigger does not reach.
 * `structural` is false when the step has no menu: the trigger, or a workflow that the phone does not
 * edit as an outline.
 */
export function useWorkflowStepMenu(node: WorkflowNode, draft: WorkflowDraft) {
  const { t } = useText();
  const { move, duplicate, remove, connect } = useWorkflowDraft.getState();
  const outline = draft.mode === "outline" ? draft.outline : null;
  const list = outline ? outlineListOf(outline, node.id) : null;
  const loose = list === "loose";
  const structural = Boolean(outline) && node.kind !== "trigger";
  const flowList: FlowList | null = list && list !== "loose" ? list : null;
  const deleteGroup: MenuAction = {
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
  };
  const actions: MenuAction[] = loose
    ? [
        ...(node.kind === "condition"
          ? []
          : [{ id: "connect", title: t("mobile.workflow.editor.connect"), image: "plus" } satisfies MenuAction]),
        deleteGroup,
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
        deleteGroup,
      ];
  const onAction = (id: string) => {
    if (id === "up") move(node.id, -1);
    else if (id === "down") move(node.id, 1);
    else if (id === "copy") duplicate(node.id);
    else if (id === "connect") {
      void haptics.selection();
      connect(node.id);
    } else if (id === "delete") confirmRemove(node, draft, remove);
    else if (id === "add" && flowList && outline) openAddStep(flowList, outline[flowList].indexOf(node.id) + 1);
  };
  return { structural, actions, onAction };
}
