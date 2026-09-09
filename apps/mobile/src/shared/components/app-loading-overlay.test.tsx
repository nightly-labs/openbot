import { fireEvent, screen } from "@testing-library/dom";
import { act, type PropsWithChildren, useLayoutEffect } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppLoadingOverlayProvider, useAppLoadingOverlay } from "./app-loading-overlay";

const native = vi.hoisted(() => ({
  back: new Set<() => boolean>(),
  finishExit: () => {},
}));

// Model the native View input and accessibility boundary in jsdom. Native hit
// testing and gesture recognition still require an iOS/Android device check.
vi.mock("react-native", () => ({
  BackHandler: {
    addEventListener: (_event: string, listener: () => boolean) => {
      native.back.add(listener);
      return { remove: () => native.back.delete(listener) };
    },
  },
  View: ({
    children,
    pointerEvents,
    accessibilityElementsHidden,
    importantForAccessibility,
  }: PropsWithChildren<{
    pointerEvents?: "auto" | "none";
    accessibilityElementsHidden?: boolean;
    importantForAccessibility?: "auto" | "no-hide-descendants";
  }>) => (
    <div
      aria-hidden={accessibilityElementsHidden || importantForAccessibility === "no-hide-descendants"}
      onClickCapture={(event) => {
        if (pointerEvents === "none") event.stopPropagation();
      }}
    >
      {children}
    </div>
  ),
}));

vi.mock("@/shared/components/bloub-loader", () => ({
  BloubLoader: ({ label, onExitComplete }: { label: string; onExitComplete: () => void }) => {
    native.finishExit = onExitComplete;
    return <div role="progressbar" aria-label={label} />;
  },
}));

const container = document.createElement("div");
document.body.append(container);
let root = createRoot(container);
afterEach(async () => {
  await act(() => root.unmount());
  root = createRoot(container);
});

async function renderApp() {
  const navigate = vi.fn();
  let setLoadingLabel: (label: string | null) => void = () => {
    throw new Error("Loading controller is not mounted.");
  };
  function Content() {
    const overlay = useAppLoadingOverlay();
    useLayoutEffect(() => {
      setLoadingLabel = overlay.setLoadingLabel;
    }, [overlay.setLoadingLabel]);
    return (
      <button type="button" onClick={navigate}>
        Open sidebar
      </button>
    );
  }
  await act(() =>
    root.render(
      <AppLoadingOverlayProvider>
        <Content />
      </AppLoadingOverlayProvider>,
    ),
  );
  const sidebar = screen.getByRole("button", { name: "Open sidebar", hidden: true });
  return { navigate, sidebar, setLoadingLabel: (label: string | null) => act(() => setLoadingLabel(label)) };
}

describe("app loading interaction boundary", () => {
  it("blocks navigation until exit completes, then restores content and Back access", async () => {
    const app = await renderApp();
    await act(() => fireEvent.click(app.sidebar));
    expect(app.navigate).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Open sidebar" })).toBeNull();
    expect(screen.getByRole("progressbar", { name: "Loading account" })).toBeTruthy();
    expect([...native.back].some((listener) => listener())).toBe(true);

    await app.setLoadingLabel(null);
    await act(() => fireEvent.click(app.sidebar));
    expect(app.navigate).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Open sidebar" })).toBeNull();
    expect(screen.getByRole("progressbar", { name: "Loading" })).toBeTruthy();
    expect([...native.back].some((listener) => listener())).toBe(true);

    await act(() => native.finishExit());
    expect(screen.queryByRole("progressbar")).toBeNull();
    await act(() => fireEvent.click(screen.getByRole("button", { name: "Open sidebar" })));
    expect(app.navigate).toHaveBeenCalledOnce();
    expect(native.back.size).toBe(0);
  });

  it("blocks again on reload and ignores an exit callback while new loading is active", async () => {
    const app = await renderApp();
    await app.setLoadingLabel(null);
    await act(() => native.finishExit());
    await app.setLoadingLabel("Connecting to server");
    await act(() => native.finishExit());
    await act(() => fireEvent.click(app.sidebar));
    expect(app.navigate).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Open sidebar" })).toBeNull();
    expect(screen.getByRole("progressbar", { name: "Connecting to server" })).toBeTruthy();
    expect([...native.back].some((listener) => listener())).toBe(true);
  });
});
