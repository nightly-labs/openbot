import { describe, expect, it } from "vitest";
import {
  type CustomMcpDraft,
  customMcpValue,
  emptyCustomMcpDraft,
  hasCustomMcpError,
  validateCustomMcp,
} from "./custom-mcp-form";

function draft(overrides: Partial<CustomMcpDraft> = {}): CustomMcpDraft {
  return {
    ...emptyCustomMcpDraft(),
    serverId: "notes",
    displayName: "Notes",
    command: "npx",
    argsText: "-y\n@example/notes",
    ...overrides,
  };
}

describe("validateCustomMcp", () => {
  it("accepts a local command with no env", () => {
    expect(hasCustomMcpError(validateCustomMcp(draft()))).toBe(false);
  });

  it("refuses OpenBot's own MCP ids", () => {
    expect(validateCustomMcp(draft({ serverId: "openbot" })).serverId).toContain("openbot");
    expect(validateCustomMcp(draft({ serverId: "openbot_browser" })).serverId).toBeTruthy();
  });

  it("refuses a URL that carries a credential", () => {
    const errors = validateCustomMcp(draft({ transport: "http", url: "https://user:password@mcp.example.com/mcp" }));
    expect(errors.url).toBe("Put the credential in a header, not in the URL.");
  });

  it("builds a stdio payload with one argument per line", () => {
    expect(customMcpValue(draft())).toEqual({
      id: "notes",
      name: "Notes",
      transport: "stdio",
      command: "npx",
      args: ["-y", "@example/notes"],
      env: [],
    });
  });
});
