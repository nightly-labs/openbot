export function createMenuSearch(options: { row: string; enabled?: () => boolean; enter?: () => boolean }) {
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
      event.stopPropagation();
      if (event.isComposing) return;
      const enter = event.key === "Enter" && (options.enter?.() ?? false);
      if (!enter && event.key !== "ArrowDown") return;
      const row = list?.querySelector<HTMLElement>(options.row);
      if (!row) return;
      event.preventDefault();
      row.focus();
      if (enter) row.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    },
    onOpenAutoFocus: (event: Event) => {
      if (!enabled()) return;
      event.preventDefault();
      field?.focus();
    },
    onFocusIn: (event: FocusEvent) => {
      if (enabled() && event.target === event.currentTarget) field?.focus();
    },
  };
}
