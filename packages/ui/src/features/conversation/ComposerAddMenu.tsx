import { AudioLines, DropdownMenu, File, Image, MessageCircleQuestionMark, Plus, Puzzle } from "@openbot/ui";
import { useText } from "@openbot/ui/text";
import { Show } from "solid-js";

export interface ComposerAddMenuProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  disabled: boolean;
  attachDisabled?: boolean | undefined;
  /** Opens the file picker. Without it, the menu has no image or context item. */
  onAttach?: (() => void) | undefined;
  /** Opens the skill picker of the editor, after the menu gave the focus back. Without it, no skill item. */
  onPickSkill?: (() => void) | undefined;
  /** Without it, no side question item. */
  onSideQuestion?: (() => void) | undefined;
  /** Without it, no voice conversation item. */
  onVoice?: (() => void) | undefined;
}

/** The "+" menu of a message box: files, skills, and the side panes of the agent. */
export function ComposerAddMenu(props: ComposerAddMenuProps) {
  const { t } = useText();
  let skillPickerChosen = false;
  // The browser opens a file picker only in the event of the click or the key.
  const attach = () => {
    props.onOpenChange(false);
    props.onAttach?.();
  };
  const attachFromKey = (event: KeyboardEvent) => {
    if (event.key === "Enter" || event.key === " ") attach();
  };
  return (
    <DropdownMenu.Root
      open={props.open}
      onOpenChange={(open) => {
        props.onOpenChange(open);
        const chosen = skillPickerChosen;
        skillPickerChosen = false;
        if (open || !chosen) return;
        // The menu gives the focus back to its trigger two frames after it closes; open the picker after that.
        requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(() => props.onPickSkill?.())));
      }}
      placement="top-start"
      gutter={8}
      modal={false}
    >
      <DropdownMenu.Trigger class="composer-button" aria-label={t("composer.add.label")} disabled={props.disabled}>
        <Plus aria-hidden="true" />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content aria-label={t("composer.add.label")}>
          <Show when={props.onAttach}>
            <DropdownMenu.Item
              disabled={props.attachDisabled ?? false}
              onPointerDown={(event) => {
                if (event.button === 0) attach();
              }}
              onKeyDown={attachFromKey}
            >
              <Image aria-hidden="true" />
              <span>{t("composer.add.image")}</span>
            </DropdownMenu.Item>
          </Show>
          <Show when={props.onPickSkill}>
            <DropdownMenu.Item
              onPointerDown={(event) => {
                if (event.button === 0) skillPickerChosen = true;
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") skillPickerChosen = true;
              }}
            >
              <Puzzle aria-hidden="true" />
              <span>{t("composer.add.skill")}</span>
            </DropdownMenu.Item>
          </Show>
          <Show when={props.onAttach}>
            <DropdownMenu.Item
              disabled={props.attachDisabled ?? false}
              onPointerDown={(event) => {
                if (event.button === 0) attach();
              }}
              onKeyDown={attachFromKey}
            >
              <File aria-hidden="true" />
              <span>{t("composer.add.context")}</span>
            </DropdownMenu.Item>
          </Show>
          <Show when={props.onSideQuestion}>
            {(open) => (
              <>
                <DropdownMenu.Separator />
                <DropdownMenu.Item
                  onSelectAfterClose={() => {
                    // The menu gives the focus back first. A side panel tab that gets it selects its
                    // pane, so open the side question after that.
                    requestAnimationFrame(() => open()());
                  }}
                >
                  <MessageCircleQuestionMark aria-hidden="true" />
                  <span>{t("conversation.sidePanel.pane.question")}</span>
                </DropdownMenu.Item>
              </>
            )}
          </Show>
          {/* Only where a side question is: after its separator. */}
          <Show when={props.onVoice}>
            {(open) => (
              <DropdownMenu.Item
                onSelectAfterClose={() => {
                  // As for the side question: open the pane after the menu gives the focus back.
                  requestAnimationFrame(() => open()());
                }}
              >
                <AudioLines aria-hidden="true" />
                <span>{t("conversation.sidePanel.pane.voice")}</span>
              </DropdownMenu.Item>
            )}
          </Show>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
