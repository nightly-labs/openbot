import { fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createMockWebRuntime } from "../../preview/mock-web-runtime";
import { WebApp } from "./WebApp";

afterEach(() => vi.unstubAllGlobals());
function setup() {
  let changed: (() => void) | null = null;
  const posted = vi.fn();
  const close = vi.fn();
  vi.stubGlobal(
    "BroadcastChannel",
    class {
      postMessage = posted;
      close = close;
      set onmessage(listener: () => void) {
        changed = listener;
      }
    },
  );
  const fetch = vi.fn().mockResolvedValue(Response.json({ user: { id: "account", email: "test@example.test" } }));
  vi.stubGlobal("fetch", fetch);
  return { fetch, posted, close, changed: () => changed?.() };
}
describe("browser account UI", () => {
  it("guides an account without hosts and connects after refresh", async () => {
    setup();
    render(() => (
      <WebApp
        createRuntime={(...args) => {
          const runtime = createMockWebRuntime(...args);
          return { ...runtime, listHosts: vi.fn(runtime.listHosts).mockResolvedValueOnce([]) };
        }}
      />
    ));
    expect(await screen.findByRole("link", { name: "Download OpenBot" })).toHaveAttribute("href", "/#download");
    expect(screen.getByRole("button", { name: "Join with invitation" })).toBeEnabled();
    await waitFor(() => expect(screen.getByRole("button", { name: "Refresh hosts" })).toBeEnabled());
    await fireEvent.click(screen.getByRole("button", { name: "Refresh hosts" }));
    await screen.findByRole("button", { name: "View agent settings" });
    expect(screen.queryByRole("link", { name: "Download OpenBot" })).not.toBeInTheDocument();
  });
  it("allows retry when the host directory fails", async () => {
    setup();
    render(() => (
      <WebApp
        createRuntime={(...args) => {
          const runtime = createMockWebRuntime(...args);
          return {
            ...runtime,
            listHosts: vi.fn(runtime.listHosts).mockRejectedValueOnce(new Error("Host directory unavailable.")),
          };
        }}
      />
    ));
    await screen.findByText("Could not load your computers");
    await fireEvent.click(screen.getByRole("button", { name: "Refresh hosts" }));
    await screen.findByRole("button", { name: "View agent settings" });
  });

  it("keeps the email challenge after an incorrect code so the user can retry", async () => {
    const mock = setup();
    mock.fetch.mockResolvedValueOnce(Response.json({}, { status: 401 }));
    render(() => <WebApp createRuntime={createMockWebRuntime} />);
    await fireEvent.input(await screen.findByRole("textbox", { name: "Email", exact: true }), {
      target: { value: "test@example.test" },
    });
    mock.fetch.mockResolvedValueOnce(Response.json({ challengeId: "challenge", resendAt: Date.now() + 60000 }));
    await fireEvent.click(screen.getByRole("button", { name: "Send sign-in code" }));
    expect(mock.fetch).toHaveBeenCalledWith(
      "/api/browser/email/start",
      expect.objectContaining({ body: JSON.stringify({ email: "test@example.test" }) }),
    );
    const code = await screen.findByRole("textbox", { name: "One-time code" });
    mock.fetch.mockResolvedValueOnce(
      Response.json(
        { error: { code: "invalid_sign_in_code", message: "The sign-in code is incorrect." } },
        { status: 401 },
      ),
    );
    await fireEvent.input(code, { target: { value: "23456789" } });
    await screen.findByText("The sign-in code is incorrect.");
    await fireEvent.input(screen.getByRole("textbox", { name: "One-time code" }), { target: { value: "34567892" } });
    await screen.findByRole("button", { name: "Open account actions" });
    expect(screen.queryByText("The account session has ended.")).not.toBeInTheDocument();
    expect(mock.fetch).toHaveBeenCalledWith(
      "/api/browser/email/verify",
      expect.objectContaining({ body: JSON.stringify({ challengeId: "challenge", code: "3456-7892" }) }),
    );
  });
  it("restores the protected session and clears private UI when another tab signs out", async () => {
    const mock = setup();
    const app = render(() => <WebApp createRuntime={createMockWebRuntime} />);
    await screen.findByRole("button", { name: "Open account actions" });
    expect(mock.fetch).toHaveBeenCalledWith(
      "/api/browser/session",
      expect.objectContaining({ credentials: "same-origin", cache: "no-store" }),
    );
    mock.fetch.mockResolvedValue(Response.json({ error: { message: "Sign in is required." } }, { status: 401 }));
    mock.changed();
    await screen.findByRole("textbox", { name: "Email", exact: true });
    expect(screen.queryByRole("button", { name: "Open account actions" })).not.toBeInTheDocument();
    app.unmount();
    expect(mock.close).toHaveBeenCalledOnce();
  });
  it("revokes on sign-out and tells other tabs to clear their state", async () => {
    const mock = setup();
    render(() => <WebApp createRuntime={createMockWebRuntime} />);
    await screen.findByRole("button", { name: "Open account actions" });
    mock.fetch.mockResolvedValue(Response.json({ signedOut: true }));
    await fireEvent.click(screen.getByRole("button", { name: "Open account actions" }));
    await fireEvent.click(await screen.findByRole("button", { name: "Sign out" }));
    await screen.findByRole("textbox", { name: "Email", exact: true });
    expect(mock.fetch).toHaveBeenLastCalledWith(
      "/api/browser/logout",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json", "X-OpenBot-Browser": "1" },
      }),
    );
    expect(mock.posted).toHaveBeenCalledWith("session-changed");
  });
  it("hides the private workspace when the server disables browser access", async () => {
    const mock = setup();
    mock.fetch.mockResolvedValue(
      Response.json({ error: { message: "Disabled" } }, { status: 404, headers: { "X-OpenBot-Web-Disabled": "1" } }),
    );
    render(() => <WebApp createRuntime={createMockWebRuntime} />);
    await waitFor(() => expect(screen.getByText("Browser access is not available yet.")).toBeVisible());
    expect(screen.queryByRole("textbox", { name: "Email", exact: true })).not.toBeInTheDocument();
  });
});
