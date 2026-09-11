import { describe, expect, it } from "vitest";
import { parseSaveCustomMcp } from "./custom-mcp-inputs";

describe("parseSaveCustomMcp", () => {
  it("accepts a local command", () => {
    expect(
      parseSaveCustomMcp({
        id: "notes",
        name: "Notes",
        transport: "stdio",
        command: "npx",
        args: ["-y", "@example/notes"],
        env: [{ name: "NOTES_TOKEN", value: "secret" }],
      }),
    ).toEqual({
      id: "notes",
      name: "Notes",
      transport: "stdio",
      command: "npx",
      args: ["-y", "@example/notes"],
      env: [{ name: "NOTES_TOKEN", value: "secret" }],
    });
  });

  it("refuses OpenBot's own MCP ids and a credential in the URL", () => {
    expect(() =>
      parseSaveCustomMcp({ id: "openbot", name: "OpenBot", transport: "stdio", command: "npx", args: [], env: [] }),
    ).toThrow("OpenBot server");
    expect(() =>
      parseSaveCustomMcp({
        id: "linear",
        name: "Linear",
        transport: "http",
        url: "https://user:token@mcp.linear.app/mcp",
        headers: [],
      }),
    ).toThrow("username or password");
  });
});
