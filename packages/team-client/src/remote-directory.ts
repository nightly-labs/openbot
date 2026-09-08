import { sha256 } from "@noble/hashes/sha2.js";
import { createInviteUrl, parseInviteUrl } from "@openbot/contracts/invite-links";
import type { MobileConnectHostBinding } from "@openbot/contracts/mobile-connect";
import { decodeRemoteSession, decodeRemoteSessionTicket } from "@openbot/contracts/remote-control-plane";
import { isBoolean, isDynamicRecord, isNumber, isString } from "@openbot/contracts/runtime-values";

import type { TeamClientFetch } from "./index";

export interface RemoteTeamHost {
  hostId: string;
  name: string;
  logoKey: string | null;
  devicePublicKey: string;
  membershipId: string;
  role: "owner" | "admin" | "member";
}

export interface RemoteTeamMember {
  membershipId: string;
  email: string;
  name: string | null;
  role: "owner" | "admin" | "member";
  status: "active" | "revoked";
}

export interface RemoteTeamInvite {
  inviteId: string;
  email: string | null;
  role: "admin" | "member";
  expiresAt: number;
  usedAt: number | null;
  revokedAt: number | null;
}

export interface RemoteTeamBootstrap {
  sessionId: string;
  expiresAt: number;
  signalUrl: string;
  ticket: string;
}

export interface RemoteInvitePreview {
  hostId: string;
  hostName: string;
  role: "admin" | "member";
  expiresAt: number;
  emailBound: boolean;
  devicePublicKey: string | null;
}

export interface RemoteHostKeyStore {
  get(hostId: string): Promise<string | null>;
  set(hostId: string, publicKey: string): Promise<void>;
}

export function remoteHostFingerprint(publicKey: string): string {
  const digest = sha256(new TextEncoder().encode(publicKey));
  return btoa(String.fromCharCode(...digest))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
}

export class RemoteDirectoryError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export class RemoteTeamDirectoryClient {
  readonly #apiUrl: string;
  readonly #token: string;
  readonly #fetch: TeamClientFetch;
  readonly #hostKeys: RemoteHostKeyStore;
  readonly #pairedHost: MobileConnectHostBinding | undefined;
  #pinTail: Promise<void> = Promise.resolve();

  constructor(input: {
    apiUrl: string;
    token: string;
    fetch: TeamClientFetch;
    hostKeys?: RemoteHostKeyStore;
    pairedHost?: MobileConnectHostBinding;
  }) {
    this.#apiUrl = input.apiUrl;
    this.#token = input.token;
    this.#fetch = input.fetch;
    this.#pairedHost = input.pairedHost;
    const keys = new Map<string, string>();
    this.#hostKeys = input.hostKeys ?? {
      get: async (hostId) => keys.get(hostId) ?? null,
      set: async (hostId, key) => {
        keys.set(hostId, key);
      },
    };
  }

  async listHosts(): Promise<RemoteTeamHost[]> {
    const value = await this.#request("/v2/remote/hosts/");
    if (!isDynamicRecord(value) || !Array.isArray(value.hosts)) throw new Error("The server list is invalid.");
    const hosts = await Promise.all(
      value.hosts.map(async (candidate): Promise<RemoteTeamHost[]> => {
        if (!isDynamicRecord(candidate) || !isString(candidate.devicePublicKey) || !candidate.devicePublicKey)
          return [];
        if (
          !isString(candidate.hostId) ||
          !isString(candidate.name) ||
          (candidate.logoKey !== null && !isString(candidate.logoKey)) ||
          !isString(candidate.membershipId) ||
          (candidate.role !== "owner" && candidate.role !== "admin" && candidate.role !== "member")
        ) {
          throw new Error("A server record is invalid.");
        }
        const pinnedKey = await this.#hostKeys.get(candidate.hostId);
        if (pinnedKey && remoteHostFingerprint(candidate.devicePublicKey) !== remoteHostFingerprint(pinnedKey)) {
          throw new Error("The server identity changed. Refusing to replace the trusted host key.");
        }
        return [
          {
            hostId: candidate.hostId,
            name: candidate.name,
            logoKey: candidate.logoKey,
            devicePublicKey: pinnedKey ?? candidate.devicePublicKey,
            membershipId: candidate.membershipId,
            role: candidate.role,
          },
        ];
      }),
    );
    const directory = hosts.flat();
    if (this.#pairedHost) {
      const paired = directory.find((host) => host.hostId === this.#pairedHost?.hostId);
      if (paired && remoteHostFingerprint(paired.devicePublicKey) !== this.#pairedHost.fingerprint) {
        throw new Error("The paired desktop identity is missing or changed. Scan a new code from that desktop.");
      }
      if (paired) await this.#pinHostKey(paired.hostId, paired.devicePublicKey);
    }
    return directory;
  }

  async listMembers(hostId: string): Promise<RemoteTeamMember[]> {
    const value = await this.#request(`/v2/remote/hosts/${encodeURIComponent(hostId)}/members/`);
    if (!isDynamicRecord(value) || !Array.isArray(value.members)) throw new Error("The member list is invalid.");
    return value.members.map(decodeMember);
  }

  async listInvites(hostId: string): Promise<RemoteTeamInvite[]> {
    const value = await this.#request(`/v2/remote/hosts/${encodeURIComponent(hostId)}/invites`);
    if (!isDynamicRecord(value) || !Array.isArray(value.invites)) throw new Error("The invitation list is invalid.");
    return value.invites.map(decodeInvite);
  }

  async createInvite(
    host: { hostId: string; devicePublicKey: string },
    input: { role: "admin" | "member"; email?: string },
  ): Promise<{ inviteId: string; inviteUrl: string; expiresAt: number }> {
    // Validate the URL before creating a one-use invitation.
    const payload = {
      apiUrl: new URL(this.#apiUrl).toString(),
      serverId: host.hostId,
      fingerprint: remoteHostFingerprint(host.devicePublicKey),
      token: "x".repeat(32),
    };
    createInviteUrl(payload);
    const value = await this.#request(`/v2/remote/hosts/${encodeURIComponent(host.hostId)}/invites`, {
      method: "POST",
      body: input,
    });
    if (!isDynamicRecord(value) || !isString(value.inviteId) || !isString(value.token) || !isNumber(value.expiresAt))
      throw new Error("The invitation is invalid.");
    return {
      inviteId: value.inviteId,
      inviteUrl: createInviteUrl({ ...payload, token: value.token }),
      expiresAt: value.expiresAt,
    };
  }

  async sendInviteEmail(
    host: { hostId: string; devicePublicKey: string; name: string },
    input: { role: "admin" | "member"; email: string },
  ): Promise<{ inviteId: string; inviteUrl: string; expiresAt: number }> {
    const invite = await this.createInvite(host, input);
    try {
      await this.#request("/v1/team-invitations/email", {
        method: "POST",
        body: { ...input, serverName: host.name, inviteUrl: invite.inviteUrl },
      });
    } catch (error) {
      await this.revokeInvite(invite.inviteId).catch(() => undefined);
      throw error;
    }
    return invite;
  }

  async revokeInvite(inviteId: string): Promise<void> {
    await this.#request(`/v2/remote/invites/${encodeURIComponent(inviteId)}`, { method: "DELETE" });
  }

  async updateMember(
    hostId: string,
    membershipId: string,
    role: "admin" | "member",
    reactivate = false,
  ): Promise<void> {
    await this.#request(`/v2/remote/hosts/${encodeURIComponent(hostId)}/members/${encodeURIComponent(membershipId)}`, {
      method: "PATCH",
      body: { role, ...(reactivate ? { reactivate: true } : {}) },
    });
  }

  async leaveHost(hostId: string, membershipId: string): Promise<void> {
    await this.#request(`/v2/remote/hosts/${encodeURIComponent(hostId)}/members/${encodeURIComponent(membershipId)}`, {
      method: "DELETE",
    });
    // Keep the identity pin: leaving a team must not silently trust a substituted key on rejoin.
  }

  async createBootstrap(hostId: string, clientPublicKey: string): Promise<RemoteTeamBootstrap> {
    const session = decodeRemoteSession(
      await this.#request("/v2/remote/sessions/", { method: "POST", body: { hostId } }),
    );
    try {
      const ticket = decodeRemoteSessionTicket(
        await this.#request(`/v2/remote/sessions/${encodeURIComponent(session.sessionId)}/ticket`, {
          method: "POST",
          body: { clientPublicKey },
        }),
      );
      return {
        sessionId: session.sessionId,
        expiresAt: session.expiresAt,
        signalUrl: ticket.signalUrl,
        ticket: ticket.ticket,
      };
    } catch (error) {
      // The session is account-scoped and the host refuses a second one, so a failure between
      // creating it and holding a ticket has to give it back or the next attempt is locked out.
      await this.endSession(session.sessionId).catch(() => undefined);
      throw error;
    }
  }

  async endSession(sessionId: string): Promise<void> {
    await this.#request(`/v2/remote/sessions/${encodeURIComponent(sessionId)}/end`, { method: "POST" });
  }

  async previewInvite(inviteUrl: string): Promise<RemoteInvitePreview> {
    const invite = parseInviteUrl(inviteUrl);
    if (new URL(invite.apiUrl).origin !== new URL(this.#apiUrl).origin) {
      throw new Error("This invitation belongs to another OpenBot service.");
    }
    const value = await this.#request("/v2/remote/invites/preview", {
      method: "POST",
      body: { token: invite.token },
      authenticated: false,
    });
    const preview = decodeInvitePreview(value, invite.serverId);
    if (!preview.devicePublicKey || remoteHostFingerprint(preview.devicePublicKey) !== invite.fingerprint) {
      throw new Error("The invitation host identity does not match its fingerprint.");
    }
    return preview;
  }

  async acceptInvite(inviteUrl: string): Promise<RemoteTeamHost> {
    const invite = parseInviteUrl(inviteUrl);
    const preview = await this.previewInvite(inviteUrl);
    if (!preview.devicePublicKey) throw new Error("The invitation host key is missing.");
    // Save the pin before consuming the one-use token, including across app restarts.
    await this.#pinHostKey(invite.serverId, preview.devicePublicKey);
    const accepted = await this.#request("/v2/remote/invites/accept", {
      method: "POST",
      body: { token: invite.token },
    });
    if (
      !isDynamicRecord(accepted) ||
      accepted.hostId !== invite.serverId ||
      !isString(accepted.membershipId) ||
      !accepted.membershipId ||
      accepted.role !== preview.role
    )
      throw new Error("The account service returned an invalid invitation acceptance.");
    return {
      hostId: invite.serverId,
      name: preview.hostName,
      logoKey: null,
      devicePublicKey: preview.devicePublicKey,
      membershipId: accepted.membershipId,
      role: preview.role,
    };
  }

  #pinHostKey(hostId: string, publicKey: string): Promise<void> {
    const operation = this.#pinTail.then(async () => {
      const pinned = await this.#hostKeys.get(hostId);
      if (pinned && remoteHostFingerprint(pinned) !== remoteHostFingerprint(publicKey)) {
        throw new Error("The invitation conflicts with the trusted host key.");
      }
      await this.#hostKeys.set(hostId, publicKey);
    });
    this.#pinTail = operation.catch(() => undefined);
    return operation;
  }

  async #request(
    path: string,
    options: { method?: string; body?: object; authenticated?: boolean } = {},
  ): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);
    try {
      const response = await this.#fetch(new URL(path, this.#apiUrl), {
        method: options.method ?? "GET",
        headers: {
          ...(options.authenticated === false ? {} : { Authorization: `Bearer ${this.#token}` }),
          ...(options.body ? { "Content-Type": "application/json" } : {}),
        },
        ...(options.body ? { body: JSON.stringify(options.body) } : {}),
        signal: controller.signal,
      });
      const value = await response.json().catch(() => null);
      if (!response.ok) throw new RemoteDirectoryError(response.status, errorMessage(value));
      return value;
    } finally {
      clearTimeout(timer);
    }
  }
}

function decodeInvitePreview(value: unknown, expectedHostId: string): RemoteInvitePreview {
  if (
    !isDynamicRecord(value) ||
    value.hostId !== expectedHostId ||
    !isString(value.hostName) ||
    (value.role !== "admin" && value.role !== "member") ||
    !isNumber(value.expiresAt) ||
    !isBoolean(value.emailBound) ||
    (value.devicePublicKey !== null && !isString(value.devicePublicKey))
  ) {
    throw new Error("The invitation preview is invalid.");
  }
  return {
    hostId: expectedHostId,
    hostName: value.hostName,
    role: value.role,
    expiresAt: value.expiresAt,
    emailBound: value.emailBound,
    devicePublicKey: value.devicePublicKey,
  };
}

function errorMessage(value: unknown): string {
  if (isDynamicRecord(value)) {
    if (isString(value.error)) return value.error;
    if (isDynamicRecord(value.error) && isString(value.error.message)) return value.error.message;
  }
  return "The OpenBot service request failed.";
}

function decodeMember(value: unknown): RemoteTeamMember {
  if (
    !isDynamicRecord(value) ||
    !isString(value.membershipId) ||
    !isString(value.email) ||
    (value.name !== null && !isString(value.name)) ||
    (value.role !== "owner" && value.role !== "admin" && value.role !== "member") ||
    (value.status !== "active" && value.status !== "revoked")
  )
    throw new Error("The member record is invalid.");
  return {
    membershipId: value.membershipId,
    email: value.email,
    name: value.name,
    role: value.role,
    status: value.status,
  };
}

function decodeInvite(value: unknown): RemoteTeamInvite {
  if (
    !isDynamicRecord(value) ||
    !isString(value.inviteId) ||
    (value.email !== null && !isString(value.email)) ||
    (value.role !== "admin" && value.role !== "member") ||
    !isNumber(value.expiresAt) ||
    (value.usedAt !== null && !isNumber(value.usedAt)) ||
    (value.revokedAt !== null && !isNumber(value.revokedAt))
  )
    throw new Error("The invitation record is invalid.");
  return {
    inviteId: value.inviteId,
    email: value.email,
    role: value.role,
    expiresAt: value.expiresAt,
    usedAt: value.usedAt,
    revokedAt: value.revokedAt,
  };
}

export const REMOTE_ACCOUNT_CHECK_INTERVAL_MS = 15 * 60_000;

/** The caller starts this watcher in the foreground and stops it on background entry. */
export function watchRemoteDirectory(refresh: () => Promise<void>): () => void {
  const timer = setInterval(() => void refresh().catch(() => undefined), REMOTE_ACCOUNT_CHECK_INTERVAL_MS);
  return () => clearInterval(timer);
}

/** Refresh on demand or foreground entry; coalesce requests and rate-limit automatic retries. */
export function createRemoteDirectoryRefresh(load: () => Promise<void>, now = Date.now) {
  let pending: Promise<void> | null = null;
  let lastAttempt = Number.NEGATIVE_INFINITY;
  return {
    refresh(force = false): Promise<void> {
      if (pending) return pending;
      if (!force && now() - lastAttempt < REMOTE_ACCOUNT_CHECK_INTERVAL_MS) return Promise.resolve();
      lastAttempt = now();
      const operation = load();
      pending = operation;
      void operation
        .finally(() => {
          if (pending === operation) pending = null;
        })
        .catch(() => undefined);
      return operation;
    },
    invalidate(): void {
      pending = null;
      lastAttempt = Number.NEGATIVE_INFINITY;
    },
  };
}
