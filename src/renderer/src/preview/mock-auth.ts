import type {
  AccountSession,
  CentralAuthState,
  CentralAuthUser,
  CompanySignInSettings,
  MobileConnectLink,
  OpenBotDesktopApi,
} from "@openbot/contracts/ipc";
import { clone, type Listener, type MockRuntime } from "./mock-support";

export interface MockAuthOptions {
  authState?: CentralAuthState;
}

/** The OpenBot account: its sign-in state and the sessions signed in to it. */
export function createMockAuth(options: MockAuthOptions, { emit }: MockRuntime) {
  const defaultAuthState: CentralAuthState = {
    status: "signed_in",
    user: {
      id: "user-1",
      email: "person@example.com",
      name: "Norbert",
      avatarUrl: null,
    },
  };
  let authState = clone<CentralAuthState>(options.authState ?? defaultAuthState);
  let mobileConnectLink: MobileConnectLink | null = null;
  let accountSessions: AccountSession[] = [
    {
      sessionId: "22222222-2222-4222-8222-222222222222",
      name: "This desktop",
      kind: "desktop",
      current: true,
      connectedAt: Date.now() - 86_400_000,
      lastActiveAt: Date.now(),
    },
    {
      sessionId: "33333333-3333-4333-8333-333333333333",
      name: "Desktop",
      kind: "desktop",
      current: false,
      connectedAt: Date.now() - 172_800_000,
      lastActiveAt: Date.now() - 3_600_000,
    },
    {
      sessionId: "44444444-4444-4444-8444-444444444444",
      name: "Research server",
      kind: "desktop",
      current: false,
      connectedAt: Date.now() - 259_200_000,
      lastActiveAt: Date.now() - 300_000,
      hostedServer: true,
    },
    {
      sessionId: "11111111-1111-4111-8111-111111111111",
      name: "Norbert’s iPhone",
      kind: "mobile",
      current: false,
      connectedAt: Date.now() - 86_400_000,
      lastActiveAt: Date.now() - 60_000,
    },
  ];
  let companySignIn: CompanySignInSettings = {
    redirectUri: "https://api.openbot.run/v1/auth/company/callback",
    scimUrl: "https://api.openbot.run/scim/v2",
    domainRecord: { name: "_openbot", value: "openbot-domain=preview" },
    domainCheck: false,
    connection: null,
  };
  const authListeners = new Set<Listener<CentralAuthState>>();
  function emitAuthState(state: CentralAuthState): void {
    authState = clone(state);
    emit(authListeners, state);
  }

  const auth: OpenBotDesktopApi["auth"] = {
    getState: async () => clone(authState),
    retry: async () => clone(authState),
    requestEmailCode: async (email) => {
      authState = {
        status: "code_sent",
        challengeId: "mock-challenge",
        email,
        expiresAt: Date.now() + 600_000,
        resendAvailableAt: Date.now() + 60_000,
        developmentCode: "2345-6789",
      };
      return clone(authState);
    },
    verifyEmailCode: async () => {
      const email = authState.status === "code_sent" ? authState.email : "person@example.com";
      const user: CentralAuthUser = {
        id: "user-1",
        email,
        name: "Norbert",
        avatarUrl: null,
      };
      authState = { status: "signed_in", user };
      return clone(authState);
    },
    updateName: async (name) => {
      if (authState.status !== "signed_in") return clone(authState);
      authState = { ...authState, user: { ...authState.user, name } };
      emitAuthState(authState);
      return clone(authState);
    },
    updateAvatar: async (image) => {
      if (authState.status !== "signed_in") return clone(authState);
      const avatarUrl = image
        ? `data:${image.mimeType};base64,${btoa(Array.from(image.bytes, (byte) => String.fromCharCode(byte)).join(""))}`
        : null;
      authState = { ...authState, user: { ...authState.user, avatarUrl } };
      emitAuthState(authState);
      return clone(authState);
    },
    updateChatColor: async (chatColor) => {
      if (authState.status !== "signed_in") return clone(authState);
      authState = { ...authState, user: { ...authState.user, chatColor } };
      emitAuthState(authState);
      return clone(authState);
    },
    createMobileConnect: async () => ({
      qrData:
        "openbot://mobile-connect?api=https%3A%2F%2Fapi.openbot.run&ticket=preview-mobile-ticket_1234567890abcdef",
      expiresAt: Date.now() + 120_000,
    }),
    cancelMobileConnect: async () => undefined,
    getMobileConnectLink: async () => clone(mobileConnectLink),
    createMobileConnectLink: async () => {
      mobileConnectLink = {
        url: `openbot://mobile-connect?api=https%3A%2F%2Fapi.openbot.run&ticket=preview-mobile-link_${crypto.randomUUID().replaceAll("-", "")}`,
        createdAt: Date.now(),
      };
      return clone(mobileConnectLink);
    },
    revokeMobileConnectLink: async () => {
      mobileConnectLink = null;
    },
    listMobileConnectedDevices: async () =>
      accountSessions
        .filter((session) => session.kind === "mobile")
        .map((session) => ({
          sessionId: session.sessionId,
          name: session.name,
          platform: "ios",
          connectedAt: session.connectedAt,
          lastActiveAt: session.lastActiveAt,
          via: "code",
        })),
    revokeMobileConnectedDevice: async (sessionId) => {
      accountSessions = accountSessions.filter(
        (session) => session.kind !== "mobile" || session.sessionId !== sessionId,
      );
    },
    listAccountSessions: async () => clone(accountSessions),
    revokeAccountSession: async (sessionId) => {
      accountSessions = accountSessions.filter((session) => session.sessionId !== sessionId);
    },
    logout: async () => {
      authState = { status: "signed_out" };
      emitAuthState(authState);
      return clone(authState);
    },
    openCompanySignIn: async () => clone(authState),
    getCompanySignIn: async () => clone(companySignIn),
    testCompanySignIn: async (input) => {
      companySignIn = {
        ...companySignIn,
        connection: {
          issuer: input.issuer,
          clientId: input.clientId,
          domains: input.domains,
          enabled: companySignIn.connection?.enabled ?? false,
          testedAt: Date.now(),
          scimTokenCreatedAt: companySignIn.connection?.scimTokenCreatedAt ?? null,
        },
      };
      return { email: `admin@${input.domains[0] ?? "example.com"}` };
    },
    cancelCompanySignInTest: async () => undefined,
    setCompanySignInEnabled: async ({ enabled }) => {
      if (companySignIn.connection) {
        companySignIn = { ...companySignIn, connection: { ...companySignIn.connection, enabled } };
      }
      return clone(companySignIn);
    },
    removeCompanySignIn: async () => {
      companySignIn = { ...companySignIn, connection: null };
      return clone(companySignIn);
    },
    createCompanySignInScimToken: async () => {
      const createdAt = Date.now();
      if (companySignIn.connection) {
        companySignIn = {
          ...companySignIn,
          connection: { ...companySignIn.connection, scimTokenCreatedAt: createdAt },
        };
      }
      return { token: `obscim_${crypto.randomUUID().replaceAll("-", "")}`, createdAt };
    },
    revokeCompanySignInScimToken: async () => {
      if (companySignIn.connection) {
        companySignIn = { ...companySignIn, connection: { ...companySignIn.connection, scimTokenCreatedAt: null } };
      }
      return clone(companySignIn);
    },
    onEvent: (listener) => {
      authListeners.add(listener);
      return () => authListeners.delete(listener);
    },
  };

  return {
    auth,
    emitAuthState,
    dispose: () => authListeners.clear(),
  };
}
