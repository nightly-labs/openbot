import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { MobileSession } from "../api/mobile-auth";
import { MobileSessionProvider, useMobileSession } from "./mobile-session-context";

const native = vi.hoisted(() => ({
  state: "active",
  listeners: new Set<(state: string) => void>(),
  validate:
    vi.fn<(session: MobileSession, apply?: (session: MobileSession | null) => void) => Promise<MobileSession | null>>(),
  read: vi.fn<() => Promise<MobileSession | null>>(),
}));
vi.mock("react-native", () => ({
  AppState: {
    get currentState() {
      return native.state;
    },
    addEventListener: (_event: string, listener: (state: string) => void) => {
      native.listeners.add(listener);
      return { remove: () => native.listeners.delete(listener) };
    },
  },
}));
// This provider owns the lifecycle subscription. Storage and HTTP behavior are covered by mobile-auth.test.ts.
vi.mock("@/features/auth/api/mobile-auth", () => ({
  readMobileSession: native.read,
  validateMobileSession: native.validate,
  retryMobileSessionRevocations: async () => {},
  logoutMobileSession: async () => {},
  updateMobileProfile: async () => {},
  MobileSessionExpiredError: class extends Error {},
}));

const session: MobileSession = {
  apiUrl: "https://api.example.com",
  sessionToken: "test-credential",
  host: { hostId: "host", fingerprint: "a".repeat(43) },
  user: { id: "user", email: "user@example.com", name: "User", avatarUrl: null },
};
let current: ReturnType<typeof useMobileSession>;
function Account() {
  current = useMobileSession();
  return null;
}
const container = document.createElement("div");
let root = createRoot(container);
beforeEach(async () => {
  vi.useFakeTimers();
  native.state = "active";
  native.read.mockResolvedValue(session);
  native.validate.mockReset().mockImplementation(async (value, apply) => {
    apply?.(value);
    return value;
  });
  await act(async () =>
    root.render(
      <MobileSessionProvider>
        <Account />
      </MobileSessionProvider>,
    ),
  );
  native.validate.mockClear();
});
afterEach(async () => {
  await act(() => root.unmount());
  root = createRoot(container);
  vi.useRealTimers();
});
async function transition(state: string) {
  await act(async () => {
    native.state = state;
    for (const listener of native.listeners) listener(state);
  });
}

it("preserves the session without automatic checks on background return or Notification Center", async () => {
  await vi.advanceTimersByTimeAsync(120_000);
  await transition("inactive");
  await transition("active");
  expect(native.validate).not.toHaveBeenCalled();
  await transition("background");
  await transition("active");
  expect(native.validate).not.toHaveBeenCalled();
  await transition("background");
  await vi.advanceTimersByTimeAsync(30_000);
  await transition("inactive");
  await transition("active");
  expect(native.validate).not.toHaveBeenCalled();
  native.validate.mockClear();
  await transition("background");
  await transition("active");
  expect(native.validate).not.toHaveBeenCalled();
  expect(current.session).toBe(session);
});

it("checks every 15 minutes while open, preserves the timer through overlays, and stops in the background", async () => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(14 * 60_000);
  });
  await transition("inactive");
  await transition("active");
  await act(async () => {
    await vi.advanceTimersByTimeAsync(59_999);
  });
  expect(native.validate).not.toHaveBeenCalled();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1);
  });
  expect(native.validate).toHaveBeenCalledTimes(1);
  await transition("background");
  await act(async () => {
    await vi.advanceTimersByTimeAsync(30 * 60_000);
  });
  expect(native.validate).toHaveBeenCalledTimes(1);
  await transition("inactive");
  await transition("active");
  expect(native.validate).toHaveBeenCalledTimes(1);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(15 * 60_000);
  });
  expect(native.validate).toHaveBeenCalledTimes(2);
});

it("coalesces pending profile invalidations and applies the latest profile", async () => {
  const pending = Promise.withResolvers<MobileSession>();
  native.validate.mockImplementationOnce(async (_value, apply) => {
    const updated = await pending.promise;
    apply?.(updated);
    return updated;
  });
  let refreshing: Promise<void>;
  await act(async () => {
    refreshing = current.refreshProfile();
  });
  await act(async () => {
    await current.refreshProfile();
    await current.refreshProfile();
  });
  native.validate.mockImplementation(async (_value, apply) => {
    const updated = { ...session, user: { ...session.user, name: "Latest" } };
    apply?.(updated);
    return updated;
  });
  await act(async () => {
    pending.resolve({ ...session, user: { ...session.user, name: "Updated" } });
    await refreshing;
  });
  expect(native.validate).toHaveBeenCalledTimes(2);
  expect(current.session?.user.name).toBe("Latest");
});

it("defers profile invalidation in the background and clears a revoked session on return", async () => {
  await transition("background");
  await act(async () => current.refreshProfile());
  expect(native.validate).not.toHaveBeenCalled();
  native.validate.mockImplementationOnce(async (_value, apply) => {
    apply?.(null);
    return null;
  });
  await transition("active");
  expect(current.session).toBeNull();
});

it("retains the credential after a network failure without retrying on background return", async () => {
  native.validate.mockRejectedValueOnce(new Error("Offline"));
  await act(async () => current.refreshProfile());
  await transition("background");
  await transition("active");
  expect(native.validate).toHaveBeenCalledTimes(1);
  expect(current.session).toBe(session);
});
