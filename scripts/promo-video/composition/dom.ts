const SVG_NS = "http://www.w3.org/2000/svg";

export function html<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  parent: Element,
  text?: string,
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  parent.append(element);
  return element;
}

export function svg<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attributes: Record<string, string | number>,
  parent: Element,
): SVGElementTagNameMap[K] {
  const element = document.createElementNS(SVG_NS, tag);
  for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, String(value));
  parent.append(element);
  return element;
}

/** Shows or hides an element, and reports whether it is shown. */
export function show(element: HTMLElement | SVGElement, visible: boolean): boolean {
  const display = visible ? "" : "none";
  if (element.style.display !== display) element.style.display = display;
  return visible;
}

/** Places an element by its center, in stage pixels. */
export function place(
  element: HTMLElement,
  x: number,
  y: number,
  options: { scale?: number; rotate?: number; opacity?: number; blur?: number; extra?: string } = {},
) {
  const { scale = 1, rotate = 0, opacity = 1, blur = 0, extra = "" } = options;
  element.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%) ${extra} rotate(${rotate}deg) scale(${scale})`;
  element.style.opacity = String(opacity);
  element.style.filter = blur > 0.05 ? `blur(${blur}px)` : "";
}

/** The resolved value of a brand token, for the canvas, which cannot read CSS variables. */
export function token(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

let uniqueId = 0;

export function nextId(prefix: string): string {
  uniqueId += 1;
  return `${prefix}-${uniqueId}`;
}
