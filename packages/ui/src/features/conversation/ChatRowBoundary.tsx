import type { JSX } from "@solidjs/web";
import { Errored } from "solid-js";
import { useText } from "../../text";

/** A chat row that fails to draw shows a short notice, so the rest of the transcript stays usable. */
export function ChatRowBoundary(props: { children: JSX.Element }) {
  const { t } = useText();
  return (
    <Errored
      fallback={
        <p class="chat-row-unavailable" role="status">
          {t("chat.row.unavailable")}
        </p>
      }
    >
      {props.children}
    </Errored>
  );
}
