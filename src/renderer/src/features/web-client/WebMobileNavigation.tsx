import type { AppTextKey } from "@openbot/i18n";
import { Button, Globe2, MessageCircle } from "@openbot/ui";
import { useText } from "@openbot/ui/text";
import { Dynamic } from "@solidjs/web";
import { For } from "solid-js";

export type WebMobilePane = "conversation" | "workspace";

interface WebMobileNavigationProps {
  activePane: WebMobilePane;
  onChange: (pane: WebMobilePane) => void;
}

const PANES: ReadonlyArray<{
  id: WebMobilePane;
  label: AppTextKey;
  Icon: typeof MessageCircle;
}> = [
  { id: "conversation", label: "webClient.pane.chat", Icon: MessageCircle },
  { id: "workspace", label: "webClient.pane.workspace", Icon: Globe2 },
];

/** The small-screen switch for the existing workspace and conversation surfaces. */
export function WebMobileNavigation(props: WebMobileNavigationProps) {
  const { t } = useText();
  return (
    <nav class="web-mobile-navigation" aria-label={t("webClient.pane.navigation")}>
      <div class="web-mobile-navigation-list">
        <For each={PANES}>
          {(pane) => (
            <Button
              variant="ghost"
              type="button"
              class="web-mobile-navigation-button"
              data-active={props.activePane === pane.id ? "true" : undefined}
              aria-pressed={props.activePane === pane.id ? "true" : "false"}
              onClick={() => props.onChange(pane.id)}
            >
              <Dynamic component={pane.Icon} aria-hidden="true" />
              <span>{t(pane.label)}</span>
            </Button>
          )}
        </For>
      </div>
    </nav>
  );
}
