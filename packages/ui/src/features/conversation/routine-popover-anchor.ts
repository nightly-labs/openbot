export function createStableChipAnchor(onClose?: () => void) {
  let horizontal: { x: number; width: number } | undefined;
  let content: HTMLElement | undefined;
  return {
    getAnchorRect(anchor?: HTMLElement) {
      if (!anchor) return undefined;
      const rect = anchor.getBoundingClientRect();
      horizontal ??= { x: rect.x, width: rect.width };
      return { ...horizontal, y: rect.y, height: rect.height };
    },
    setContent(element: HTMLElement) {
      content = element;
    },
    onOpenChange(open: boolean) {
      if (open) {
        horizontal = undefined;
        return;
      }
      const focused = document.activeElement;
      if (focused instanceof HTMLElement && content?.contains(focused)) focused.blur();
      onClose?.();
    },
  };
}
