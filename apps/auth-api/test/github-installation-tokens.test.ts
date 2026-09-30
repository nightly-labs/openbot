import { exportPKCS8, generateKeyPair, jwtVerify } from "jose";
import { beforeAll, describe, expect, it } from "vitest";
import {
  type GitHubFetch,
  GitHubInstallationTokens,
  GitHubInstallationTokensError,
} from "../src/server/github-installation-tokens";

const CLIENT_ID = "Iv23test";
const APP_ID = 7;
const USER_TOKEN = "ghu_user-token-under-test";

let privateKey: string;
let publicKey: CryptoKey;

beforeAll(async () => {
  const pair = await generateKeyPair("RS256", { extractable: true });
  privateKey = await exportPKCS8(pair.privateKey);
  publicKey = pair.publicKey;
});

interface Call {
  method: string;
  path: string;
  authorization: string;
  body: unknown;
}

/** GitHub with one installation of this app, one of another app, and a user who can push to one repository of two. */
function fakeGitHub(overrides: Record<string, Response> = {}): { fetch: GitHubFetch; calls: Call[] } {
  const calls: Call[] = [];
  const answers: Record<string, () => Response> = {
    "GET /app": () => Response.json({ id: APP_ID }),
    "GET /user/installations": () =>
      Response.json({
        installations: [
          { id: 1, app_id: APP_ID, account: { login: "acme" } },
          { id: 2, app_id: 99, account: { login: "other-app" } },
        ],
      }),
    "GET /user/installations/1/repositories": () =>
      Response.json({
        total_count: 2,
        repositories: [
          { id: 10, full_name: "acme/write", permissions: { pull: true, push: true } },
          { id: 11, full_name: "acme/read", permissions: { pull: true, push: false } },
        ],
      }),
    "POST /app/installations/1/access_tokens": () =>
      Response.json({ token: "ghs_installation", expires_at: "2026-09-29T18:00:00Z" }, { status: 201 }),
  };
  return {
    calls,
    fetch: async (input, init) => {
      const url = new URL(input);
      const key = `${init.method} ${url.pathname}`;
      const headers = new Headers(init.headers);
      calls.push({
        method: init.method ?? "GET",
        path: url.pathname,
        authorization: headers.get("Authorization") ?? "",
        body: typeof init.body === "string" ? JSON.parse(init.body) : null,
      });
      const override = overrides[key];
      if (override) return override;
      const answer = answers[key];
      return answer ? answer() : new Response("Not Found", { status: 404 });
    },
  };
}

function service(fetch: GitHubFetch): GitHubInstallationTokens {
  return new GitHubInstallationTokens({ clientId: CLIENT_ID, privateKey, fetch });
}

describe("GitHub installation tokens", () => {
  it("gives a token for this app's installation, limited to the repositories where the user can push", async () => {
    const github = fakeGitHub();

    const tokens = await service(github.fetch).issue(USER_TOKEN);

    expect(tokens).toEqual([
      {
        installationId: 1,
        account: "acme",
        token: "ghs_installation",
        expiresAt: "2026-09-29T18:00:00Z",
        repositories: ["acme/write"],
      },
    ]);
    const mint = github.calls.find((call) => call.method === "POST");
    expect(mint?.body).toEqual({ repository_ids: [10] });
    const jwt = mint?.authorization.replace(/^Bearer /u, "") ?? "";
    const verified = await jwtVerify(jwt, publicKey, { issuer: CLIENT_ID, algorithms: ["RS256"] });
    expect(verified.payload.iss).toBe(CLIENT_ID);
    // The installation of another app is never read or minted.
    expect(github.calls.some((call) => call.path.includes("/installations/2"))).toBe(false);
    // The user token goes only to the user endpoints, never to the app endpoints.
    for (const call of github.calls) {
      expect(call.authorization === `token ${USER_TOKEN}`).toBe(call.path.startsWith("/user"));
    }
  });

  it("mints nothing for a user who can push to no repository", async () => {
    const github = fakeGitHub({
      "GET /user/installations/1/repositories": Response.json({
        total_count: 1,
        repositories: [{ id: 11, full_name: "acme/read", permissions: { pull: true, push: false } }],
      }),
    });

    await expect(service(github.fetch).issue(USER_TOKEN)).resolves.toEqual([]);
    expect(github.calls.some((call) => call.method === "POST")).toBe(false);
  });

  it("refuses a user token that GitHub refuses, and does not echo it", async () => {
    const github = fakeGitHub({ "GET /user/installations": new Response("Bad credentials", { status: 401 }) });

    const error = await service(github.fetch)
      .issue(USER_TOKEN)
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(GitHubInstallationTokensError);
    expect(error).toMatchObject({ status: 401, code: "github_unauthorized" });
    expect(error instanceof Error ? error.message : "").not.toContain(USER_TOKEN);
    expect(github.calls.some((call) => call.method === "POST")).toBe(false);
  });

  it("reports a key that is not PKCS #8 as an unavailable app", async () => {
    const github = fakeGitHub();
    const tokens = new GitHubInstallationTokens({
      clientId: CLIENT_ID,
      privateKey: "-----BEGIN RSA PRIVATE KEY-----\nnot-a-key\n-----END RSA PRIVATE KEY-----",
      fetch: github.fetch,
    });

    await expect(tokens.issue(USER_TOKEN)).rejects.toMatchObject({ status: 503, code: "github_app_unavailable" });
    expect(github.calls).toEqual([]);
  });
});
