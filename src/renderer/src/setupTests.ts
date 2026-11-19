import "@testing-library/jest-dom/vitest";
import { cleanup, configure } from "@solidjs/testing-library";
import { afterEach } from "vitest";

const DOM_WAIT_TIMEOUT_MS = 10_000;

configure({ asyncUtilTimeout: DOM_WAIT_TIMEOUT_MS });

export class TestResizeObserver implements ResizeObserver {
  static readonly instances = new Set<TestResizeObserver>();

  readonly #elements = new Map<Element, ResizeObserverBoxOptions>();

  constructor(private readonly callback: ResizeObserverCallback) {}

  static resize(element: Element, box: ResizeObserverBoxOptions): void {
    for (const observer of TestResizeObserver.instances) {
      if (observer.#elements.get(element) !== box) continue;
      const bounds = element.getBoundingClientRect();
      const size = [{ inlineSize: bounds.width, blockSize: bounds.height }];
      observer.callback(
        [
          {
            target: element,
            contentRect: bounds,
            borderBoxSize: size,
            contentBoxSize: size,
            devicePixelContentBoxSize: size,
          },
        ],
        observer,
      );
    }
  }

  disconnect(): void {
    this.#elements.clear();
    TestResizeObserver.instances.delete(this);
  }

  observe(element: Element, options?: ResizeObserverOptions): void {
    this.#elements.set(element, options?.box ?? "content-box");
    TestResizeObserver.instances.add(this);
  }

  unobserve(element: Element): void {
    this.#elements.delete(element);
    if (this.#elements.size === 0) TestResizeObserver.instances.delete(this);
  }
}

export class TestIntersectionObserver implements IntersectionObserver {
  readonly root = null;
  readonly rootMargin = "0px";
  readonly thresholds = [0];
  readonly scrollMargin = "0px";
  constructor(private readonly callback: IntersectionObserverCallback) {}
  observe(target: Element): void {
    const bounds = target.getBoundingClientRect();
    this.callback(
      [
        {
          target,
          isIntersecting: true,
          intersectionRatio: 1,
          time: 0,
          boundingClientRect: bounds,
          intersectionRect: bounds,
          rootBounds: null,
        },
      ],
      this,
    );
  }
  disconnect(): void {}
  unobserve(): void {}
  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }
}

globalThis.IntersectionObserver = TestIntersectionObserver;
globalThis.ResizeObserver = TestResizeObserver;
globalThis.scrollTo = () => undefined;

const htmlElement = globalThis.HTMLElement;
if (htmlElement && !htmlElement.prototype.getAnimations) {
  htmlElement.prototype.getAnimations = () => [];
}
if (htmlElement && !htmlElement.prototype.scrollIntoView) {
  htmlElement.prototype.scrollIntoView = () => undefined;
}
if (htmlElement && !htmlElement.prototype.scrollTo) {
  htmlElement.prototype.scrollTo = () => undefined;
}

if (typeof performance.mark !== "function") {
  Object.defineProperty(performance, "mark", { configurable: true, value: () => undefined });
}

afterEach(() => {
  cleanup();
  TestResizeObserver.instances.clear();
});
