import { request as httpRequest } from "node:http";
import { translateFor } from "@openbot/i18n";
import { describe, expect, it } from "vitest";
import { startMcpOAuthRedirectServer } from "./mcp-oauth-redirect-server";

const CODE = "grant-abc";
const STATE = "state-xyz";

interface Delivered {
  state: string;
  code: string;
}

async function withServer(
  accept: (state: string) => boolean,
  body: (redirectUrl: string, delivered: Delivered[]) => Promise<void>,
): Promise<void> {
  const delivered: Delivered[] = [];
  const server = await startMcpOAuthRedirectServer({
    language: { locale: "en", translate: translateFor("en") },
    deliver: (state, code) => {
      if (!accept(state)) return false;
      delivered.push({ state, code });
      return true;
    },
  });
  try {
    await body(server.redirectUrl, delivered);
  } finally {
    await server.close();
  }
}

describe("the MCP sign-in listener", () => {
  it("hands a returning grant to the sign-in that is waiting for it", async () => {
    await withServer(
      (state) => state === STATE,
      async (redirectUrl, delivered) => {
        expect(new URL(redirectUrl).hostname).toBe("127.0.0.1");

        const response = await fetch(`${redirectUrl}?code=${CODE}&state=${STATE}`);

        expect(response.status).toBe(200);
        expect(delivered).toEqual([{ state: STATE, code: CODE }]);
        // The grant is in the address of this page, and a page kept on disk keeps the address
        // that fetched it.
        expect(response.headers.get("cache-control")).toBe("no-store");
        // Nothing the browser shows repeats the credential it carried.
        expect(await response.text()).not.toContain(CODE);
      },
    );
  });

  it("refuses a grant no sign-in is waiting for", async () => {
    await withServer(
      () => false,
      async (redirectUrl, delivered) => {
        const response = await fetch(`${redirectUrl}?code=${CODE}&state=replayed`);

        expect(response.status).toBe(400);
        expect(delivered).toEqual([]);
      },
    );
  });

  it("refuses a request that reached this port under another name", async () => {
    await withServer(
      () => true,
      async (redirectUrl, delivered) => {
        const address = new URL(redirectUrl);
        // A page on the web can point a name it owns at this port. The browser sends that name,
        // and this is the only thing that separates it from a real redirect. `fetch` will not
        // set `Host`, so the request is made by hand.
        const status = await statusFor({
          port: address.port,
          path: `/mcp-auth?code=${CODE}&state=${STATE}`,
          host: `attacker.example.com:${address.port}`,
        });

        expect(status).toBe(403);
        expect(delivered).toEqual([]);
      },
    );
  });

  it("answers anything that is not the sign-in address with 404", async () => {
    await withServer(
      () => true,
      async (redirectUrl, delivered) => {
        const address = new URL(redirectUrl);

        const response = await fetch(`http://127.0.0.1:${address.port}/?code=${CODE}&state=${STATE}`);

        expect(response.status).toBe(404);
        expect(delivered).toEqual([]);
      },
    );
  });

  it("leaves a refused sign-in on a page that says so", async () => {
    await withServer(
      () => true,
      async (redirectUrl, delivered) => {
        const response = await fetch(`${redirectUrl}?error=access_denied&state=${STATE}`);

        expect(response.status).toBe(400);
        // The sign-in itself ends on its own deadline, in the words the dialog already has.
        expect(delivered).toEqual([]);
      },
    );
  });

  it("stops answering once it is closed", async () => {
    const server = await startMcpOAuthRedirectServer({
      language: { locale: "en", translate: translateFor("en") },
      deliver: () => true,
    });
    const { redirectUrl } = server;
    await server.close();

    await expect(fetch(`${redirectUrl}?code=${CODE}&state=${STATE}`)).rejects.toThrow();
  });
});

/** One request with a `Host` header of the test's choosing, which `fetch` refuses to send. */
function statusFor({ port, path, host }: { port: string; path: string; host: string }): Promise<number | undefined> {
  return new Promise<number | undefined>((resolve, reject) => {
    const call = httpRequest({ host: "127.0.0.1", port, path, headers: { host } }, (response) => {
      response.resume();
      response.on("end", () => resolve(response.statusCode));
    });
    call.on("error", reject);
    call.end();
  });
}
