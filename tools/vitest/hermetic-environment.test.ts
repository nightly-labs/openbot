import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isolateTestEnvironment } from "./hermetic-environment";

describe("isolateTestEnvironment", () => {
  it("removes inherited credentials and real directories", () => {
    const env: NodeJS.ProcessEnv = {
      OPENAI_API_KEY: "sk-planted",
      ANTHROPIC_BASE_URL: "https://api.anthropic.com",
      GITHUB_TOKEN: "ghp_planted",
      CODEX_HOME: "/Users/someone/.codex",
      ELECTRON_RUN_AS_NODE: "1",
      GITHUB_ACTIONS: "true",
      PATH: "/usr/bin",
    };

    isolateTestEnvironment(env, "/tmp/test-home");

    expect(env).toEqual({
      GITHUB_ACTIONS: "true",
      PATH: "/usr/bin",
      HOME: "/tmp/test-home",
      USERPROFILE: "/tmp/test-home",
      TZ: "UTC",
      LANG: "C.UTF-8",
    });
  });

  it("moves the profile under HOME into a temporary directory for this file", () => {
    // The setup file ran before this test file, so a profile path built the way
    // the app builds it cannot reach the developer's real `~/OpenBot`.
    expect(join(homedir(), "OpenBot").startsWith(join(tmpdir(), "openbot-test-home-"))).toBe(true);
  });
});
