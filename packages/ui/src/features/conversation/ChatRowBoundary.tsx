import type { JSX } from "@solidjs/web";
import { Errored } from "solid-js";
import { useText } from "../../text";

export function ChatRowBoundary(props: { children: JSX.Element }) {
  const { t } = useText();
  return <Errored fallback={<p class="chat-row-unavailable">{t("chat.row.unavailable")}</p>}>{props.children}</Errored>;
}
