import { describe, expect, it } from "vitest";
import { classifyUserError, userErrorMessage } from "./index";

const fallback = "Could not save your changes. Try again.";

describe("user-facing errors", () => {
  it.each([
    [
      "ENOENT: realpath '/Users/person/private.txt'",
      "A required file or folder could not be found. Restore it or choose another one, then try again.",
    ],
    [
      "EACCES: open '/home/person/private.txt'",
      "OpenBot does not have permission to complete this action. Check the file or folder permissions, then try again.",
    ],
    [
      "EPERM: operation not permitted",
      "OpenBot does not have permission to complete this action. Check the file or folder permissions, then try again.",
    ],
    [
      "ENOSPC: write failed",
      "There is not enough storage space. Free some space on the computer running OpenBot, then try again.",
    ],
    ["EROFS: open '/private/data'", "This folder is read-only. Choose a folder you can write to, then try again."],
    ["EEXIST: mkdir '/tmp/example'", "An item with this name already exists. Choose a different name, then try again."],
    ["ECONNREFUSED 127.0.0.1:1234", "Could not connect. Check your connection and try again."],
    [
      "ETIMEDOUT: request failed",
      "The request took too long. Check whether the action completed before you try again.",
    ],
    ["HTTP 429: rate limit", "Too many requests. Wait a moment, then try again."],
    ["HTTP 401: unauthorized", "Authentication failed. Check your account or server connection, then try again."],
    ["HTTP 403: forbidden", "You do not have permission to complete this action. Ask the owner for access."],
    ["HTTP 503: upstream failed", "The service is unavailable. Wait a moment, then try again."],
  ])("explains %s without exposing technical details", (message, expected) => {
    expect(userErrorMessage(new Error(`Error invoking remote method 'test:action': Error: ${message}`), fallback)).toBe(
      expected,
    );
  });

  it.each(["Failed to fetch", "fetch failed", "Network request failed", "Load failed"])("explains %s", (message) => {
    expect(userErrorMessage(new TypeError(message), fallback)).toBe(
      "Could not connect. Check your connection and try again.",
    );
  });

  it.each([
    "Choose a photo smaller than 512 KB.",
    "Stop the agent and cancel its queued messages before deleting it.",
    "Workspace file must be inside the agent workspace.",
    "Quit and reopen OpenBot, then try the update again.",
  ])("keeps specific recovery and security guidance: %s", (message) => {
    expect(userErrorMessage(new Error(`Error invoking remote method 'test:action': Error: ${message}`), fallback)).toBe(
      message,
    );
  });

  it.each([
    undefined,
    null,
    { message: "do not stringify this object" },
    new Error(""),
    new Error("SQLITE_BUSY: database is locked"),
    new Error("Command failed: secret command"),
    new Error("Error invoking remote method 'test:action': TypeError: Cannot read properties of undefined"),
    new TypeError("Cannot read properties of undefined"),
    new SyntaxError("Unexpected token in JSON"),
    new Error("Unexpected failure\n    at run (/private/app.js:10:2)"),
    new Error("Failed to open C:\\Users\\person\\private.txt"),
    new Error('{"error":"private server response"}'),
    new Error("x".repeat(401)),
  ])("uses action-specific guidance for an unknown or technical failure: %s", (error) => {
    expect(userErrorMessage(error, fallback)).toBe(fallback);
  });

  it("formats status-event messages without requiring an Error object", () => {
    expect(userErrorMessage("Error invoking remote method 'test:action': Error: Choose another image.", fallback)).toBe(
      "Choose another image.",
    );
  });

  it("unwraps nested remote errors without losing the useful message", () => {
    expect(
      userErrorMessage(
        new Error(
          "Error invoking remote method 'agent:action': Error: Error invoking remote method 'server:action': Error: Choose another image.",
        ),
        fallback,
      ),
    ).toBe("Choose another image.");
  });

  it("redacts credentials from readable server messages", () => {
    expect(userErrorMessage(new Error("Could not connect with apiKey=example-secret-value."), fallback)).toBe(
      "Could not connect with apiKey=[redacted]",
    );
  });
});

describe("provider authentication failures", () => {
  const codexRateLimit401 =
    'AppServerError: failed to fetch codex rate limits: GET https://chatgpt.com/backend-api/wham/usage failed: 401 Unauthorized; content-type=text/plain; body={ "error": { "message": "Could not parse your authentication token. Please try signing in again.", "type": null, "code": "unauthorized_unknown", "param": null }, "status": 401 }';

  it("classifies a provider 401 quoted inside a longer exchange", () => {
    expect(classifyUserError(new Error(codexRateLimit401))).toBe("auth");
  });

  it("does not show the raw exchange to the user", () => {
    const shown = userErrorMessage(new Error(codexRateLimit401), fallback);
    expect(shown).toBe("Authentication failed. Check your account or server connection, then try again.");
    expect(shown).not.toContain("chatgpt.com");
    expect(shown).not.toContain("AppServerError");
    expect(shown).not.toContain("401");
  });

  it.each([
    'body={ "code": "unauthorized_unknown" }',
    "The provider replied: Please try signing in again.",
    "Request rejected: invalid_api_key",
    "GET /v1/models failed: 401 Unauthorized",
  ])("classifies %s as an authentication failure", (message) => {
    expect(classifyUserError(new Error(message))).toBe("auth");
  });

  it("keeps a rate limit a rate limit even when its body mentions a token", () => {
    expect(classifyUserError(new Error('HTTP 429: token quota exhausted; body={ "status": 401 }'))).toBe("rate-limit");
  });

  it.each(["Listening on port 401.", "Uploaded 401 files.", "x".repeat(401)])(
    "does not read a bare 401 as an authentication failure: %s",
    (message) => {
      expect(classifyUserError(new Error(message))).toBe("unknown");
    },
  );

  it.each([
    ["ECONNREFUSED 127.0.0.1:1234", "network"],
    ["HTTP 503: upstream failed", "service"],
    ["ENOENT: realpath '/tmp/x'", "not-found"],
    ["Choose a photo smaller than 512 KB.", "unknown"],
  ] as const)("classifies %s as %s", (message, kind) => {
    expect(classifyUserError(new Error(message))).toBe(kind);
  });
});
