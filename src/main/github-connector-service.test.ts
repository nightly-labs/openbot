import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { runCauseEffect } from "../backend/effect-boundary";
import { GitHubConnectorService } from "./github-connector-service";
import { GitHubConnectorStore } from "./github-connector-store";

afterEach(() => vi.useRealTimers());

// Failure modes: a completed sign-in survives disconnect on disk; a late canceled token becomes
// the stored sign-in. Both can expose account credentials to agents after the user disconnected.
for (const cancel of [false, true]) {
  it(
    cancel ? "does not persist a late token after cancellation" : "removes stored and tool credentials on disconnect",
    async () => {
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
      const directory = await mkdtemp(join(tmpdir(), "openbot-github-effect-"));
      const path = join(directory, "account.json");
      const tools = join(directory, "tools");
      const store = new GitHubConnectorStore(path, {
        encrypt: (value) => Buffer.from(value),
        decrypt: (value) => value.toString(),
      });
      const token = deferred<Response>();
      const arrived = deferred<void>();
      const connected = deferred<void>();
      const service = new GitHubConnectorService({
        app: { clientId: "test-client", slug: "test-app" },
        store,
        toolDirectory: tools,
        apiUrl: "https://account.example",
        openExternal: () => Promise.resolve(),
        fetch: (url) => {
          if (url.endsWith("/device/code"))
            return Promise.resolve(
              Response.json({
                device_code: "device",
                user_code: "ABCD-EFGH",
                verification_uri: "https://github.com/login/device",
                expires_in: 600,
                interval: 1,
              }),
            );
          if (url.endsWith("/oauth/access_token")) {
            arrived.resolve();
            return token.promise;
          }
          if (url === "https://api.github.com/user") return Promise.resolve(Response.json({ login: "octocat", id: 1 }));
          if (url.endsWith("/installation-tokens")) return Promise.resolve(new Response(null, { status: 503 }));
          return Promise.reject(new Error("Unexpected request"));
        },
      });
      service.onChanged((status) => {
        if (status.state === "connected") connected.resolve();
      });
      try {
        await runCauseEffect(service.connect());
        await vi.advanceTimersByTimeAsync(1_000);
        await arrived.promise;
        if (cancel) service.cancel();
        token.resolve(
          Response.json({ access_token: "test-access-token", expires_in: 3600, refresh_token: "test-refresh-token" }),
        );
        if (!cancel) {
          await connected.promise;
          expect(await readFile(join(tools, "token"), "utf8")).toBe("test-access-token");
          expect(store.read()?.accessToken).toBe("test-access-token");
          await runCauseEffect(service.disconnect());
        }
        await runCauseEffect(service.dispose());
        expect(store.read()).toBeNull();
        await expect(readFile(path)).rejects.toMatchObject({ code: "ENOENT" });
        await expect(readFile(join(tools, "token"))).rejects.toMatchObject({ code: "ENOENT" });
      } finally {
        token.resolve(new Response(null, { status: 500 }));
        await runCauseEffect(service.dispose());
        await rm(directory, { recursive: true, force: true });
      }
    },
  );
}

function deferred<A>() {
  let resolve: (value: A) => void = () => undefined;
  const promise = new Promise<A>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}
