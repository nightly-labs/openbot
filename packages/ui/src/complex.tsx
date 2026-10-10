import * as AlertDialogPrimitive from "@kobalte/core/alert-dialog";
import * as ComboboxPrimitive from "@kobalte/core/combobox";
import * as ContextMenuPrimitive from "@kobalte/core/context-menu";
import * as DialogPrimitive from "@kobalte/core/dialog";
import * as DropdownMenuPrimitive from "@kobalte/core/dropdown-menu";
import * as ListboxPrimitive from "@kobalte/core/listbox";
import type { PolymorphicProps } from "@kobalte/core/polymorphic";
import * as PopoverPrimitive from "@kobalte/core/popover";
import * as RadioGroupPrimitive from "@kobalte/core/radio-group";
import * as KobalteSelect from "@kobalte/core/select";
import * as TabsPrimitive from "@kobalte/core/tabs";
import * as TooltipPrimitive from "@kobalte/core/tooltip";
import type { ValidComponent } from "@solidjs/web";
import { createContext, createEffect, merge, onCleanup, untrack, useContext } from "solid-js";
import { useMenuMotion } from "./menu-motion";
import { createPressedPopupCue } from "./utils";

type OpenChangeHandler = (open: boolean) => void;

function withBaseClass(baseClass: string, className: string | undefined): string {
  return className ? `${baseClass} ${className}` : baseClass;
}

function focusRestoreHandler(upstream: () => OpenChangeHandler | undefined): OpenChangeHandler {
  let restoreTarget: HTMLElement | null = null;
  return (open) => {
    if (open) {
      restoreTarget =
        document.activeElement instanceof HTMLElement && document.activeElement !== document.body
          ? document.activeElement
          : null;
    } else {
      const openTrigger = Array.from(
        document.querySelectorAll<HTMLElement>('[aria-haspopup][aria-expanded="true"][aria-controls]'),
      ).find((element) => {
        const controlledId = element.getAttribute("aria-controls");
        const controlledElement = controlledId ? document.getElementById(controlledId) : null;
        return controlledElement?.matches('[role="alertdialog"], [role="dialog"], [role="menu"]');
      });
      restoreTarget = openTrigger ?? restoreTarget;
    }

    upstream()?.(open);

    if (!open && restoreTarget?.isConnected) {
      const target = restoreTarget;
      window.requestAnimationFrame(() => window.requestAnimationFrame(() => target.focus()));
    }
  };
}

/** A menu may restore focus only while its closing surface still owns it. */
function createMenuFocusRestore(props: { open?: boolean; defaultOpen?: boolean; onOpenChange?: OpenChangeHandler }) {
  let target =
    document.activeElement instanceof HTMLElement && document.activeElement !== document.body
      ? document.activeElement
      : null;
  let content: HTMLElement | undefined;
  let open = untrack(() => props.open ?? props.defaultOpen ?? false);
  let epoch = 0;
  let selection: (() => void) | undefined;
  let handedOff = false;
  const ownsFocus = () => {
    const active = document.activeElement;
    return active === document.body || active === target || (active != null && content?.contains(active) === true);
  };
  const canRestore = (closingEpoch: number) => !open && !handedOff && epoch === closingEpoch && ownsFocus();
  onCleanup(() => {
    epoch++;
    selection = undefined;
  });
  function changeOpen(next: boolean, notify: boolean) {
    if (next !== open) {
      open = next;
      if (next) {
        epoch++;
        selection = undefined;
        handedOff = false;
        target =
          document.activeElement instanceof HTMLElement && document.activeElement !== document.body
            ? document.activeElement
            : null;
      } else {
        target =
          Array.from(
            document.querySelectorAll<HTMLElement>('[aria-haspopup][aria-expanded="true"][aria-controls]'),
          ).find((element) => element.getAttribute("aria-controls") === content?.id) ?? target;
      }
      if (!next && selection) handedOff = true;
    }
    if (notify) props.onOpenChange?.(next);
    const closingEpoch = epoch;
    if (!next && target?.isConnected) {
      const restoreTarget = target;
      window.requestAnimationFrame(() =>
        window.requestAnimationFrame(() => {
          if (restoreTarget.isConnected && canRestore(closingEpoch)) restoreTarget.focus();
        }),
      );
    }
  }
  createEffect(
    () => props.open,
    (controlled) => {
      if (controlled !== undefined && controlled !== open) changeOpen(controlled, false);
    },
  );
  return {
    setContent: (element: HTMLElement) => {
      content = element;
    },
    canRestoreContent: (element: HTMLElement | undefined) => element === content && !open && !handedOff && ownsFocus(),
    canOpenFocus: () => open && !selection && ownsFocus(),
    selectAfterClose: (action: () => void) => {
      selection ??= action;
    },
    releaseContent(element: HTMLElement | undefined) {
      if (open || content !== element || !selection) return;
      const closingEpoch = epoch;
      const action = selection;
      selection = undefined;
      // The portal's cleanup proves the surface has left; pending primitive focus work
      // cannot focus its detached elements. Do not execute an action in a disposed owner.
      queueMicrotask(() => {
        if (open || epoch !== closingEpoch) return;
        // Give a new dialog a connected return anchor before it claims focus.
        if (target?.isConnected) target.focus();
        if (!open && epoch === closingEpoch) action();
      });
    },
    onOpenChange: (next: boolean) => {
      // A controlled owner may decline a close; only its committed open value grants it.
      if (props.open !== undefined) props.onOpenChange?.(next);
      else changeOpen(next, true);
    },
  };
}

const MenuFocusContext = createContext<ReturnType<typeof createMenuFocusRestore> | null>(null);

type MenuItemAfterCloseProps<T extends ValidComponent = "div"> = PolymorphicProps<
  T,
  DropdownMenuPrimitive.DropdownMenuItemProps<T>
> & {
  /** Hand focus to an editor or overlay after the normal Menu.Portal surface unmounts. */
  onSelectAfterClose?: (() => void) | undefined;
};

function MenuItemAfterClose<T extends ValidComponent = "div">(props: MenuItemAfterCloseProps<T>) {
  const focus = useContext(MenuFocusContext);
  const forwarded = merge(props, {
    onSelectAfterClose: undefined,
    onSelect: () => {
      props.onSelect?.();
      const action = props.onSelectAfterClose;
      if (!action) return;
      if (focus && props.closeOnSelect !== false) focus.selectAfterClose(action);
      else action();
    },
  });
  return <DropdownMenuPrimitive.Item<T> data-cuelume-tap="" {...forwarded} />;
}

function SelectRootAdapter<Option, OptGroup = never, T extends ValidComponent = "div">(
  props: PolymorphicProps<T, KobalteSelect.SelectRootProps<Option, OptGroup, T>>,
) {
  return KobalteSelect.Root<Option, OptGroup, T>(props);
}

function ComboboxRootAdapter<Option, OptGroup = never, T extends ValidComponent = "div">(
  props: PolymorphicProps<T, ComboboxPrimitive.ComboboxRootProps<Option, OptGroup, T>>,
) {
  return ComboboxPrimitive.Root<Option, OptGroup, T>(props);
}

function ListboxRootAdapter<Option, OptGroup = never, T extends ValidComponent = "ul">(
  props: PolymorphicProps<T, ListboxPrimitive.ListboxRootProps<Option, OptGroup, T>>,
) {
  return ListboxPrimitive.Root<Option, OptGroup, T>(props);
}

interface DialogApi {
  Root: typeof DialogPrimitive.Root;
  Portal: typeof DialogPrimitive.Portal;
  Trigger: typeof DialogPrimitive.Trigger;
  Overlay: typeof DialogPrimitive.Overlay;
  Content: typeof DialogPrimitive.Content;
  Title: typeof DialogPrimitive.Title;
  Description: typeof DialogPrimitive.Description;
  CloseButton: typeof DialogPrimitive.CloseButton;
}

export const Dialog: DialogApi = {
  Root: (props) => <DialogPrimitive.Root {...props} onOpenChange={focusRestoreHandler(() => props.onOpenChange)} />,
  Portal: (props) => <DialogPrimitive.Portal {...props} />,
  Trigger: (props) => <DialogPrimitive.Trigger data-cuelume-open="" {...props} />,
  Overlay: (props) => <DialogPrimitive.Overlay {...props} class={withBaseClass("ui-dialog-overlay", props.class)} />,
  Content: (props) => (
    <DialogPrimitive.Content
      {...props}
      class={withBaseClass("ui-dialog-content", props.class)}
      onInteractOutside={(event) => {
        props.onInteractOutside?.(event);
        const target = event.detail.originalEvent.target;
        if (target instanceof Element && target.closest("[data-kb-top-layer]")) event.preventDefault();
      }}
    />
  ),
  Title: (props) => <DialogPrimitive.Title {...props} />,
  Description: (props) => <DialogPrimitive.Description {...props} />,
  CloseButton: (props) => <DialogPrimitive.CloseButton data-cuelume-close="" {...props} />,
};

interface AlertDialogApi {
  Root: typeof AlertDialogPrimitive.Root;
  Portal: typeof AlertDialogPrimitive.Portal;
  Trigger: typeof AlertDialogPrimitive.Trigger;
  Overlay: typeof AlertDialogPrimitive.Overlay;
  Content: typeof AlertDialogPrimitive.Content;
  Title: typeof AlertDialogPrimitive.Title;
  Description: typeof AlertDialogPrimitive.Description;
  CloseButton: typeof AlertDialogPrimitive.CloseButton;
}

export const AlertDialog: AlertDialogApi = {
  Root: (props) => (
    <AlertDialogPrimitive.Root {...props} onOpenChange={focusRestoreHandler(() => props.onOpenChange)} />
  ),
  Portal: (props) => <AlertDialogPrimitive.Portal {...props} />,
  Trigger: (props) => <AlertDialogPrimitive.Trigger data-cuelume-open="" {...props} />,
  Overlay: (props) => (
    <AlertDialogPrimitive.Overlay {...props} class={withBaseClass("ui-dialog-overlay", props.class)} />
  ),
  Content: (props) => (
    <AlertDialogPrimitive.Content {...props} class={withBaseClass("ui-dialog-content", props.class)} />
  ),
  Title: (props) => <AlertDialogPrimitive.Title {...props} />,
  Description: (props) => <AlertDialogPrimitive.Description {...props} />,
  CloseButton: (props) => <AlertDialogPrimitive.CloseButton data-cuelume-close="" {...props} />,
};

interface DropdownMenuApi {
  Root: typeof DropdownMenuPrimitive.Root;
  Portal: typeof DropdownMenuPrimitive.Portal;
  Trigger: typeof DropdownMenuPrimitive.Trigger;
  Content: typeof DropdownMenuPrimitive.Content;
  Sub: typeof DropdownMenuPrimitive.Sub;
  SubTrigger: typeof DropdownMenuPrimitive.SubTrigger;
  SubContent: typeof DropdownMenuPrimitive.SubContent;
  Item: typeof MenuItemAfterClose;
  CheckboxItem: typeof DropdownMenuPrimitive.CheckboxItem;
  RadioGroup: typeof DropdownMenuPrimitive.RadioGroup;
  RadioItem: typeof DropdownMenuPrimitive.RadioItem;
  Separator: typeof DropdownMenuPrimitive.Separator;
}

export const DropdownMenu: DropdownMenuApi = {
  Root: (props) => {
    const focus = createMenuFocusRestore(props);
    return (
      <MenuFocusContext value={focus}>
        <DropdownMenuPrimitive.Root {...props} onOpenChange={focus.onOpenChange} />
      </MenuFocusContext>
    );
  },
  Portal: (props) => <DropdownMenuPrimitive.Portal {...props} />,
  Trigger: (props) => {
    const press = createPressedPopupCue();
    return (
      <DropdownMenuPrimitive.Trigger
        data-cuelume-open={press.cue()}
        data-cuelume-emphasis="subtle"
        {...props}
        ref={[props.ref, press.ref]}
      />
    );
  },
  Content: (props) => {
    const motion = useMenuMotion();
    const focus = useContext(MenuFocusContext);
    let content: HTMLElement | undefined;
    onCleanup(() => focus?.releaseContent(content));
    return (
      <DropdownMenuPrimitive.Content
        {...props}
        ref={[
          props.ref,
          motion,
          (element) => {
            content = element;
            focus?.setContent(element);
          },
        ]}
        onOpenAutoFocus={(event) => {
          props.onOpenAutoFocus?.(event);
          if (focus && !focus.canOpenFocus()) event.preventDefault();
        }}
        onCloseAutoFocus={(event) => {
          props.onCloseAutoFocus?.(event);
          if (focus && !focus.canRestoreContent(content)) event.preventDefault();
        }}
        class={withBaseClass("ui-action-menu", props.class)}
      />
    );
  },
  Sub: DropdownMenuPrimitive.Sub,
  SubTrigger: DropdownMenuPrimitive.SubTrigger,
  SubContent: (props) => {
    const motion = useMenuMotion();
    return <DropdownMenuPrimitive.SubContent {...props} ref={[props.ref, motion]} />;
  },
  Item: MenuItemAfterClose,
  CheckboxItem: (props) => <DropdownMenuPrimitive.CheckboxItem data-cuelume-toggle="" {...props} />,
  RadioGroup: (props) => <DropdownMenuPrimitive.RadioGroup {...props} />,
  RadioItem: (props) => <DropdownMenuPrimitive.RadioItem data-cuelume-select="" {...props} />,
  Separator: (props) => <DropdownMenuPrimitive.Separator {...props} />,
};

interface ContextMenuApi {
  Root: typeof ContextMenuPrimitive.Root;
  Portal: typeof ContextMenuPrimitive.Portal;
  Trigger: typeof ContextMenuPrimitive.Trigger;
  Content: typeof ContextMenuPrimitive.Content;
  Sub: typeof ContextMenuPrimitive.Sub;
  SubTrigger: typeof ContextMenuPrimitive.SubTrigger;
  SubContent: typeof ContextMenuPrimitive.SubContent;
  Item: typeof MenuItemAfterClose;
  RadioGroup: typeof ContextMenuPrimitive.RadioGroup;
  RadioItem: typeof ContextMenuPrimitive.RadioItem;
  Separator: typeof ContextMenuPrimitive.Separator;
}

export const ContextMenu: ContextMenuApi = {
  Root: (props) => {
    const focus = createMenuFocusRestore(props);
    return (
      <MenuFocusContext value={focus}>
        <ContextMenuPrimitive.Root {...props} onOpenChange={focus.onOpenChange} />
      </MenuFocusContext>
    );
  },
  Portal: (props) => <ContextMenuPrimitive.Portal {...props} />,
  Trigger: (props) => <ContextMenuPrimitive.Trigger {...props} />,
  Content: (props) => {
    const motion = useMenuMotion();
    const focus = useContext(MenuFocusContext);
    let content: HTMLElement | undefined;
    onCleanup(() => focus?.releaseContent(content));
    return (
      <ContextMenuPrimitive.Content
        {...props}
        ref={[
          props.ref,
          motion,
          (element) => {
            content = element;
            focus?.setContent(element);
          },
        ]}
        onOpenAutoFocus={(event) => {
          props.onOpenAutoFocus?.(event);
          if (focus && !focus.canOpenFocus()) event.preventDefault();
        }}
        onCloseAutoFocus={(event) => {
          props.onCloseAutoFocus?.(event);
          if (focus && !focus.canRestoreContent(content)) event.preventDefault();
        }}
        class={withBaseClass("ui-action-menu", props.class)}
      />
    );
  },
  Sub: ContextMenuPrimitive.Sub,
  SubTrigger: ContextMenuPrimitive.SubTrigger,
  SubContent: (props) => {
    const motion = useMenuMotion();
    return <ContextMenuPrimitive.SubContent {...props} ref={[props.ref, motion]} />;
  },
  Item: MenuItemAfterClose,
  RadioGroup: (props) => <ContextMenuPrimitive.RadioGroup {...props} />,
  RadioItem: (props) => <ContextMenuPrimitive.RadioItem data-cuelume-select="" {...props} />,
  Separator: (props) => <ContextMenuPrimitive.Separator {...props} />,
};

interface PopoverApi {
  Root: typeof PopoverPrimitive.Root;
  Portal: typeof PopoverPrimitive.Portal;
  Trigger: typeof PopoverPrimitive.Trigger;
  Content: typeof PopoverPrimitive.Content;
  Title: typeof PopoverPrimitive.Title;
  Description: typeof PopoverPrimitive.Description;
  CloseButton: typeof PopoverPrimitive.CloseButton;
}

export const Popover: PopoverApi = {
  Root: (props) => <PopoverPrimitive.Root {...props} onOpenChange={focusRestoreHandler(() => props.onOpenChange)} />,
  Portal: (props) => <PopoverPrimitive.Portal {...props} />,
  Trigger: (props) => {
    const context = PopoverPrimitive.usePopoverContext();
    // Kobalte toggles the popover after the click cue reads this state.
    return (
      <PopoverPrimitive.Trigger
        data-cuelume-open={context.isOpen() ? "close" : ""}
        data-cuelume-emphasis="subtle"
        {...props}
      />
    );
  },
  Content: (props) => <PopoverPrimitive.Content {...props} />,
  Title: (props) => <PopoverPrimitive.Title {...props} />,
  Description: (props) => <PopoverPrimitive.Description {...props} />,
  CloseButton: (props) => (
    <PopoverPrimitive.CloseButton data-cuelume-close="" data-cuelume-emphasis="subtle" {...props} />
  ),
};

interface TooltipApi {
  Root: typeof TooltipPrimitive.Root;
  Portal: typeof TooltipPrimitive.Portal;
  Trigger: typeof TooltipPrimitive.Trigger;
  Content: typeof TooltipPrimitive.Content;
}

export const Tooltip: TooltipApi = {
  Root: (props) => <TooltipPrimitive.Root {...props} />,
  Portal: (props) => <TooltipPrimitive.Portal {...props} />,
  Trigger: (props) => <TooltipPrimitive.Trigger {...props} />,
  Content: (props) => <TooltipPrimitive.Content {...props} />,
};

interface TabsApi {
  Root: typeof TabsPrimitive.Root;
  List: typeof TabsPrimitive.List;
  Trigger: typeof TabsPrimitive.Trigger;
  Content: typeof TabsPrimitive.Content;
  Indicator: typeof TabsPrimitive.Indicator;
}

export const Tabs: TabsApi = {
  Root: (props) => <TabsPrimitive.Root {...props} />,
  List: (props) => <TabsPrimitive.List {...props} />,
  Trigger: (props) => <TabsPrimitive.Trigger data-cuelume-select="" {...props} />,
  Content: (props) => <TabsPrimitive.Content {...props} />,
  Indicator: (props) => <TabsPrimitive.Indicator {...props} />,
};

interface RadioGroupApi {
  Root: typeof RadioGroupPrimitive.Root;
  Label: typeof RadioGroupPrimitive.Label;
  Description: typeof RadioGroupPrimitive.Description;
  ErrorMessage: typeof RadioGroupPrimitive.ErrorMessage;
  Item: typeof RadioGroupPrimitive.Item;
  ItemInput: typeof RadioGroupPrimitive.ItemInput;
  ItemControl: typeof RadioGroupPrimitive.ItemControl;
  ItemIndicator: typeof RadioGroupPrimitive.ItemIndicator;
  ItemLabel: typeof RadioGroupPrimitive.ItemLabel;
  ItemDescription: typeof RadioGroupPrimitive.ItemDescription;
}

export const RadioGroup: RadioGroupApi = {
  Root: (props) => <RadioGroupPrimitive.Root {...props} />,
  Label: (props) => <RadioGroupPrimitive.Label {...props} />,
  Description: (props) => <RadioGroupPrimitive.Description {...props} />,
  ErrorMessage: (props) => <RadioGroupPrimitive.ErrorMessage {...props} />,
  Item: (props) => <RadioGroupPrimitive.Item {...props} />,
  ItemInput: (props) => <RadioGroupPrimitive.ItemInput {...props} />,
  ItemControl: (props) => <RadioGroupPrimitive.ItemControl {...props} />,
  ItemIndicator: (props) => <RadioGroupPrimitive.ItemIndicator {...props} />,
  ItemLabel: (props) => <RadioGroupPrimitive.ItemLabel {...props} />,
  ItemDescription: (props) => <RadioGroupPrimitive.ItemDescription {...props} />,
};

interface SelectPrimitiveApi {
  Root: typeof KobalteSelect.Root;
  Label: typeof KobalteSelect.Label;
  Description: typeof KobalteSelect.Description;
  ErrorMessage: typeof KobalteSelect.ErrorMessage;
  Trigger: typeof KobalteSelect.Trigger;
  Value: typeof KobalteSelect.Value;
  HiddenSelect: typeof KobalteSelect.HiddenSelect;
  Portal: typeof KobalteSelect.Portal;
  Content: typeof KobalteSelect.Content;
  Listbox: typeof KobalteSelect.Listbox;
  Item: typeof KobalteSelect.Item;
  ItemLabel: typeof KobalteSelect.ItemLabel;
  ItemIndicator: typeof KobalteSelect.ItemIndicator;
}

export const SelectPrimitive: SelectPrimitiveApi = {
  Root: SelectRootAdapter,
  Label: (props) => <KobalteSelect.Label {...props} />,
  Description: (props) => <KobalteSelect.Description {...props} />,
  ErrorMessage: (props) => <KobalteSelect.ErrorMessage {...props} />,
  Trigger: (props) => {
    const press = createPressedPopupCue();
    return (
      <KobalteSelect.Trigger
        data-cuelume-open={press.cue()}
        data-cuelume-emphasis="subtle"
        {...props}
        ref={[props.ref, press.ref]}
      />
    );
  },
  Value: (props) => <KobalteSelect.Value {...props} />,
  HiddenSelect: (props) => <KobalteSelect.HiddenSelect {...props} />,
  Portal: (props) => <KobalteSelect.Portal {...props} />,
  Content: (props) => <KobalteSelect.Content {...props} />,
  Listbox: (props) => <KobalteSelect.Listbox {...props} />,
  Item: (props) => <KobalteSelect.Item data-cuelume-select="" {...props} />,
  ItemLabel: (props) => <KobalteSelect.ItemLabel {...props} />,
  ItemIndicator: (props) => <KobalteSelect.ItemIndicator {...props} />,
};

interface ComboboxApi {
  Root: typeof ComboboxPrimitive.Root;
  Label: typeof ComboboxPrimitive.Label;
  Description: typeof ComboboxPrimitive.Description;
  ErrorMessage: typeof ComboboxPrimitive.ErrorMessage;
  Control: typeof ComboboxPrimitive.Control;
  Input: typeof ComboboxPrimitive.Input;
  Trigger: typeof ComboboxPrimitive.Trigger;
  HiddenSelect: typeof ComboboxPrimitive.HiddenSelect;
  Portal: typeof ComboboxPrimitive.Portal;
  Content: typeof ComboboxPrimitive.Content;
  Listbox: typeof ComboboxPrimitive.Listbox;
  Item: typeof ComboboxPrimitive.Item;
  ItemLabel: typeof ComboboxPrimitive.ItemLabel;
  ItemIndicator: typeof ComboboxPrimitive.ItemIndicator;
  Section: typeof ComboboxPrimitive.Section;
}

export const Combobox: ComboboxApi = {
  Root: ComboboxRootAdapter,
  Label: (props) => <ComboboxPrimitive.Label {...props} />,
  Description: (props) => <ComboboxPrimitive.Description {...props} />,
  ErrorMessage: (props) => <ComboboxPrimitive.ErrorMessage {...props} />,
  Control: (props) => <ComboboxPrimitive.Control {...props} />,
  Input: (props) => <ComboboxPrimitive.Input data-cuelume-type="" {...props} />,
  Trigger: (props) => {
    const press = createPressedPopupCue();
    return (
      <ComboboxPrimitive.Trigger
        data-cuelume-open={press.cue()}
        data-cuelume-emphasis="subtle"
        {...props}
        ref={[props.ref, press.ref]}
      />
    );
  },
  HiddenSelect: (props) => <ComboboxPrimitive.HiddenSelect {...props} />,
  Portal: (props) => <ComboboxPrimitive.Portal {...props} />,
  Content: (props) => <ComboboxPrimitive.Content {...props} />,
  Listbox: (props) => <ComboboxPrimitive.Listbox {...props} />,
  Item: (props) => <ComboboxPrimitive.Item data-cuelume-select="" {...props} />,
  ItemLabel: (props) => <ComboboxPrimitive.ItemLabel {...props} />,
  ItemIndicator: (props) => <ComboboxPrimitive.ItemIndicator {...props} />,
  Section: (props) => <ComboboxPrimitive.Section {...props} />,
};

interface ListboxApi {
  Root: typeof ListboxPrimitive.Root;
  Item: typeof ListboxPrimitive.Item;
  ItemLabel: typeof ListboxPrimitive.ItemLabel;
  ItemDescription: typeof ListboxPrimitive.ItemDescription;
  ItemIndicator: typeof ListboxPrimitive.ItemIndicator;
  Section: typeof ListboxPrimitive.Section;
}

export const Listbox: ListboxApi = {
  Root: ListboxRootAdapter,
  Item: (props) => <ListboxPrimitive.Item data-cuelume-select="" {...props} />,
  ItemLabel: (props) => <ListboxPrimitive.ItemLabel {...props} />,
  ItemDescription: (props) => <ListboxPrimitive.ItemDescription {...props} />,
  ItemIndicator: (props) => <ListboxPrimitive.ItemIndicator {...props} />,
  Section: (props) => <ListboxPrimitive.Section {...props} />,
};
