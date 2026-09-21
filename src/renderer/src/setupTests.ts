import "@testing-library/jest-dom/vitest";
import { cleanup, configure } from "@solidjs/testing-library";
import { afterEach } from "vitest";

/**
 * How long a `findBy*` or `waitFor` polls before failing with the query that never matched.
 *
 * Testing Library's own default is 1000 ms, which says how long a browser takes to paint, not how
 * long a loaded runner takes to get back to a test. The release job builds and signs on the machine
 * that runs these tests, and a renderer test that finishes in 4 s locally lost that one-second race
 * there and stopped the release of v0.14.0. What a test waits for is unchanged - it waits for the
 * element, never for elapsed time; only the point at which waiting is called hopeless moves, to the
 * deadline `src/backend/test-deadlines.ts` already gives a backend wait. It is written here rather
 * than imported, because the renderer reaches nothing in `src/backend`, and the vitest per-test
 * budget there stays twice this, so a slow test still fails with the query rather than with
 * vitest's generic "test timed out".
 */
const DOM_WAIT_TIMEOUT_MS = 10_000;

configure({ asyncUtilTimeout: DOM_WAIT_TIMEOUT_MS });

export class TestResizeObserver implements ResizeObserver {
  /**
   * The observers that are currently watching something.
   *
   * Membership follows the observed elements rather than construction, because
   * the browser keeps an observer alive only while it has a target: one that has
   * released every element holds nothing open and is collected. Counting
   * constructed instances instead would report a leak for any library that
   * releases with `unobserve` rather than `disconnect` - `@tanstack/virtual-core`
   * is one - and miss nothing in return.
   */
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

afterEach(() => {
  cleanup();
  TestResizeObserver.instances.clear();
});
