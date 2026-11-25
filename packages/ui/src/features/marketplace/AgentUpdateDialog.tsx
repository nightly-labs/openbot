import { ConfirmDialog, RadioGroup, TriangleAlert } from "@openbot/ui";
import { createScrollFades } from "@openbot/ui/components/createScrollFades";
import { ScrollEdgeBlur } from "@openbot/ui/components/ScrollEdgeBlur";
import { useText } from "@openbot/ui/text";
import { createStore, For, onCleanup, Show } from "solid-js";

export interface AgentUpdateChangedSkill {
  skillId: string;
  name: string;
}

export interface AgentUpdateDialogProps {
  agentName: string;
  changed: readonly AgentUpdateChangedSkill[];
  othersCount: number;
  onCancel: () => void;
  onConfirm: (replaceSkillIds: string[]) => void;
}

export function AgentUpdateDialog(props: AgentUpdateDialogProps) {
  const { t } = useText();
  const [replace, setReplace] = createStore<Record<string, boolean>>({});
  const fades = createScrollFades();
  onCleanup(() => fades.stop());
  return (
    <ConfirmDialog
      open={true}
      tone="default"
      icon={<TriangleAlert />}
      title={t("marketplace.agentUpdate.title", { name: props.agentName })}
      description={t("marketplace.agentUpdate.body", { count: props.changed.length })}
      confirmLabel={t("marketplace.agentUpdate.confirm")}
      initialFocus="cancel"
      onCancel={props.onCancel}
      onConfirm={() => props.onConfirm(props.changed.filter((skill) => replace[skill.skillId]).map((s) => s.skillId))}
    >
      <div class="marketplace-agent-update-frame">
        <ul
          class={["marketplace-agent-update-list", fades.classes()]}
          aria-label={t("marketplace.agentUpdate.listLabel")}
          ref={(element: HTMLUListElement) => fades.bind(element)}
          onScroll={fades.measure}
        >
          <For each={props.changed} keyed={(skill) => skill.skillId}>
            {(skill) => (
              <li class="marketplace-agent-update-row" data-replace={replace[skill().skillId] ? "" : undefined}>
                <span class="marketplace-agent-update-text">
                  <span class="marketplace-agent-update-name">{skill().name}</span>
                  <span class="marketplace-agent-update-state">
                    {replace[skill().skillId] ? t("marketplace.agentUpdate.lost") : t("marketplace.agentUpdate.keep")}
                  </span>
                </span>
                <RadioGroup.Root
                  class="marketplace-agent-update-choice"
                  aria-label={t("marketplace.agentUpdate.choiceLabel", { name: skill().name })}
                  value={replace[skill().skillId] ? "replace" : "keep"}
                  onChange={(value) =>
                    setReplace((draft) => {
                      draft[skill().skillId] = value === "replace";
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
        <ScrollEdgeBlur fades={fades} />
      </div>
      <Show when={props.othersCount > 0}>
        <p class="marketplace-agent-update-others">
          {t("marketplace.agentUpdate.others", { count: props.othersCount })}
        </p>
      </Show>
    </ConfirmDialog>
  );
}
