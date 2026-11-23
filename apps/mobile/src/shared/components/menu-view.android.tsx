import type { MenuAction, MenuComponentProps, MenuComponentRef } from "@expo/ui/community/menu";
import { Menu, type MenuTriggerRef, Separator, SubMenu, Typography } from "heroui-native";
import type { LucideIcon } from "lucide-react-native";
import Archive from "lucide-react-native/icons/archive";
import ArrowDown from "lucide-react-native/icons/arrow-down";
import ArrowUp from "lucide-react-native/icons/arrow-up";
import ArrowUpDown from "lucide-react-native/icons/arrow-up-down";
import Bell from "lucide-react-native/icons/bell";
import BellOff from "lucide-react-native/icons/bell-off";
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
import FolderPlus from "lucide-react-native/icons/folder-plus";
import GitBranch from "lucide-react-native/icons/git-branch";
import Globe from "lucide-react-native/icons/globe";
import Info from "lucide-react-native/icons/info";
import LayoutGrid from "lucide-react-native/icons/layout-grid";
import Link from "lucide-react-native/icons/link";
import List from "lucide-react-native/icons/list";
import ListChecks from "lucide-react-native/icons/list-checks";
import LogOut from "lucide-react-native/icons/log-out";
import MailBadge from "lucide-react-native/icons/mail-badge";
import MailOpen from "lucide-react-native/icons/mail-open";
import MessageCircleQuestionMark from "lucide-react-native/icons/message-circle-question-mark";
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
import TriangleAlert from "lucide-react-native/icons/triangle-alert";
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

const ICONS: Partial<Record<string, LucideIcon>> = {
  archivebox: Archive,
  "arrow.clockwise": RotateCw,
  "arrow.down": ArrowDown,
  "arrow.triangle.branch": GitBranch,
  "arrow.up": ArrowUp,
  "arrow.up.arrow.down": ArrowUpDown,
  bell: Bell,
  "bell.slash": BellOff,
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
  "exclamationmark.triangle": TriangleAlert,
  "envelope.badge": MailBadge,
  "envelope.open": MailOpen,
  eye: Eye,
  "eye.slash": EyeOff,
  folder: Folder,
  "folder.badge.plus": FolderPlus,
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
  "questionmark.bubble": MessageCircleQuestionMark,
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
      <Menu.ItemTitle style={{ color: titleColor ?? color }}>{title}</Menu.ItemTitle>
      {state ? <Menu.ItemIndicator iconProps={{ color: colors.text }} /> : null}
    </Menu.Item>
  );
}

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
  takePendingOpen: () => boolean;
};

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
  const [room, setRoom] = useState<{ placement: "top" | "bottom"; height: number } | null>(null);
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
  const scrolls = !visible(actions).some((action) => action.subactions?.length && !action.displayInline);

  return (
    <Menu isOpen={isOpen} onOpenChange={onOpenChange} pointerEvents="none" style={StyleSheet.absoluteFill}>
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
