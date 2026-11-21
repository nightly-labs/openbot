// headless-auth: the account session, direct implementation of the measured contract.
//
// This mirrors what src/main/central-auth-manager.ts does for the login surface
// (POST /v1/auth/email/start -> challengeId; POST /v1/auth/email/verify ->
// {sessionToken, user}; GET /v1/me with Bearer; POST /v1/auth/logout), with native
// fetch instead of Electron net, and the session stored in the same obk1 container
// the packaged server reads (headless-secret-storage).
//
// When the monorepo has its node_modules installed (on a bigger host), this module
// is the seam to swap for the real CentralAuthManager — the file names and formats
// are identical, so both servers can share one userData alternately.

import { randomUUID } from "node:crypto";
import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { dirname } from "node:path";
import { createHeadlessSecretStorage, type HeadlessSecretStorageCipher } from "./headless-secret-storage";

const API_URL = process.env.OPENBOT_AUTH_API_URL ?? "https://api.openbot.run";

export interface StoredSession {
  version: 2;
  sessionToken: string;
  teamHostTokens: Record<string, string>;
  mobileConnectLink?: string;
  user?: { id: string; email: string; name?: string | null; avatarUrl?: string | null };
}

export interface HeadlessAuthState {
  status: "signed_out" | "signed_in";
  email: string | null;
  user: StoredSession["user"] | null;
}

export class HeadlessAuth {
  #cipher: HeadlessSecretStorageCipher;
  #keyring: ReturnType<typeof createHeadlessSecretStorage>;
  #session: StoredSession | null = null;
  #apiUrl: string;
  #storagePath: string;

  constructor({ userData, apiUrl = API_URL }: { userData: string; apiUrl?: string }) {
    this.#apiUrl = new URL(apiUrl).href;
    this.#keyring = createHeadlessSecretStorage({ keyPath: `${userData}/secret-storage.key` });
    this.#cipher = this.#keyring.cipher(() => "secure storage unavailable on the headless host");
    this.#storagePath = `${userData}/openbot-central-auth-v1.bin`;
  }

  async restore(): Promise<HeadlessAuthState> {
    if (!existsSync(this.#storagePath)) return { status: "signed_out", email: null, user: null };
    const container = Buffer.from(readFileSync(this.#storagePath, "utf8"), "base64");
    const value = this.#cipher.decrypt(container);
    this.#session = JSON.parse(value) as StoredSession;
    return { status: "signed_in", email: this.#session.user?.email ?? null, user: this.#session.user ?? null };
  }

  #persist(session: StoredSession): void {
    mkdirSync(dirname(this.#storagePath), { recursive: true });
    const temporary = `${this.#storagePath}.${randomUUID()}.tmp`;
    writeFileSync(temporary, this.#cipher.encrypt(JSON.stringify(session)).toString("base64"), { mode: 0o600 });
    chmodSync(temporary, 0o600);
    renameSync(temporary, this.#storagePath);
    this.#session = session;
  }

  async requestEmailCode(email: string): Promise<{ challengeId: string; expiresAt: string; resendAt: string }> {
    const response = await fetch(new URL("/v1/auth/email/start", this.#apiUrl), {
      method: "POST",
      headers: { "content-type": "application/json", "idempotency-key": randomUUID() },
      body: JSON.stringify({ email }),
    });
    if (!response.ok) throw new Error(`email start failed: ${response.status}`);
    return (await response.json()) as { challengeId: string; expiresAt: string; resendAt: string };
  }

  async verifyEmailCode(challengeId: string, code: string): Promise<HeadlessAuthState> {
    const response = await fetch(new URL("/v1/auth/email/verify", this.#apiUrl), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ challengeId, code }),
    });
    if (!response.ok) throw new Error(`email verify failed: ${response.status}`);
    const { sessionToken, user } = (await response.json()) as { sessionToken: string; user: StoredSession["user"] };
    this.#persist({ version: 2, sessionToken, teamHostTokens: {}, user });
    return { status: "signed_in", email: user?.email ?? null, user };
  }

  async logout(): Promise<HeadlessAuthState> {
    if (this.#session?.sessionToken) {
      await fetch(new URL("/v1/auth/logout", this.#apiUrl), {
        method: "POST",
        headers: { authorization: `Bearer ${this.#session.sessionToken}` },
      }).catch(() => undefined);
    }
    this.#session = null;
    rmSync(this.#storagePath, { force: true });
    return { status: "signed_out", email: null, user: null };
  }

  state(): HeadlessAuthState {
    return this.#session
      ? { status: "signed_in", email: this.#session.user?.email ?? null, user: this.#session.user ?? null }
      : { status: "signed_out", email: null, user: null };
  }
}
