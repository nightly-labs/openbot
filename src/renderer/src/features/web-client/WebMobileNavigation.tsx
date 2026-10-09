import type { AppTextKey } from "@openbot/i18n";
import { Button, Globe2, MessageCircle, Workflow } from "@openbot/ui";
import { useText } from "@openbot/ui/text";
import { Dynamic } from "@solidjs/web";
import { For } from "solid-js";

export type WebMobilePane = "conversation" | "workspace";

interface WebMobileNavigationProps {
  activePane: WebMobilePane;
  /** The Routines view is on: the conversation pane shows the routine canvas. */
  routines?: boolean;
  onChange: (pane: WebMobilePane) => void;
}

interface PaneButton {
  id: WebMobilePane;
  label: AppTextKey;
  Icon: typeof MessageCircle;
}

const PANES: ReadonlyArray<PaneButton> = [
  { id: "conversation", label: "webClient.pane.chat", Icon: MessageCircle },
  { id: "workspace", label: "webClient.pane.workspace", Icon: Globe2 },
];

/** The small-screen switch for the existing workspace and conversation surfaces. */
export function WebMobileNavigation(props: WebMobileNavigationProps) {
  const { t } = useText();
  const shown = (pane: PaneButton): PaneButton =>
    pane.id === "conversation" && props.routines ? { ...pane, label: "webClient.pane.routines", Icon: Workflow } : pane;
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
              <Dynamic component={shown(pane).Icon} aria-hidden="true" />
              <span>{t(shown(pane).label)}</span>
            </Button>
          )}
        </For>
      </div>
    </nav>
  );
}
