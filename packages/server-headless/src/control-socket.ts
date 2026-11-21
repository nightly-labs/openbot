// control-socket: the /v1 surface of src/main/server-mode.ts, served by Bun without
// the Electron host. Answers in the same "key=value" text/plain format the packaged
// server uses (server-mode.ts:238-247 formatLines), so the existing bash CLI
// (`openbot status`, `openbot login`) parses this module's answers unchanged.
//
// Milestone 1 scope: status, login start/verify, logout. The remaining routes
// (name, mobile-connect, claim) are TODO and answer 404 until HostService wiring lands.

import { createServer, type Server } from "node:http";
import { chmodSync, readFileSync } from "node:fs";
import type { HeadlessAuth, HeadlessAuthState } from "./headless-auth";

const MAX_BODY_BYTES = 4096; // same limit as server-mode.ts

function formatLines(lines: Record<string, string | number | null>): string {
  return Object.entries(lines)
    .filter(([, value]) => value !== null && value !== undefined)
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
}

function memoryLines(): Record<string, string | number> {
  const memAvailableKb = Number(/^MemAvailable:\s+(\d+)/m.exec(readMeminfo())?.[1] ?? 0);
  const memTotalKb = Number(/^MemTotal:\s+(\d+)/m.exec(readMeminfo())?.[1] ?? 0);
  const level = memAvailableKb > 512 * 1024 ? "ok" : memAvailableKb > 256 * 1024 ? "low" : "critical";
  return {
    memory_level: level,
    memory_free_mib: Math.round(memAvailableKb / 1024),
    memory_total_mib: Math.round(memTotalKb / 1024),
  };
}

function readMeminfo(): string {
  try {
    return readFileSync("/proc/meminfo", "utf8");
  } catch {
    return "";
  }
}

interface Answer {
  status: number;
  lines: Record<string, string | number | null>;
}

export class ControlSocket {
  #server: Server | null = null;

  constructor(private options: {
    socketPath: string;
    version: string;
    auth: HeadlessAuth;
    serverName: string | null;
  }) {}

  status(state: HeadlessAuthState): Answer {
    return {
      status: 200,
      lines: {
        version: this.options.version,
        account: state.status,
        email: state.email,
        server: state.status === "signed_in" ? "online" : "signed_out",
        server_name: this.options.serverName,
        server_message: "headless research host; no WebRTC bridge yet",
        ...memoryLines(),
      },
    };
  }

  listen(onState: (state: HeadlessAuthState) => void): Promise<void> {
    const server = createServer((request, response) => {
      void (async () => {
        let answer: Answer;
        try {
          const body = await readBody(request);
          if (body === null) {
            answer = { status: 413, lines: { error: "too_large" } };
          } else {
            answer = await this.#route(request.method, request.url, body, onState);
          }
        } catch (error) {
          answer = { status: 400, lines: { error: "failed", message: String(error) } };
        }
        response
          .writeHead(answer.status, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" })
          .end(formatLines(answer.lines));
      })();
    });
    return new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(this.options.socketPath, () => {
        server.removeListener("error", reject);
        chmodSync(this.options.socketPath, 0o600);
        resolve();
      });
    }).then(() => {
      this.#server = server;
    });
  }

  async close(): Promise<void> {
    await new Promise<void>((resolve) => this.#server?.close(() => resolve()));
    this.#server = null;
  }

  async #route(
    method: string | undefined,
    url: string | undefined,
    body: URLSearchParams,
    onState: (state: HeadlessAuthState) => void,
  ): Promise<Answer> {
    const path = url?.split("?")[0] ?? "";
    const route = `${method ?? ""} ${path}`;
    switch (route) {
      case "GET /v1/status":
        return this.status(this.options.auth.state());

      case "POST /v1/login/start": {
        const email = body.get("email") ?? "";
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/u.test(email)) return { status: 400, lines: { error: "invalid_email" } };
        try {
          const challenge = await this.options.auth.requestEmailCode(email);
          onState({ status: "signed_out", email: null, user: null });
          return {
            status: 200,
            lines: { challenge: challenge.challengeId, expires_at: challenge.expiresAt, resend_at: challenge.resendAt },
          };
        } catch {
          return { status: 400, lines: { error: "account_error" } };
        }
      }

      case "POST /v1/login/verify": {
        const challenge = body.get("challenge") ?? "";
        const code = body.get("code") ?? "";
        if (!challenge || !code) return { status: 400, lines: { error: "invalid_request" } };
        try {
          const state = await this.options.auth.verifyEmailCode(challenge, code);
          onState(state);
          return this.status(state);
        } catch {
          return { status: 400, lines: { error: "account_error" } };
        }
      }

      case "POST /v1/logout": {
        const state = await this.options.auth.logout();
        onState(state);
        return this.status(state);
      }

      default:
        return { status: 404, lines: { error: "not_found" } };
    }
  }
}

async function readBody(request: import("node:http").IncomingMessage): Promise<URLSearchParams | null> {
  const raw = await new Promise<string>((resolve, reject) => {
    let data = "";
    request.on("data", (chunk: Buffer) => {
      data += chunk;
      if (data.length > MAX_BODY_BYTES) {
        reject(new Error("too_large"));
        request.destroy();
      }
    });
    request.on("end", () => resolve(data));
    request.on("error", reject);
  }).catch(() => null);
  if (raw === null) return null;
  return new URLSearchParams(raw);
}
