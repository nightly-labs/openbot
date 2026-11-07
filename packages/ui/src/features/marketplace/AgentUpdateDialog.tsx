import { ConfirmDialog, RadioGroup, TriangleAlert } from "@openbot/ui";
import { createScrollFades } from "@openbot/ui/components/createScrollFades";
import { useText } from "@openbot/ui/text";
import { createStore, For, onCleanup, Show } from "solid-js";

/** A skill of the update whose copy on the agent has local changes. */
export interface AgentUpdateChangedSkill {
  skillId: string;
  name: string;
}

export interface AgentUpdateDialogProps {
  agentName: string;
  /** The skills of the update with local changes. Each one is kept unless the user picks Replace. */
  changed: readonly AgentUpdateChangedSkill[];
  /** The number of other skills of the update, which update with no question. */
  othersCount: number;
  onCancel: () => void;
  /** The ids of the changed skills that the update replaces. */
  onConfirm: (replaceSkillIds: string[]) => void;
}

/**
 * Asks before an agent update that meets skills with local changes. Each changed skill keeps the
 * user's files unless the user picks Replace on its row; the other skills update with no question.
 */
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
      </div>
      <Show when={props.othersCount > 0}>
        <p class="marketplace-agent-update-others">
          {t("marketplace.agentUpdate.others", { count: props.othersCount })}
        </p>
      </Show>
    </ConfirmDialog>
  );
}
