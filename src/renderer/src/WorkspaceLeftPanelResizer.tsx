import { PanelResizer, savePanelWidth } from "./components/PanelResizer";
import { useI18n } from "./features/i18n/i18n-context";
import { useLayout } from "./layout";
import {
  LEFT_PANEL_COLLAPSE_THRESHOLD,
  LEFT_PANEL_COMPACT,
  LEFT_PANEL_DEFAULT,
  LEFT_PANEL_EXPAND_THRESHOLD,
  LEFT_PANEL_MAX,
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
  const i18n = useI18n();

  return (
    <PanelResizer
      class="left-panel-resizer"
      label={i18n.t("common.resizeLeftSidebar")}
      controls="agent-sidebar"
      direction="left"
      value={layout.leftPanelWidth()}
      defaultValue={LEFT_PANEL_DEFAULT}
      min={LEFT_PANEL_MIN}
      max={LEFT_PANEL_MAX}
      onResize={layout.setLeftPanelWidth}
      onResizeEnd={(value) => savePanelWidth(LEFT_PANEL_STORAGE_KEY, value)}
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
