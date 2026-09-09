import { describe, expect, it } from "vitest";
import { userErrorMessage } from "./index";

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
