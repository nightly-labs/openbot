/**
 * Keeps a chip popover where it opened. A pick changes the chip label, and so its width and the
 * place of the chips next to it. The horizontal position measured at open stays until the popover
 * opens again; the vertical position still follows the chip when the panel scrolls.
 *
 * `onClose` marks the end of one edit, so a consumer that saves each edit saves once, not on each
 * key. A typed value that commits on blur, such as an hour, commits before `onClose` runs.
 */
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
