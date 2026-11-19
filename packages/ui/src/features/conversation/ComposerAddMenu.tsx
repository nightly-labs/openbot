import {
  AudioLines,
  CircleDot,
  DropdownMenu,
  File,
  MessageCirclePlus,
  MessageCircleQuestionMark,
  Plus,
  Puzzle,
} from "@openbot/ui";
import { useText } from "@openbot/ui/text";
import { createSignal, Show } from "solid-js";
import type { AgentProfile } from "../../data";
import { AgentNewChatDialog } from "./AgentNewChatDialog";

export interface ComposerAddMenuProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  disabled: boolean;
  attachDisabled?: boolean | undefined;
  onAttach?: (() => void) | undefined;
  onPickSkill?: (() => void) | undefined;
  onTeach?: (() => void) | undefined;
  onSideQuestion?: (() => void) | undefined;
  onVoice?: (() => void) | undefined;
  newChat?:
    | {
        agent: Pick<AgentProfile, "name" | "avatarSeed" | "avatarHue" | "avatarUrl">;
        start: () => Promise<void>;
        disabled?: boolean | undefined;
      }
    | undefined;
}

export function ComposerAddMenu(props: ComposerAddMenuProps) {
  const { t } = useText();
  const [confirmingNewChat, setConfirmingNewChat] = createSignal(false);
  let skillPickerChosen = false;
  const attach = () => {
    props.onOpenChange(false);
    props.onAttach?.();
  };
  const attachFromKey = (event: KeyboardEvent) => {
    if (event.key === "Enter" || event.key === " ") attach();
  };
  return (
    <>
      <DropdownMenu.Root
        open={props.open}
        onOpenChange={(open) => {
          props.onOpenChange(open);
          const chosen = skillPickerChosen;
          skillPickerChosen = false;
          if (open || !chosen) return;
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
                <File aria-hidden="true" />
                <span>{t("composer.add.files")}</span>
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
            <Show when={props.onTeach}>
              {(teach) => (
                <DropdownMenu.Item onSelectAfterClose={() => teach()()}>
                  <CircleDot class="composer-add-record" aria-hidden="true" />
                  <span>{t("composer.add.teach")}</span>
                </DropdownMenu.Item>
              )}
            </Show>
            <Show when={props.onSideQuestion}>
              {(open) => (
                <>
                  <DropdownMenu.Separator />
                  <DropdownMenu.Item
                    onSelectAfterClose={() => {
                      requestAnimationFrame(() => open()());
                    }}
                  >
                    <MessageCircleQuestionMark aria-hidden="true" />
                    <span>{t("conversation.sidePanel.pane.question")}</span>
                  </DropdownMenu.Item>
                </>
              )}
            </Show>
            <Show when={props.onVoice}>
              {(open) => (
                <DropdownMenu.Item
                  onSelectAfterClose={() => {
                    requestAnimationFrame(() => open()());
                  }}
                >
                  <AudioLines aria-hidden="true" />
                  <span>{t("conversation.sidePanel.pane.voice")}</span>
                </DropdownMenu.Item>
              )}
            </Show>
            <Show when={props.newChat}>
              {(newChat) => (
                <>
                  <DropdownMenu.Separator />
                  <DropdownMenu.Item
                    disabled={newChat().disabled ?? false}
                    onSelectAfterClose={() => setConfirmingNewChat(true)}
                  >
                    <MessageCirclePlus aria-hidden="true" />
                    <span>{t("composer.newChat.action")}</span>
                  </DropdownMenu.Item>
                </>
              )}
            </Show>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
      <Show when={props.newChat}>
        {(newChat) => (
          <AgentNewChatDialog
            agent={newChat().agent}
            open={confirmingNewChat()}
            onClose={() => setConfirmingNewChat(false)}
            start={() => newChat().start()}
          />
        )}
      </Show>
    </>
  );
}
