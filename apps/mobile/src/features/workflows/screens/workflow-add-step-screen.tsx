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
import { useWorkflowAssetsSupported, useWorkflowMediaSupported } from "@/features/workflows/model/use-workflows";
import { ADD_GROUPS, type AddKey, addFields, addKind } from "@/features/workflows/model/workflow-add";
import { useWorkflowDraft } from "@/features/workflows/model/workflow-draft";
import { placeFromParams, placeKeys } from "@/features/workflows/model/workflow-graph-edit";
import { FLOW_LISTS, type FlowList, hasCondition, outlineKeys } from "@/features/workflows/model/workflow-outline";
import { addKeyLabel } from "@/features/workflows/model/workflow-steps";
import { haptics } from "@/shared/lib/haptics";
import { useText } from "@/shared/lib/text";

const KEY_DESCRIPTION = {
  prompt: "mobile.workflow.add.prompt",
  asset: "mobile.workflow.add.asset",
  llm: "mobile.workflow.add.llm",
  agent: "mobile.workflow.add.agent",
  image: "mobile.workflow.add.image",
  video: "mobile.workflow.add.video",
  condition: "mobile.workflow.add.condition",
  approval: "mobile.workflow.add.approval",
  output: "mobile.workflow.add.output",
} as const satisfies Record<AddKey, MobileTextKey>;

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
  const mediaSupported = useWorkflowMediaSupported(draft?.serverId ?? "");
  const assetsSupported = useWorkflowAssetsSupported(draft?.serverId ?? "");
  const shown = (key: AddKey) =>
    key === "asset" ? assetsSupported : key === "image" || key === "video" ? mediaSupported : true;
  const place = placeFromParams(params);
  const list: FlowList = FLOW_LISTS.find((name) => name === params.list) ?? "main";
  const index = Number(params.index) || 0;
  const conditionAllowed = place !== null || (list === "main" && draft !== null && !hasCondition(draft.graph));
  const allowed: readonly AddKey[] = !draft
    ? []
    : place
      ? placeKeys(draft.graph, place)
      : draft.outline
        ? outlineKeys(draft.graph, draft.outline, list, index)
        : [];
  return (
    <SettingsContent>
      {ADD_GROUPS.map((group) => (
        <SettingsSection key={group.label} title={t(group.label)}>
          {group.keys.filter(shown).map((key) => (
            <SettingsRow
              key={key}
              disabled={!allowed.includes(key)}
              leading={<WorkflowKindTile kind={addKind(key)} fields={addFields(key)} size={34} />}
              supportingText={t(KEY_DESCRIPTION[key])}
              onPress={() => {
                if (!(place ? addAt(key, place) : add(key, list, index))) return;
                void haptics.impact("light");
                router.back();
              }}
            >
              <Typography.Paragraph>{addKeyLabel(key, t)}</Typography.Paragraph>
            </SettingsRow>
          ))}
        </SettingsSection>
      ))}
      {conditionAllowed ? null : <SettingsNote>{t("mobile.workflow.add.oneCondition")}</SettingsNote>}
    </SettingsContent>
  );
}
