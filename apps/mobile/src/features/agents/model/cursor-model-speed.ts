export function cursorModelSelected(listed: string, saved: string): boolean {
  if (listed === saved) return true;
  const left = cursorModelParameters(listed);
  const right = cursorModelParameters(saved);
  if (!left || !right || left.base !== right.base || left.params.size === 0) return false;
  for (const [key, value] of left.params) {
    if (right.params.get(key) !== value) return false;
  }
  return true;
}

export function cursorModelSpeedLabel(name: string, id: string, fastLabel: string): string {
  const display = name.replace(/^[\s:–—-]+/u, "") || id;
  const params = /\[([^\]]*)\]$/u.exec(id)?.[1];
  if (!params) return display;
  let context: string | null = null;
  let fast = false;
  for (const pair of params.split(",")) {
    const [key, value = ""] = pair.split("=");
    if (key === "context" && /^\d+(?:\.\d+)?[km]$/iu.test(value)) context = value;
    else if (key === "fast") fast = value === "true";
  }
  const settings = [context, fast ? fastLabel : ""].filter(Boolean).join(" · ");
  return [display, settings].filter(Boolean).join(", ");
}

function cursorModelParameters(value: string): { base: string; params: Map<string, string> } | null {
  const open = value.indexOf("[");
  if (open <= 0 || !value.endsWith("]")) return null;
  const params = new Map<string, string>();
  for (const pair of value.slice(open + 1, -1).split(",")) {
    if (!pair) continue;
    const separator = pair.indexOf("=");
    if (separator <= 0) return null;
    const key = pair.slice(0, separator);
    if (key === "reasoning" || key === "effort") continue;
    params.set(key, pair.slice(separator + 1));
  }
  return { base: value.slice(0, open), params };
}
