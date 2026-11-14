import { PanelResizer } from "@openbot/ui/components/PanelResizer";
import { useText } from "@openbot/ui/text";
import { savePanelWidth } from "./components/panel-width-storage";
import { useLayout } from "./layout";
import {
  LEFT_PANEL_COLLAPSE_THRESHOLD,
  LEFT_PANEL_COMPACT,
  LEFT_PANEL_DEFAULT,
  LEFT_PANEL_EXPAND_THRESHOLD,
  LEFT_PANEL_MIN,
  LEFT_PANEL_STORAGE_KEY,
} from "./layout-constants";

/**
 * The drag handle between the left column and the conversation. The one place
 * that turns a width into the compact state, which is why the thresholds are
 * read here and not in `layout.tsx`: the context owns whether the sidebar is
 * compact, the gesture owns when to say so.
 */
export function WorkspaceLeftPanelResizer() {
  const layout = useLayout();
  const { t } = useText();

  return (
    <PanelResizer
      class="left-panel-resizer"
      label={t("app.leftPanel.resize")}
      controls="agent-sidebar"
      direction="left"
      value={layout.leftPanelShownWidth()}
      defaultValue={LEFT_PANEL_DEFAULT}
      min={LEFT_PANEL_MIN}
      max={layout.leftPanelMaxWidth()}
      // With no room beside the chat, the drag can only reach the smallest width. That width is not the
      // user's choice, so it is not kept.
      onResize={(value) => {
        if (layout.leftPanelMaxWidth() > LEFT_PANEL_MIN) layout.setLeftPanelWidth(value);
      }}
      onResizeEnd={(value) => {
        if (layout.leftPanelMaxWidth() > LEFT_PANEL_MIN) savePanelWidth(LEFT_PANEL_STORAGE_KEY, value);
      }}
      snap={{
        compactValue: LEFT_PANEL_COMPACT,
        compact: layout.leftPanelCompact(),
        collapseThreshold: LEFT_PANEL_COLLAPSE_THRESHOLD,
        expandThreshold: LEFT_PANEL_EXPAND_THRESHOLD,
        onCompactChange: (compact) => {
          if (compact) layout.setSidebarCollapsed(true);
          else layout.expandSidebar();
        },
      }}
    />
  );
}
