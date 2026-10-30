import type { MenuAction, MenuComponentProps, MenuComponentRef } from "@expo/ui/community/menu";
import { Menu, type MenuTriggerRef, Separator, SubMenu, Typography } from "heroui-native";
import type { LucideIcon } from "lucide-react-native";
import Archive from "lucide-react-native/icons/archive";
import ArrowDown from "lucide-react-native/icons/arrow-down";
import ArrowUp from "lucide-react-native/icons/arrow-up";
import ArrowUpDown from "lucide-react-native/icons/arrow-up-down";
import Calendar from "lucide-react-native/icons/calendar";
import ChartColumn from "lucide-react-native/icons/chart-column";
import Circle from "lucide-react-native/icons/circle";
import CircleCheck from "lucide-react-native/icons/circle-check";
import CircleStop from "lucide-react-native/icons/circle-stop";
import ClipboardPaste from "lucide-react-native/icons/clipboard-paste";
import Code from "lucide-react-native/icons/code";
import Copy from "lucide-react-native/icons/copy";
import CopyPlus from "lucide-react-native/icons/copy-plus";
import Crosshair from "lucide-react-native/icons/crosshair";
import Ellipsis from "lucide-react-native/icons/ellipsis";
import Eye from "lucide-react-native/icons/eye";
import EyeOff from "lucide-react-native/icons/eye-off";
import File from "lucide-react-native/icons/file";
import Folder from "lucide-react-native/icons/folder";
import Globe from "lucide-react-native/icons/globe";
import Info from "lucide-react-native/icons/info";
import LayoutGrid from "lucide-react-native/icons/layout-grid";
import Link from "lucide-react-native/icons/link";
import List from "lucide-react-native/icons/list";
import ListChecks from "lucide-react-native/icons/list-checks";
import LogOut from "lucide-react-native/icons/log-out";
import MailBadge from "lucide-react-native/icons/mail-badge";
import MailOpen from "lucide-react-native/icons/mail-open";
import MessagesSquare from "lucide-react-native/icons/messages-square";
import MousePointerClick from "lucide-react-native/icons/mouse-pointer-click";
import Pencil from "lucide-react-native/icons/pencil";
import Pin from "lucide-react-native/icons/pin";
import PinOff from "lucide-react-native/icons/pin-off";
import Play from "lucide-react-native/icons/play";
import Plus from "lucide-react-native/icons/plus";
import RotateCw from "lucide-react-native/icons/rotate-cw";
import Settings from "lucide-react-native/icons/settings";
import Share from "lucide-react-native/icons/share";
import Star from "lucide-react-native/icons/star";
import StarOff from "lucide-react-native/icons/star-off";
import TextWrap from "lucide-react-native/icons/text-wrap";
import Trash2 from "lucide-react-native/icons/trash";
import Users from "lucide-react-native/icons/users";
import X from "lucide-react-native/icons/x";
import {
  Fragment,
  type Ref,
  type RefObject,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { BackHandler, Pressable, StyleSheet, useWindowDimensions, View, type ViewInstance } from "react-native";
import { ScrollView } from "react-native-gesture-handler";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useCSSVariable } from "uniwind";

export type { MenuAction, MenuComponentRef } from "@expo/ui/community/menu";

/** The Lucide icon for each SF Symbol that a menu action names. */
const ICONS: Partial<Record<string, LucideIcon>> = {
  archivebox: Archive,
  "arrow.clockwise": RotateCw,
  "arrow.down": ArrowDown,
  "arrow.up": ArrowUp,
  "arrow.up.arrow.down": ArrowUpDown,
  "bubble.left.and.bubble.right": MessagesSquare,
  calendar: Calendar,
  "chart.bar": ChartColumn,
  "checkmark.circle": CircleCheck,
  "circle.fill": Circle,
  "circlebadge.fill": Circle,
  checklist: ListChecks,
  "chevron.left.forwardslash.chevron.right": Code,
  "cursorarrow.motionlines": MousePointerClick,
  doc: File,
  "doc.on.clipboard": ClipboardPaste,
  "doc.on.doc": Copy,
  ellipsis: Ellipsis,
  "envelope.badge": MailBadge,
  "envelope.open": MailOpen,
  eye: Eye,
  "eye.slash": EyeOff,
  folder: Folder,
  globe: Globe,
  gearshape: Settings,
  "info.circle": Info,
  link: Link,
  "list.bullet": List,
  "person.2": Users,
  pin: Pin,
  "pin.slash": PinOff,
  pencil: Pencil,
  play: Play,
  plus: Plus,
  "plus.square.on.square": CopyPlus,
  "rectangle.portrait.and.arrow.right": LogOut,
  "square.and.arrow.up": Share,
  scope: Crosshair,
  "square.grid.2x2": LayoutGrid,
  star: Star,
  "star.slash": StarOff,
  "stop.circle": CircleStop,
  "text.word.spacing": TextWrap,
  trash: Trash2,
  xmark: X,
};

/**
 * OpenBot colors for the menu. HeroUI's `--muted`, `--danger`, `--separator` and `--default` keep the
 * HeroUI palette, because uniwind ignores the `:root` aliases in `global.css`.
 */
type MenuColors = { text: string; muted: string; danger: string; separator: string; pressed: string };

type ItemProps = {
  action: MenuAction;
  colors: MenuColors;
  onPressAction: MenuComponentProps["onPressAction"];
};

function actionId(action: MenuAction): string {
  return action.id ?? action.title;
}

function visible(actions: MenuAction[]): MenuAction[] {
  return actions.filter((action) => !action.attributes?.hidden);
}

/** The top-level actions in groups. Each inline action is its own group, and dividers go between groups. */
function groups(actions: MenuAction[]): MenuAction[][] {
  const result: MenuAction[][] = [];
  let loose: MenuAction[] = [];
  for (const action of visible(actions)) {
    if (!action.displayInline || !action.subactions) {
      loose.push(action);
      continue;
    }
    if (loose.length) result.push(loose);
    loose = [];
    result.push(visible(action.subactions));
  }
  if (loose.length) result.push(loose);
  return result.filter((group) => group.length > 0);
}

function MenuItem({ action, colors, onPressAction }: ItemProps) {
  const { subactions, state, attributes, title, titleColor, image, imageColor } = action;
  const color = attributes?.destructive ? colors.danger : colors.text;
  const Icon = typeof image === "string" ? ICONS[image] : undefined;
  const iconColor = imageColor ? String(imageColor) : color;
  // A `.fill` symbol is a solid shape, so its Lucide icon is filled too.
  const fill = typeof image === "string" && image.endsWith(".fill") ? iconColor : "none";
  const icon = Icon ? <Icon size={18} strokeWidth={2} color={iconColor} fill={fill} /> : null;
  if (subactions?.length) {
    return (
      <SubMenu isDisabled={attributes?.disabled}>
        <SubMenu.Trigger textValue={title}>
          {icon}
          <Typography.Paragraph className="flex-1" weight="medium" numberOfLines={1} style={{ color }}>
            {title}
          </Typography.Paragraph>
          <SubMenu.TriggerIndicator iconProps={{ color: colors.muted }} />
        </SubMenu.Trigger>
        <SubMenu.Content>
          {visible(subactions).map((sub) => (
            <MenuItem key={actionId(sub)} action={sub} colors={colors} onPressAction={onPressAction} />
          ))}
        </SubMenu.Content>
      </SubMenu>
    );
  }
  return (
    <Menu.Item
      variant={attributes?.destructive ? "danger" : "default"}
      isDisabled={attributes?.disabled}
      isSelected={state === "on"}
      animation={{ backgroundColor: { value: colors.pressed } }}
      onPress={() => onPressAction?.({ nativeEvent: { event: actionId(action) } })}
    >
      {icon}
      {/* A long title wraps, as in the iOS menu, so a model name shows in full. */}
      <Menu.ItemTitle style={{ color: titleColor ?? color }}>{title}</Menu.ItemTitle>
      {state ? <Menu.ItemIndicator iconProps={{ color: colors.text }} /> : null}
    </Menu.Item>
  );
}

/**
 * The Android `MenuView`, with the props of `@expo/ui/community/menu`. It draws the HeroUI menu of the
 * app, because the Material menu takes the palette and shape of the device and does not match the app.
 * iOS keeps the native menu. A string `image` names an SF Symbol, and Android shows its Lucide icon.
 *
 * A closed menu that was never opened is only its trigger. A list has one menu for each row, and the
 * HeroUI menu tree of each row made the list slow to mount. The menu mounts when it opens first.
 */
export function MenuView({
  ref,
  title,
  actions,
  onPressAction,
  onOpenMenu,
  onCloseMenu,
  shouldOpenOnLongPress,
  style,
  children,
  testID,
}: MenuComponentProps & { ref?: Ref<MenuComponentRef> }) {
  const anchor = useRef<ViewInstance>(null);
  const menu = useRef<MenuComponentRef>(null);
  const [mounted, setMounted] = useState(false);
  // An open that comes before the menu mounts. The menu opens when its trigger has a layout.
  const pendingOpen = useRef(false);
  const open = useCallback(() => {
    if (menu.current) {
      menu.current.show();
      return;
    }
    pendingOpen.current = true;
    setMounted(true);
  }, []);
  useImperativeHandle(ref, () => ({ show: open }), [open]);
  const takePendingOpen = useCallback(() => {
    const pending = pendingOpen.current;
    pendingOpen.current = false;
    return pending;
  }, []);

  // The children keep the same place in the tree, so the menu mounts without a new row under it.
  return (
    <View style={style} testID={testID}>
      <Pressable
        ref={anchor}
        onPress={shouldOpenOnLongPress ? undefined : open}
        onLongPress={shouldOpenOnLongPress ? open : undefined}
        android_disableSound
        focusable={false}
        accessible={false}
      >
        {children}
        {mounted ? (
          <OpenedMenu
            ref={menu}
            anchor={anchor}
            title={title}
            actions={actions}
            onPressAction={onPressAction}
            onOpenMenu={onOpenMenu}
            onCloseMenu={onCloseMenu}
            takePendingOpen={takePendingOpen}
          />
        ) : null}
      </Pressable>
    </View>
  );
}

type OpenedMenuProps = Pick<
  MenuComponentProps,
  "title" | "actions" | "onPressAction" | "onOpenMenu" | "onCloseMenu"
> & {
  ref: Ref<MenuComponentRef>;
  anchor: RefObject<ViewInstance | null>;
  /** True once when an open waited for this menu to mount. */
  takePendingOpen: () => boolean;
};

/** The HeroUI menu over its trigger. It stays mounted after it closes, so its closing motion can run. */
function OpenedMenu({
  ref,
  anchor,
  title,
  actions,
  onPressAction,
  onOpenMenu,
  onCloseMenu,
  takePendingOpen,
}: OpenedMenuProps) {
  const tokens = useCSSVariable([
    "--openbot-text-primary",
    "--openbot-text-muted",
    "--openbot-danger-text",
    "--openbot-border-grouped",
    "--openbot-bg-control-active",
  ]);
  const colors: MenuColors = {
    text: String(tokens[0]),
    muted: String(tokens[1]),
    danger: String(tokens[2]),
    separator: String(tokens[3]),
    pressed: String(tokens[4]),
  };
  const { height } = useWindowDimensions();
  const safeArea = useSafeAreaInsets();
  const trigger = useRef<MenuTriggerRef>(null);
  const [isOpen, setIsOpen] = useState(false);
  // Where the menu opens and the height it has there. A button in the lower half of the screen, such as
  // the filter beside a bottom search field, opens the menu above it, so the menu does not run off the
  // bottom edge.
  const [room, setRoom] = useState<{ placement: "top" | "bottom"; height: number } | null>(null);
  // A second call in the same tick must see the new state before React applies it.
  const openRef = useRef(false);

  const onOpenChange = useCallback(
    (next: boolean) => {
      if (openRef.current === next) return;
      openRef.current = next;
      setIsOpen(next);
      if (next) onOpenMenu?.();
      else onCloseMenu?.();
    },
    [onOpenMenu, onCloseMenu],
  );

  const open = useCallback(() => {
    const view = anchor.current;
    if (!view) {
      trigger.current?.open();
      return;
    }
    view.measureInWindow((_x, y, _width, buttonHeight) => {
      const above = y - safeArea.top - 12;
      const below = height - y - buttonHeight - safeArea.bottom - 12;
      setRoom(above > below ? { placement: "top", height: above } : { placement: "bottom", height: below });
      trigger.current?.open();
    });
  }, [anchor, height, safeArea.top, safeArea.bottom]);
  useImperativeHandle(ref, () => ({ show: open }), [open]);

  useEffect(() => {
    if (!isOpen) return;
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      onOpenChange(false);
      return true;
    });
    return () => subscription.remove();
  }, [isOpen, onOpenChange]);

  const items = groups(actions).map((group, index) => (
    <Fragment key={group.map(actionId).join("|")}>
      {index > 0 ? <Separator className="mx-2.5 my-1.5" style={{ backgroundColor: colors.separator }} /> : null}
      {group.map((action) => (
        <MenuItem key={actionId(action)} action={action} colors={colors} onPressAction={onPressAction} />
      ))}
    </Fragment>
  ));
  // HeroUI does not limit the height of the menu, and moves a menu that is taller than the screen above
  // its top edge. A long list, such as the dictation languages, scrolls in the screen instead, with the
  // 12 px edge space of HeroUI. A sub-menu opens as a layer over the menu, so a ScrollView would clip it:
  // a menu with a sub-menu keeps its full height. The React Native ScrollView does not get the drag in
  // the portal of the menu; the gesture-handler ScrollView does.
  const scrolls = !visible(actions).some((action) => action.subactions?.length && !action.displayInline);

  return (
    <Menu isOpen={isOpen} onOpenChange={onOpenChange} pointerEvents="none" style={StyleSheet.absoluteFill}>
      {/* The trigger covers the anchor and only measures it. The anchor opens the menu on a tap or a long press. */}
      <Menu.Trigger
        ref={trigger}
        isDisabled
        accessible={false}
        aria-disabled={false}
        style={StyleSheet.absoluteFill}
        onLayout={() => {
          if (takePendingOpen()) open();
        }}
      />
      <Menu.Portal>
        <Menu.Overlay />
        <Menu.Content
          presentation="popover"
          placement={room?.placement ?? "bottom"}
          align="start"
          // A fixed width. With a content width, Android sizes the menu with each title on one line and
          // then wraps a long title, so the menu is shorter than its items and the last item goes out.
          className="w-52"
          style={scrolls ? { maxHeight: room?.height ?? height - safeArea.top - safeArea.bottom - 24 } : undefined}
        >
          {title ? (
            <Menu.Label className="mb-1" numberOfLines={3} style={{ color: colors.muted }}>
              {title}
            </Menu.Label>
          ) : null}
          {scrolls ? <ScrollView>{items}</ScrollView> : items}
        </Menu.Content>
      </Menu.Portal>
    </Menu>
  );
}
