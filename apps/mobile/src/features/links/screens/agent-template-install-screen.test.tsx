import type { AddedAgent, AgentTemplateDetail, InstallAgentTemplateInput } from "@openbot/contracts/ipc";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, screen, waitFor } from "@testing-library/dom";
import { act, type PropsWithChildren, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { MobileServer } from "@/features/workspace/model/workspace-types";
import { forgetIncomingLink, parseIncomingLink, readIncomingLink, rememberIncomingLink } from "../model/incoming-links";
import { AgentTemplateInstallScreen } from "./agent-template-install-screen";

// Native views, router hooks, and app contexts have no injectable seam in this screen.
// The real link store, account-service decoder and query client run here; `expo/fetch` is the boundary.
const state = vi.hoisted(() => {
  const initial: { request?: string; servers: MobileServer[] } = { servers: [] };
  return {
    ...initial,
    capable: new Set<string>(),
    fetch: vi.fn<(url: string) => Promise<Response>>(),
    install: vi.fn<(input: InstallAgentTemplateInput, serverId: string) => Promise<AddedAgent>>(),
    selectServer: vi.fn(),
    refreshServer: vi.fn(),
    dismissTo: vi.fn(),
  };
});
vi.mock("expo/fetch", () => ({ fetch: state.fetch }));
vi.mock("@/features/auth/context/mobile-session-context", () => ({
  useMobileSession: () => ({ session: { apiUrl: "https://api.openbot.run" } }),
}));
vi.mock("@/features/workspace/context/mobile-workspace-context", () => ({
  useMobileWorkspace: () => ({
    servers: state.servers,
    activeServer: state.servers[0],
    canInstallAgentTemplate: (serverId: string) => state.capable.has(serverId),
    installAgentTemplate: state.install,
    selectServer: state.selectServer,
    refreshServer: state.refreshServer,
  }),
}));
vi.mock("expo-router", () => ({
  useLocalSearchParams: () => ({ request: state.request }),
  router: { back: vi.fn(), canGoBack: () => true, replace: vi.fn(), dismissTo: state.dismissTo },
  Stack: {
    Toolbar: Object.assign(({ children }: PropsWithChildren) => <div>{children}</div>, {
      Button: ({ children, onPress }: PropsWithChildren<{ onPress?: () => void }>) => (
        <button type="button" onClick={onPress}>
          {children}
        </button>
      ),
    }),
  },
}));
vi.mock("expo-router/react-navigation", () => ({ usePreventRemove: () => {} }));
vi.mock("@/shared/components/sheet-save-action", () => ({
  SheetSaveAction: ({
    canSave,
    pending,
    label,
    onSave,
  }: {
    canSave: boolean;
    pending: boolean;
    label: string;
    onSave: () => void;
  }) => (
    <button type="button" disabled={!canSave || pending} onClick={onSave}>
      {label}
    </button>
  ),
}));
vi.mock("@/shared/components/sheet-scroll-view", () => ({
  SheetScrollView: ({ children }: PropsWithChildren) => <div>{children}</div>,
}));
vi.mock("@/features/settings/components/settings-content", () => ({
  SettingsRow: ({ children, supportingText }: PropsWithChildren<{ supportingText?: string }>) => (
    <div>
      {children}
      {supportingText ? <p>{supportingText}</p> : null}
    </div>
  ),
  SettingsSection: ({ title, footer, children }: PropsWithChildren<{ title: string; footer?: string }>) => (
    <section aria-label={title}>
      {children}
      {footer ? <p>{footer}</p> : null}
    </section>
  ),
}));
vi.mock("heroui-native", () => ({
  Typography: Object.assign(({ children }: PropsWithChildren) => <span>{children}</span>, {
    Heading: ({ children }: PropsWithChildren) => <h1>{children}</h1>,
    Paragraph: ({ children, accessibilityRole }: PropsWithChildren<{ accessibilityRole?: string }>) => (
      <p role={accessibilityRole}>{children}</p>
    ),
  }),
  Button: Object.assign(
    ({ children, onPress }: PropsWithChildren<{ onPress?: () => void }>) => (
      <button type="button" onClick={onPress}>
        {children}
      </button>
    ),
    { Label: ({ children }: PropsWithChildren) => <span>{children}</span> },
  ),
}));
vi.mock("react-native", () => ({
  View: ({
    children,
    accessibilityRole,
    accessibilityLabel,
  }: PropsWithChildren<{ accessibilityRole?: string; accessibilityLabel?: string }>) =>
    accessibilityRole === "progressbar" ? <progress aria-label={accessibilityLabel} /> : <div>{children}</div>,
  Pressable: ({
    children,
    onPress,
    disabled,
    accessibilityRole,
    accessibilityLabel,
    accessibilityState,
  }: PropsWithChildren<{
    onPress?: () => void;
    disabled?: boolean;
    accessibilityRole?: string;
    accessibilityLabel?: string;
    accessibilityState?: { checked?: boolean; expanded?: boolean };
  }>) =>
    accessibilityRole === "radio" ? (
      <label>
        <input
          type="radio"
          aria-label={accessibilityLabel}
          checked={accessibilityState?.checked ?? false}
          disabled={disabled}
          readOnly
          onClick={onPress}
        />
        {children}
      </label>
    ) : (
      <button
        type="button"
        aria-label={accessibilityLabel}
        aria-expanded={accessibilityState?.expanded}
        onClick={onPress}
      >
        {children}
      </button>
    ),
}));
vi.mock("heroui-native/hooks", () => ({
  useThemeColor: (key: string | string[]) => (Array.isArray(key) ? key.map(() => "white") : "white"),
}));
vi.mock("uniwind", () => ({ useCSSVariable: () => "gray" }));
vi.mock("lucide-react-native", () => ({ Check: () => null, ChevronDown: () => null, ChevronRight: () => null }));
vi.mock("@/features/chat/components/thinking-text-gradient", () => ({
  ThinkingTextGradient: ({ children }: PropsWithChildren) => <>{children}</>,
}));
vi.mock("@/shared/components/blur-reveal", () => ({
  BlurReveal: <T,>({ value, children }: { value: T | null; children: (value: T) => ReactNode }) =>
    value === null ? null : children(value),
}));
vi.mock("@/features/agents/components/bloub-avatar", () => ({ BloubAvatarPreview: () => null }));

const templateId = "AbCdEfGhIjKlMnOpQrSt_-";
const detail: AgentTemplateDetail = {
  id: templateId,
  name: "dr eggbot",
  title: "Agent designer",
  description: "Designs high-quality agents.",
  avatarSeed: "dr-eggbot",
  avatarHue: null,
  avatarUrl: null,
  skills: [{ kind: "embedded", slug: "agent-interview", name: "agent-interview", markdown: "# Interview\n" }],
  routines: [],
  creatorName: "Ada",
  updatedAt: "2026-09-25T09:06:00.000Z",
};
function server(id: string, name: string, role: MobileServer["role"]): MobileServer {
  return {
    id,
    name,
    kind: "remote",
    state: "online",
    initialConnectionPending: false,
    connectionMessage: null,
    address: null,
    accent: "blue",
    publicKey: "key",
    membershipId: `membership-${id}`,
    role,
  };
}
function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
}

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
const ids: string[] = [];
function receive(url: string): string {
  const id = rememberIncomingLink(parseIncomingLink(url));
  ids.push(id);
  state.request = id;
  return id;
}
async function render(): Promise<void> {
  const client = new QueryClient();
  await act(() =>
    root.render(
      <QueryClientProvider client={client}>
        <AgentTemplateInstallScreen />
      </QueryClientProvider>,
    ),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  state.servers = [
    server("member", "Guest", "member"),
    server("old", "Old", "admin"),
    server("studio", "Studio", "owner"),
    server("lab", "Lab", "admin"),
  ];
  state.capable = new Set(["member", "studio", "lab"]);
  state.fetch.mockReset().mockImplementation(async () => json(detail));
  state.install.mockReset().mockResolvedValue({ id: "agent-1", name: "dr eggbot" });
  state.refreshServer.mockResolvedValue(undefined);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(() => root.unmount());
  container.remove();
  for (const id of ids.splice(0)) forgetIncomingLink(id);
});

it("previews the template and installs it only on an eligible server the user chose", async () => {
  const id = receive(`https://openbot.run/agents/${templateId}`);
  await render();
  expect(screen.getByRole("progressbar", { name: "Loading agent…" })).toBeTruthy();
  await screen.findByRole("heading", { name: "dr eggbot" });
  expect(state.fetch).toHaveBeenCalledWith(
    `https://api.openbot.run/v1/agent-templates/${templateId}`,
    expect.anything(),
  );
  expect(readIncomingLink(id)).toEqual({ kind: "invalid" });
  // A local skill opens to show the SKILL.md text it installs.
  expect(screen.queryByText("# Interview")).toBeNull();
  await act(() => fireEvent.click(screen.getByRole("button", { name: "agent-interview" })));
  expect(screen.getByText("# Interview")).toBeTruthy();
  // A member's server is not listed. An admin's host without agent-install-v1 is listed but disabled.
  expect(screen.getAllByRole("radio").map((choice) => choice.getAttribute("aria-label"))).toEqual([
    "Old",
    "Studio",
    "Lab",
  ]);
  expect(screen.getByRole("radio", { name: "Old" })).toHaveProperty("disabled", true);
  expect(screen.getByText("Update OpenBot on this server to add shared agents.")).toBeTruthy();
  expect(screen.getByText("Only servers where you are an owner or admin are listed.")).toBeTruthy();
  expect(state.install).not.toHaveBeenCalled();

  await act(() => fireEvent.click(screen.getByRole("radio", { name: "Lab" })));
  expect(screen.getByRole("radio", { name: "Lab" })).toHaveProperty("checked", true);
  await act(() => fireEvent.click(screen.getByRole("button", { name: "Add agent" })));

  expect(state.install).toHaveBeenCalledExactlyOnceWith(
    { templateId, timezone: expect.any(String), expectedUpdatedAt: detail.updatedAt },
    "lab",
  );
  await waitFor(() => expect(state.dismissTo).toHaveBeenCalledWith("/connected"));
  expect(state.selectServer).toHaveBeenCalledWith("lab");
  expect(state.refreshServer).toHaveBeenCalledWith("lab");
});

it("keeps the sheet and shows the host refusal when the install fails", async () => {
  state.install.mockRejectedValueOnce(new Error("Only an owner or admin can add agents."));
  receive(`openbot://agents/${templateId}`);
  await render();
  await screen.findByRole("heading", { name: "dr eggbot" });
  await act(() => fireEvent.click(screen.getByRole("button", { name: "Add agent" })));
  expect(state.install).toHaveBeenCalledWith(expect.objectContaining({ templateId }), "studio");
  expect((await screen.findByRole("alert")).textContent).toBe("Only an owner or admin can add agents.");
  expect(state.dismissTo).not.toHaveBeenCalled();
});

it("lists a connecting server as disabled and does not offer Install", async () => {
  state.servers = [
    server("member", "Guest", "member"),
    { ...server("studio", "Studio", "owner"), state: "connecting" },
  ];
  receive(`openbot://agents/${templateId}`);
  await render();
  await screen.findByRole("heading", { name: "dr eggbot" });
  expect(screen.getAllByRole("radio")).toHaveLength(1);
  expect(screen.getByRole("radio", { name: "Studio" })).toHaveProperty("disabled", true);
  expect(screen.getByRole("button", { name: "Add agent" })).toHaveProperty("disabled", true);
});

it("tells a member that only an owner or admin can add the agent", async () => {
  state.servers = [server("member", "Guest", "member")];
  receive(`openbot://agents/${templateId}`);
  await render();
  await screen.findByText("You must be an owner or admin of a server to add a shared agent.");
  expect(screen.queryByRole("radio")).toBeNull();
  expect(screen.getByRole("button", { name: "Add agent" })).toHaveProperty("disabled", true);
});

it("shows a removed template as not found", async () => {
  state.fetch.mockResolvedValueOnce(json({ error: "The agent was not found." }, 404));
  receive(`openbot://agents/${templateId}`);
  await render();
  await screen.findByRole("heading", { name: "Agent not found" });
  expect(screen.queryByRole("radio")).toBeNull();
});

it("shows a load failure and loads the template again on Retry", async () => {
  state.fetch.mockResolvedValueOnce(json({ error: "unavailable" }, 503));
  receive(`openbot://agents/${templateId}`);
  await render();
  await screen.findByRole("heading", { name: "Could not load the agent" });
  await act(() => fireEvent.click(screen.getByRole("button", { name: "Retry" })));
  await screen.findByRole("heading", { name: "dr eggbot" });
});

it("refuses a template whose id differs from the link", async () => {
  state.fetch.mockResolvedValueOnce(json({ ...detail, id: "ZyXwVuTsRqPoNmLkJiHg_-" }));
  receive(`openbot://agents/${templateId}`);
  await render();
  await screen.findByRole("heading", { name: "Could not load the agent" });
  expect(screen.queryByRole("radio")).toBeNull();
});

it("shows a malformed link as unavailable without a request", async () => {
  receive(`openbot://agents/${templateId}?install=1`);
  await render();
  expect(screen.getByRole("heading", { name: "Link unavailable" })).toBeTruthy();
  expect(state.fetch).not.toHaveBeenCalled();
});
