import { randomBytes } from "node:crypto";
import { registerSecretValue } from "@openbot/logging";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import type { WorkflowGitHubChange } from "../backend/workflows/workflow-github-api";
import type { GitHubFetch } from "./github-device-flow";
import { createGitHubRest } from "./github-rest";

const BOT_TOKEN = `ghs_${randomBytes(18).toString("hex")}`;
const USER_TOKEN = `ghu_${randomBytes(18).toString("hex")}`;
// A secret with no known token shape, as a pasted password in a comment can be.
const REGISTERED = `pass-${randomBytes(18).toString("hex")}`;

const COMMENT: WorkflowGitHubChange = {
  action: "comment",
  repository: "openbot-e2e/app",
  number: 42,
  body: "Thanks",
  title: "",
  labels: [],
  people: [],
  reason: "completed",
};

/** The failure of one comment change, over `fetch`. */
function failureOf(fetch: GitHubFetch) {
  const api = createGitHubRest({
    fetch,
    tokens: () => Effect.succeed({ user: USER_TOKEN, bot: BOT_TOKEN }),
  });
  return Effect.runPromise(Effect.flip(api.change(COMMENT)));
}

const answer = (status: number, json: string) =>
  Promise.resolve(new Response(json, { status, headers: { "Content-Type": "application/json" } }));

describe("GitHub REST failures", () => {
  it("redacts tokens and registered secrets in GitHub's own message", async () => {
    registerSecretValue(REGISTERED);
    const failure = await failureOf(() =>
      answer(422, JSON.stringify({ message: `Validation failed: ${BOT_TOKEN} ${USER_TOKEN} ${REGISTERED}` })),
    );
    expect(failure.code).toBe("invalid");
    expect(failure.message).toContain("Validation failed");
    expect(failure.message).toContain("[redacted]");
    for (const secret of [BOT_TOKEN, USER_TOKEN, REGISTERED]) expect(failure.message).not.toContain(secret);
  });

  it("keeps no part of a failed request in the step's message", async () => {
    const failure = await failureOf((_url, init) =>
      Promise.reject(new Error(`connect failed: ${new Headers(init.headers).get("Authorization")}`)),
    );
    expect(failure.code).toBe("unreachable");
    expect(failure.message).not.toContain(BOT_TOKEN);
    expect(failure.message).not.toContain("connect failed");
  });

  it("does not show a body that is not GitHub's message", async () => {
    const failure = await failureOf(() => answer(400, JSON.stringify({ errors: [{ token: BOT_TOKEN }] })));
    expect(failure.code).toBe("invalid");
    expect(failure.message).not.toContain(BOT_TOKEN);
    expect(failure.message).toContain("HTTP 400");
  });
});
