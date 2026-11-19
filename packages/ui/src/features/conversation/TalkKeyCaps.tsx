import { ArrowBigUp, ChevronUp, Command, CornerDownLeft, Kbd, Option } from "@openbot/ui";
import { useText } from "@openbot/ui/text";
import type { JSX } from "@solidjs/web";
import { For } from "solid-js";
import { type TalkKeyBinding, type TalkKeySymbol, talkKeyParts } from "./talk-key";

/** The macOS symbols as icons, which sit in the middle of the cap; the ⌃ character sits high in each font. */
const SYMBOL_ICONS: Record<TalkKeySymbol, (props: { class?: string }) => JSX.Element> = {
  ctrl: ChevronUp,
  alt: Option,
  shift: ArrowBigUp,
  meta: Command,
  enter: CornerDownLeft,
};

/**
 * The push to talk chord, one key cap for each key: ⌃⌥⇧⌘ on a Mac, words elsewhere. Screen readers get
 * the chord from the control that shows it.
 */
export function TalkKeyCaps(props: { binding: TalkKeyBinding; class?: string | undefined }) {
  const { t } = useText();
  return (
    <span class={props.class} aria-hidden="true">
      <For each={talkKeyParts(props.binding)}>
        {(part) => {
          if ("symbol" in part) {
            const Icon = SYMBOL_ICONS[part.symbol];
            return (
              <Kbd class="talk-key-symbol">
                <Icon />
              </Kbd>
            );
          }
          return <Kbd>{"text" in part ? t(part.text) : part.cap}</Kbd>;
        }}
      </For>
    </span>
  );
}
