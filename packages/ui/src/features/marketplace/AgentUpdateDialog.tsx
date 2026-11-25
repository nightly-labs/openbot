import type { AgentMarketplaceProfileField } from "@openbot/contracts/ipc";
import type { AppTextKey } from "@openbot/i18n";
import { ConfirmDialog, RadioGroup, TriangleAlert } from "@openbot/ui";
import { createScrollFades } from "@openbot/ui/components/createScrollFades";
import { useText } from "@openbot/ui/text";
import { createStore, For, onCleanup, Show } from "solid-js";

export interface AgentUpdateChangedSkill {
  skillId: string;
  name: string;
}

export interface AgentUpdateDialogProps {
  agentName: string;
  changed: readonly AgentUpdateChangedSkill[];
  fields?: readonly AgentMarketplaceProfileField[] | undefined;
  othersCount: number;
  onCancel: () => void;
  onConfirm: (replaceSkillIds: string[], replaceFields: AgentMarketplaceProfileField[]) => void;
}

const FIELD_LABEL = {
  name: "marketplace.agentUpdate.field.name",
  title: "marketplace.agentUpdate.field.title",
  description: "marketplace.agentUpdate.field.description",
  picture: "marketplace.agentUpdate.field.picture",
} as const satisfies Record<AgentMarketplaceProfileField, AppTextKey>;

interface UpdateRow {
  id: string;
  name: string;
  field: AgentMarketplaceProfileField | null;
}

export function AgentUpdateDialog(props: AgentUpdateDialogProps) {
  const { t } = useText();
  const [replace, setReplace] = createStore<Record<string, boolean>>({});
  const fades = createScrollFades();
  onCleanup(() => fades.stop());
  const fields = () => props.fields ?? [];
  const rows = (): UpdateRow[] => [
    ...fields().map((field) => ({ id: `field:${field}`, name: t(FIELD_LABEL[field]), field })),
    ...props.changed.map((skill) => ({ id: skill.skillId, name: skill.name, field: null })),
  ];
  const stateText = (row: UpdateRow) => {
    if (row.field)
      return t(replace[row.id] ? "marketplace.agentUpdate.fieldReplace" : "marketplace.agentUpdate.fieldKeep");
    return t(replace[row.id] ? "marketplace.agentUpdate.lost" : "marketplace.agentUpdate.keep");
  };
  return (
    <ConfirmDialog
      open={true}
      tone="default"
      icon={<TriangleAlert />}
      title={t("marketplace.agentUpdate.title", { name: props.agentName })}
      description={
        fields().length > 0
          ? t("marketplace.agentUpdate.bodyParts", { count: rows().length })
          : t("marketplace.agentUpdate.body", { count: props.changed.length })
      }
      confirmLabel={t("marketplace.agentUpdate.confirm")}
      initialFocus="cancel"
      onCancel={props.onCancel}
      onConfirm={() =>
        props.onConfirm(
          props.changed.filter((skill) => replace[skill.skillId]).map((s) => s.skillId),
          fields().filter((field) => replace[`field:${field}`]),
        )
      }
    >
      <div class="marketplace-agent-update-frame">
        <ul
          class={["marketplace-agent-update-list", fades.classes()]}
          aria-label={t(
            fields().length > 0 ? "marketplace.agentUpdate.listLabelParts" : "marketplace.agentUpdate.listLabel",
          )}
          ref={(element: HTMLUListElement) => fades.bind(element)}
          onScroll={fades.measure}
        >
          <For each={rows()} keyed={(row) => row.id}>
            {(row) => (
              <li class="marketplace-agent-update-row" data-replace={replace[row().id] ? "" : undefined}>
                <span class="marketplace-agent-update-text">
                  <span class="marketplace-agent-update-name">{row().name}</span>
                  <span class="marketplace-agent-update-state">{stateText(row())}</span>
                </span>
                <RadioGroup.Root
                  class="marketplace-agent-update-choice"
                  aria-label={t("marketplace.agentUpdate.choiceLabel", { name: row().name })}
                  value={replace[row().id] ? "replace" : "keep"}
                  onChange={(value) =>
                    setReplace((draft) => {
                      draft[row().id] = value === "replace";
                    })
                  }
                >
                  <RadioGroup.Item value="keep" class="marketplace-agent-update-option">
                    <RadioGroup.ItemInput />
                    <RadioGroup.ItemLabel class="marketplace-agent-update-option-label">
                      {t("marketplace.agentUpdate.keepOption")}
                    </RadioGroup.ItemLabel>
                  </RadioGroup.Item>
                  <RadioGroup.Item value="replace" class="marketplace-agent-update-option" data-choice="replace">
                    <RadioGroup.ItemInput />
                    <RadioGroup.ItemLabel class="marketplace-agent-update-option-label">
                      {t("marketplace.agentUpdate.replace")}
                    </RadioGroup.ItemLabel>
                  </RadioGroup.Item>
                </RadioGroup.Root>
              </li>
            )}
          </For>
        </ul>
      </div>
      <Show when={props.othersCount > 0}>
        <p class="marketplace-agent-update-others">
          {t("marketplace.agentUpdate.others", { count: props.othersCount })}
        </p>
      </Show>
    </ConfirmDialog>
  );
}
