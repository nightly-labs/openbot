/**
 * The keyboard and focus behavior of a menu that has a search field above its rows. Typing always
 * edits the search, and ArrowDown in the field goes to the first row.
 */
export function createMenuSearch(options: {
  /** The selector of a row that can take the focus. */
  row: string;
  /** False for a menu that shows no field. Such a menu keeps the jump to a row. */
  enabled?: () => boolean;
  /** True when Enter in the field chooses the first row. */
  enter?: () => boolean;
}) {
  let field: HTMLInputElement | undefined;
  let list: HTMLDivElement | undefined;
  const enabled = () => options.enabled?.() ?? true;

  return {
    list: () => list,
    bindField: (element: HTMLInputElement) => {
      field = element;
    },
    bindList: (element: HTMLDivElement) => {
      list = element;
      // A letter or Backspace typed on a row goes to the field, so typing always edits the search.
      element.addEventListener(
        "keydown",
        (event) => {
          if (!enabled() || !field) return;
          const text = event.key !== " " && Array.from(event.key).length === 1;
          if (!text && event.key !== "Backspace") return;
          if (event.metaKey || event.ctrlKey || event.altKey) return;
          event.stopPropagation();
          field.focus();
        },
        true,
      );
    },
    onFieldKey: (event: KeyboardEvent) => {
      if (event.key === "Escape" || event.key === "Tab") return;
      // The menu reads a letter as a jump to a row. In the field, letters are the search.
      event.stopPropagation();
      // A key that chooses an input method candidate stays in the field.
      if (event.isComposing) return;
      const enter = event.key === "Enter" && (options.enter?.() ?? false);
      if (!enter && event.key !== "ArrowDown") return;
      const row = list?.querySelector<HTMLElement>(options.row);
      if (!row) return;
      event.preventDefault();
      row.focus();
      // Enter chooses the first match through its row, so the menu closes as it does for a click.
      if (enter) row.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    },
    onOpenAutoFocus: (event: Event) => {
      if (!enabled()) return;
      event.preventDefault();
      field?.focus();
    },
    onFocusIn: (event: FocusEvent) => {
      // The menu takes the focus itself after a pointer opens it and when the pointer leaves a row.
      // With a field, the focus goes on to the field, so typing searches and does not jump to a row.
      if (enabled() && event.target === event.currentTarget) field?.focus();
    },
  };
}
