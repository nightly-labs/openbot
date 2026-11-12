import { Stack } from "expo-router";
import type { MenuAction } from "@/shared/components/menu-view";

/**
 * The items of a `MenuView` menu as items of a native bar menu, so one list of actions serves both.
 * A group with `displayInline` is an inline section; other groups are submenus. Call it in place of
 * the children: on iOS, a bar menu reads only its direct `Stack.Toolbar.Menu` and
 * `Stack.Toolbar.MenuAction` children, so the items inside a wrapper component do not show.
 */
export function toolbarMenuItems(actions: readonly MenuAction[], onPressAction: (id: string) => void) {
  return actions.map((action, index) => {
    const key = action.id ?? `${action.title}:${index}`;
    const icon = typeof action.image === "string" ? action.image : undefined;
    if (action.subactions) {
      return (
        <Stack.Toolbar.Menu
          key={key}
          inline={action.displayInline}
          title={action.title || undefined}
          icon={icon}
          hidden={action.attributes?.hidden}
          disabled={action.attributes?.disabled}
        >
          {toolbarMenuItems(action.subactions, onPressAction)}
        </Stack.Toolbar.Menu>
      );
    }
    return (
      <Stack.Toolbar.MenuAction
        key={key}
        icon={icon}
        isOn={action.state === "on"}
        destructive={action.attributes?.destructive}
        disabled={action.attributes?.disabled}
        hidden={action.attributes?.hidden}
        onPress={() => {
          if (action.id) onPressAction(action.id);
        }}
      >
        {action.title}
      </Stack.Toolbar.MenuAction>
    );
  });
}
