import type { MobileTextKey } from "@openbot/i18n/mobile";
import { router, useLocalSearchParams } from "expo-router";
import { Typography } from "heroui-native";
import {
  SettingsContent,
  SettingsNote,
  SettingsRow,
  SettingsSection,
} from "@/features/settings/components/settings-content";
import { WorkflowKindTile } from "@/features/workflows/components/workflow-kind-tile";
import { useWorkflowDraft } from "@/features/workflows/model/workflow-draft";
import { placeFromParams, placeKinds } from "@/features/workflows/model/workflow-graph-edit";
import {
  ADDABLE_KINDS,
  type AddableKind,
  FLOW_LISTS,
  type FlowList,
  hasCondition,
} from "@/features/workflows/model/workflow-outline";
import { kindLabel } from "@/features/workflows/model/workflow-steps";
import { haptics } from "@/shared/lib/haptics";
import { useText } from "@/shared/lib/text";

const KIND_DESCRIPTION = {
  agent: "mobile.workflow.add.agent",
  llm: "mobile.workflow.add.llm",
  condition: "mobile.workflow.add.condition",
  approval: "mobile.workflow.add.approval",
  prompt: "mobile.workflow.add.prompt",
  output: "mobile.workflow.add.output",
} as const satisfies Record<AddableKind, MobileTextKey>;

export function WorkflowAddStepScreen() {
  const { t } = useText();
  const params = useLocalSearchParams<{
    list?: string;
    index?: string;
    edge?: string;
    after?: string;
    branch?: string;
  }>();
  const draft = useWorkflowDraft((state) => state.draft);
  const add = useWorkflowDraft((state) => state.add);
  const addAt = useWorkflowDraft((state) => state.addAt);
  const place = placeFromParams(params);
  const list: FlowList = FLOW_LISTS.find((name) => name === params.list) ?? "main";
  const index = Number(params.index) || 0;
  const conditionAllowed = place !== null || (list === "main" && draft !== null && !hasCondition(draft.graph));
  const allowed: readonly AddableKind[] =
    place && draft
      ? placeKinds(draft.graph, place, ADDABLE_KINDS)
      : ADDABLE_KINDS.filter((kind) => kind !== "condition" || conditionAllowed);
  return (
    <SettingsContent>
      <SettingsSection>
        {ADDABLE_KINDS.map((kind) => (
          <SettingsRow
            key={kind}
            disabled={!allowed.includes(kind)}
            leading={<WorkflowKindTile kind={kind} size={34} />}
            supportingText={t(KIND_DESCRIPTION[kind])}
            onPress={() => {
              if (!(place ? addAt(kind, place) : add(kind, list, index))) return;
              void haptics.impact("light");
              router.back();
            }}
          >
            <Typography.Paragraph>{kindLabel(kind, t)}</Typography.Paragraph>
          </SettingsRow>
        ))}
      </SettingsSection>
      {conditionAllowed ? null : <SettingsNote>{t("mobile.workflow.add.oneCondition")}</SettingsNote>}
    </SettingsContent>
  );
}
