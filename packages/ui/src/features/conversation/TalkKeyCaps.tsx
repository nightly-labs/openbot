import { ArrowBigUp, ChevronUp, Command, CornerDownLeft, Kbd, Option } from "@openbot/ui";
import { useText } from "@openbot/ui/text";
import type { JSX } from "@solidjs/web";
import { For } from "solid-js";
import { type TalkKeyBinding, type TalkKeySymbol, talkKeyParts } from "./talk-key";

const SYMBOL_ICONS: Record<TalkKeySymbol, (props: { class?: string }) => JSX.Element> = {
  ctrl: ChevronUp,
  alt: Option,
  shift: ArrowBigUp,
  meta: Command,
  enter: CornerDownLeft,
};

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
