import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

type KeyboardEvent = { height: number; target: number };
type KeyboardHandlers = {
  onStart: (event: KeyboardEvent) => void;
  onMove: (event: KeyboardEvent) => void;
  onEnd: (event: KeyboardEvent) => void;
};

function keyboardScroll() {
  const position = { value: 0 };
  let handlers: KeyboardHandlers | undefined;
  const exports: {
    default?: (props: { disableScrollOnKeyboardHide: boolean }) => {
      bottomPadding: { value: number };
    };
  } = {};
  const identity = <T>(value: T) => value;
  const shared = <T>(value: T) => ({ value });
  const noop = () => {};
  // Run the installed event handlers; only the native hooks/rendering are replaced.
  // Native scroll commands and user gestures both update the same observed offset.
  runInNewContext(
    readFileSync(
      new URL(
        "../apps/mobile/node_modules/react-native-keyboard-controller/lib/commonjs/components/KeyboardAwareScrollView/index.js",
        import.meta.url,
      ),
      "utf8",
    ),
    {
      exports,
      require: (name: string) => {
        switch (name) {
          case "react":
            return {
              forwardRef: identity,
              useCallback: identity,
              useMemo: (create: () => unknown) => create(),
              useRef: shared,
              useEffect: noop,
              useImperativeHandle: noop,
              createElement: (_component: unknown, props: unknown) => props,
            };
          case "react-native-reanimated":
            return {
              useSharedValue: shared,
              useAnimatedRef: () => ({ current: null }),
              useAnimatedReaction: noop,
              useAnimatedStyle: noop,
              useDerivedValue: (get: () => number) => ({
                get value() {
                  return get();
                },
              }),
              scrollTo: (_ref: unknown, _x: number, y: number) => {
                position.value = y;
              },
              interpolate: (value: number, [start, end]: number[], [from, to]: number[]) =>
                from + ((value - start) / (end - start)) * (to - from),
            };
          case "../../hooks":
            return {
              useFocusedInputHandler: noop,
              useWindowDimensions: () => ({ height: 800 }),
              useReanimatedFocusedInput: () => ({
                input: shared({ parentScrollViewTarget: null, layout: { absoluteY: 700, height: 100 } }),
              }),
            };
          case "../hooks/useScrollState":
            return () => ({ offset: position, layout: shared({ height: 800 }), size: shared({ height: 1000 }) });
          case "../hooks/useCombinedRef":
            return noop;
          case "./useSmoothKeyboardHandler":
            return {
              useSmoothKeyboardHandler: (value: KeyboardHandlers) => {
                handlers = value;
              },
            };
          case "./utils":
            return { debounce: identity, scrollDistanceWithRespectToSnapPoints: identity };
          case "../../bindings":
          case "../../utils/findNodeHandle":
          case "../ScrollViewWithBottomPadding":
            return {};
          default:
            throw new Error(`Unexpected keyboard scroll dependency: ${name}`);
        }
      },
    },
  );
  if (!exports.default) throw new Error("KeyboardAwareScrollView export is missing");
  const scroll = exports.default({ disableScrollOnKeyboardHide: true });
  if (!handlers) throw new Error("Keyboard handlers were not registered");
  return { handlers, position, inset: scroll.bottomPadding };
}

describe("mobile keyboard scroll", () => {
  it("reveals the focused field, then preserves a new drag through the delayed keyboard-hide completion", () => {
    const { handlers, position, inset } = keyboardScroll();
    const shown = { height: 300, target: 1 };
    const hidden = { height: 0, target: -1 };
    handlers.onStart(shown);
    handlers.onMove(shown);
    handlers.onEnd(shown);
    expect(position.value).toBe(300);
    expect(inset.value).toBe(300);

    handlers.onStart(hidden);
    handlers.onMove({ ...hidden, height: 150 });
    // The user drags up before the keyboard's delayed completion event arrives.
    position.value = 80;
    handlers.onMove(hidden);
    handlers.onEnd(hidden);
    expect(position.value).toBe(80);
    expect(inset.value).toBe(0);
  });

  it("removes keyboard space as the keyboard moves and clamps only an offset beyond the remaining content", () => {
    const { handlers, position, inset } = keyboardScroll();
    const shown = { height: 300, target: 1 };
    const hidden = { height: 0, target: -1 };
    handlers.onStart(shown);
    handlers.onMove(shown);
    handlers.onEnd(shown);
    position.value = 480;
    handlers.onStart(hidden);
    handlers.onMove({ ...hidden, height: 150 });
    expect(position.value).toBe(350);
    expect(inset.value).toBe(150);
    handlers.onMove(hidden);
    expect(position.value).toBe(200);
    expect(inset.value).toBe(0);
    position.value = 60;
    handlers.onEnd(hidden);
    expect(position.value).toBe(60);
  });
});
