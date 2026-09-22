import { createInviteUrl, PERMANENT_INVITE_EXPIRES_AT_MS } from "@openbot/contracts/invite-links";
import { createMobileConnectUrl } from "@openbot/contracts/mobile-connect";
import type { RemoteInvitePreview } from "@openbot/team-client/remote-directory";
import { fireEvent, screen, waitFor } from "@testing-library/dom";
import { act, type PropsWithChildren } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { MobileSession } from "@/features/auth/api/mobile-auth";
import { AddServerLinkScreen } from "@/features/servers/screens/add-server-link-screen";
import { AddServerScreen } from "@/features/servers/screens/add-server-screen";
import { forgetIncomingLink, parseIncomingLink, readIncomingLink, rememberIncomingLink } from "../model/incoming-links";
import { IncomingLinkScreen } from "./incoming-link-screen";

// Native views, router hooks, and app contexts have no injectable seam in these screens.
// The real parsers and invitation screen run here; HTTP and storage run in their own boundary tests.
const state = vi.hoisted(() => {
  const initial: { request?: string; session: MobileSession | null } = { session: null };
  return {
    ...initial,
    connect: vi.fn<(session: MobileSession) => void>(),
    redeem: vi.fn<(url: string) => Promise<MobileSession>>(),
    replace: vi.fn(),
    dismiss: vi.fn(),
    openBrowser: vi.fn(),
    preview: vi.fn<(url: string) => Promise<RemoteInvitePreview>>(),
    join: vi.fn<(input: { inviteUrl: string }) => Promise<string>>(),
  };
});
vi.mock("@/features/auth/context/mobile-session-context", () => ({
  useMobileSession: () => ({ session: state.session, connect: state.connect }),
}));
vi.mock("@/features/auth/api/mobile-auth", () => ({ redeemMobileConnectUrl: state.redeem }));
vi.mock("@/features/auth/screens/sign-in-screen", () => ({ SignInScreen: () => <p>Desktop sign-in</p> }));
vi.mock("expo-router", () => ({
  useLocalSearchParams: () => ({ request: state.request }),
  router: { replace: state.replace, dismissTo: state.dismiss, back: state.dismiss },
  Stack: { Screen: () => null },
  Redirect: ({ href }: { href: { pathname: string; params?: { request?: string } } }) => (
    <a href={`${href.pathname}?request=${href.params?.request}`}>Continue to invitation</a>
  ),
}));
vi.mock("expo-router/react-navigation", () => ({ usePreventRemove: () => {} }));
vi.mock("expo-web-browser", () => ({ openBrowserAsync: state.openBrowser }));
vi.mock("heroui-native", () => ({
  Typography: {
    Heading: ({ children }: PropsWithChildren) => <h1>{children}</h1>,
    Paragraph: ({ children }: PropsWithChildren) => <p>{children}</p>,
  },
  Button: Object.assign(
    ({ children, onPress, isDisabled }: PropsWithChildren<{ onPress?: () => void; isDisabled?: boolean }>) => (
      <button type="button" disabled={isDisabled} onClick={onPress}>
        {children}
      </button>
    ),
    { Label: ({ children }: PropsWithChildren) => <span>{children}</span> },
  ),
}));
vi.mock("heroui-native/hooks", () => ({ useThemeColor: () => ["black", "white"] }));
vi.mock("react-native", () => ({
  View: ({ children }: PropsWithChildren) => <div>{children}</div>,
  Pressable: ({ children, onPress, disabled }: PropsWithChildren<{ onPress?: () => void; disabled?: boolean }>) => (
    <button type="button" disabled={disabled} onClick={onPress}>
      {children}
    </button>
  ),
  Keyboard: { dismiss: () => {} },
}));
vi.mock("lucide-react-native", () => ({ ScanLine: () => null, Server: () => null }));
vi.mock("@/features/auth/components/app-logo", () => ({ AppLogo: () => null }));
vi.mock("@/shared/components/sheet-scroll-view", () => ({
  SheetScrollView: ({ children }: PropsWithChildren) => <div>{children}</div>,
}));
vi.mock("@/shared/components/sheet-form-field", () => ({
  SheetFormField: ({ value, onChangeText }: { value: string; onChangeText: (value: string) => void }) => (
    <input aria-label="Invite link" value={value} onChange={(event) => onChangeText(event.target.value)} />
  ),
}));
vi.mock("@/features/workspace/context/mobile-workspace-context", () => {
  const directory = { previewInvite: state.preview };
  return { useMobileWorkspace: () => ({ servers: [], addRemoteServer: state.join, teamDirectory: directory }) };
});

const invite = createInviteUrl({
  apiUrl: "https://api.openbot.run",
  serverId: "11111111-1111-4111-8111-111111111111",
  fingerprint: "f".repeat(43),
  token: "t".repeat(32),
});
const session: MobileSession = {
  apiUrl: "https://api.openbot.run",
  sessionToken: "credential",
  user: { id: "user", email: "user@example.com", name: null, avatarUrl: null },
  host: { hostId: "host", fingerprint: "f".repeat(43) },
};
const preview: RemoteInvitePreview = {
  hostId: "host",
  hostName: "Studio",
  role: "member",
  permanent: true,
  expiresAt: PERMANENT_INVITE_EXPIRES_AT_MS,
  emailBound: false,
  devicePublicKey: "key",
};
const pairing = createMobileConnectUrl({ apiUrl: session.apiUrl, ticket: "c".repeat(32), host: session.host });
let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
const ids: string[] = [];
function receive(url: string) {
  const id = rememberIncomingLink(parseIncomingLink(url));
  ids.push(id);
  state.request = id;
  return id;
}
beforeEach(() => {
  vi.clearAllMocks();
  state.request = undefined;
  state.session = null;
  state.preview.mockReset().mockResolvedValue(preview);
  state.join.mockReset().mockResolvedValue("host");
  state.redeem.mockReset().mockResolvedValue(session);
  state.openBrowser.mockResolvedValue(undefined);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(() => root.unmount());
  container.remove();
  for (const id of ids.splice(0)) forgetIncomingLink(id);
});

it("keeps an invitation through sign-in and routes to review without accepting it", async () => {
  const id = receive(invite);
  await act(() => root.render(<IncomingLinkScreen />));
  expect(screen.getByText("Desktop sign-in")).toBeTruthy();
  expect(state.join).not.toHaveBeenCalled();
  state.session = session;
  await act(() => root.render(<IncomingLinkScreen />));
  expect(screen.getByRole("link").getAttribute("href")).toBe(`/add-server?request=${id}`);
  expect(readIncomingLink(id)).toEqual({ kind: "invite", url: invite });
});

it("clears a canceled invitation before returning to sign-in", async () => {
  const id = receive(invite);
  await act(() => root.render(<IncomingLinkScreen />));
  await act(() => fireEvent.click(screen.getByRole("button", { name: "Cancel invitation" })));
  expect(readIncomingLink(id)).toEqual({ kind: "invalid" });
  expect(state.replace).toHaveBeenCalledWith("/");
});

it("requires one pairing confirmation and returns to the waiting invitation", async () => {
  const invitation = receive(invite);
  receive(pairing);
  await act(() => root.render(<IncomingLinkScreen />));
  expect(state.redeem).not.toHaveBeenCalled();
  await act(() => {
    const button = screen.getByRole("button", { name: "Connect" });
    fireEvent.click(button);
    fireEvent.click(button);
  });
  expect(state.redeem).toHaveBeenCalledExactlyOnceWith(pairing);
  expect(state.connect).toHaveBeenCalledWith(session);
  expect(state.replace).toHaveBeenCalledWith({ pathname: "/incoming-link", params: { request: invitation } });
});

it("does not replace an existing session with a pairing link", async () => {
  state.session = session;
  receive(pairing);
  await act(() => root.render(<IncomingLinkScreen />));
  expect(screen.queryByRole("button", { name: "Connect" })).toBeNull();
  expect(state.redeem).not.toHaveBeenCalled();
});

it("opens a plugin in the browser only after a press", async () => {
  receive("openbot://plugins/test-plugin");
  await act(() => root.render(<IncomingLinkScreen />));
  expect(state.openBrowser).not.toHaveBeenCalled();
  await act(() => fireEvent.click(screen.getByRole("button", { name: "View plugin" })));
  expect(state.openBrowser).toHaveBeenCalledWith("https://openbot.run/plugins/test-plugin");
});

it("verifies the host before showing Join and accepts only on a press", async () => {
  const id = receive(invite);
  await act(() => root.render(<AddServerLinkScreen />));
  expect(state.preview).toHaveBeenCalledWith(invite);
  expect(screen.getByText("Studio")).toBeTruthy();
  expect(screen.getByText("member · No expiry")).toBeTruthy();
  expect(readIncomingLink(id)).toEqual({ kind: "invalid" });
  expect(state.join).not.toHaveBeenCalled();
  await act(() => fireEvent.click(screen.getByRole("button", { name: "Join server" })));
  expect(state.join).toHaveBeenCalledExactlyOnceWith({ inviteUrl: invite });
});

it("blocks joining when verification fails and allows a retry", async () => {
  state.preview.mockRejectedValueOnce(new Error("The invitation host identity does not match its fingerprint."));
  await act(() => root.render(<AddServerScreen initialInvite={invite} />));
  expect(screen.queryByRole("button", { name: "Join server" })).toBeNull();
  expect(state.join).not.toHaveBeenCalled();
  await act(() => fireEvent.click(screen.getByRole("button", { name: "Try again" })));
  expect(screen.getByText("Studio")).toBeTruthy();
  expect(state.join).not.toHaveBeenCalled();
});

it("discards a late preview after switching to another invitation", async () => {
  let finish: (value: RemoteInvitePreview) => void = () => {};
  state.preview.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  receive(invite);
  await act(() => root.render(<AddServerLinkScreen />));
  await waitFor(() => expect(state.preview).toHaveBeenCalledWith(invite));
  const second = invite.replace("t".repeat(32), "u".repeat(32));
  state.preview.mockResolvedValue({ ...preview, hostName: "Other host" });
  receive(second);
  await act(() => root.render(<AddServerLinkScreen />));
  await act(() => finish(preview));
  expect(screen.getByText("Other host")).toBeTruthy();
  expect(screen.queryByText("Studio")).toBeNull();
  await act(() => fireEvent.click(screen.getByRole("button", { name: "Join server" })));
  expect(state.join).toHaveBeenCalledWith({ inviteUrl: second });
});

it("shows a shared redemption error without attaching a session", async () => {
  state.redeem.mockRejectedValueOnce(new Error("Another connection is in progress. Wait for it to finish."));
  receive(pairing);
  await act(() => root.render(<IncomingLinkScreen />));
  await act(() => fireEvent.click(screen.getByRole("button", { name: "Connect" })));
  expect(screen.getByText("Another connection is in progress. Wait for it to finish.")).toBeTruthy();
  expect(state.connect).not.toHaveBeenCalled();
  expect(state.replace).not.toHaveBeenCalled();
  await act(() => fireEvent.click(screen.getByRole("button", { name: "Connect" })));
  expect(state.connect).toHaveBeenCalledExactlyOnceWith(session);
});
