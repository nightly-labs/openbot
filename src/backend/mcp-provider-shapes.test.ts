import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import type { McpServerConfig } from "@openbot/contracts/ipc";
import { afterEach, describe, expect, it } from "vitest";
import {
  acpMcpServers,
  appendToolRuntimes,
  claudeMcpServers,
  clearMcpCommandCache,
  codexMcpServers,
  mcpLaunchEnvironment,
  pickWindowsExecutable,
  resolveMcpCommand,
  type UsableMcpServer,
  usableMcpServer,
} from "./mcp-provider-shapes";

function config(overrides: Partial<McpServerConfig>): McpServerConfig {
  return {
    id: "mcp-1",
    name: "posthog",
    transport: "http",
    enabled: true,
    command: "",
    args: [],
    env: [],
    envPassthrough: [],
    workingDirectory: "",
    url: "https://mcp.posthog.com/mcp",
    headers: [{ key: "Authorization", value: "Bearer test-key" }],
    ...overrides,
  };
}

function usable(overrides: Partial<McpServerConfig> = {}, authorization: string | null = null): UsableMcpServer {
  return { config: config(overrides), command: "", workingDirectory: "", path: null, authorization };
}

const failed: UsableMcpServer = {
  config: config({ name: "broken" }),
  error: "Command not found: npx",
  reason: "command_not_found",
};

function rooted(): UsableMcpServer {
  return {
    config: config({
      id: "mcp-3",
      name: "rooted",
      transport: "stdio",
      command: "server",
      url: "",
      headers: [],
      workingDirectory: "~/data",
    }),
    command: "/bin/server",
    workingDirectory: "/Users/test/data",
    path: null,
    authorization: null,
  };
}

describe("codexMcpServers", () => {
  it("sends an http server as url with http_headers", () => {
    expect(codexMcpServers([usable()]).servers).toEqual({
      posthog: {
        url: "https://mcp.posthog.com/mcp",
        http_headers: { Authorization: "Bearer test-key" },
      },
    });
  });

  it("keeps sending a stdio server as command, args and env", () => {
    const server: UsableMcpServer = {
      config: config({
        id: "mcp-2",
        name: "Filesystem",
        transport: "stdio",
        command: "server",
        args: ["--fast"],
        url: "",
        headers: [],
      }),
      command: "/bin/server",
      workingDirectory: "",
      path: null,
      authorization: null,
    };
    expect(codexMcpServers([server]).servers).toEqual({
      Filesystem: { command: "/bin/server", args: ["--fast"], env: {} },
    });
  });

  it("reports the servers it leaves out instead of dropping them silently", () => {
    const handoff = codexMcpServers([failed, rooted(), usable()]);
    expect(handoff.servers).toEqual({
      posthog: {
        url: "https://mcp.posthog.com/mcp",
        http_headers: { Authorization: "Bearer test-key" },
      },
    });
    expect(handoff.dropped).toEqual([
      { name: "broken", reason: "command_not_found", detail: "Command not found: npx" },
      {
        name: "rooted",
        reason: "working_directory_unsupported",
        detail: "This provider cannot start a server in a working directory.",
      },
    ]);
  });
});

describe("claudeMcpServers and acpMcpServers", () => {
  it("both keep carrying the http server with its headers", () => {
    expect(claudeMcpServers([usable()]).servers).toEqual({
      posthog: {
        type: "http",
        url: "https://mcp.posthog.com/mcp",
        headers: { Authorization: "Bearer test-key" },
      },
    });
    expect(acpMcpServers([usable()]).servers).toEqual([
      {
        type: "http",
        name: "posthog",
        url: "https://mcp.posthog.com/mcp",
        headers: [{ name: "Authorization", value: "Bearer test-key" }],
      },
    ]);
  });

  it("acp reports a stdio server it cannot start in a working directory", () => {
    const handoff = acpMcpServers([rooted(), usable()]);
    expect(handoff.servers).toHaveLength(1);
    expect(handoff.dropped).toEqual([
      {
        name: "rooted",
        reason: "working_directory_unsupported",
        detail: "This provider cannot start a server in a working directory.",
      },
    ]);
  });

  it("claude carries a working directory as cwd and reports no drop for it", () => {
    const handoff = claudeMcpServers([rooted()]);
    expect(handoff.servers.rooted).toMatchObject({ type: "stdio", cwd: "/Users/test/data" });
    expect(handoff.dropped).toEqual([]);
  });

  it("all three add the sign-in OpenBot holds as a bearer header", () => {
    const signedIn = usable({ headers: [] }, "access-token-abc");
    expect(codexMcpServers([signedIn]).servers).toMatchObject({
      posthog: { http_headers: { Authorization: "Bearer access-token-abc" } },
    });
    expect(claudeMcpServers([signedIn]).servers).toMatchObject({
      posthog: { headers: { Authorization: "Bearer access-token-abc" } },
    });
    expect(acpMcpServers([signedIn]).servers[0]).toMatchObject({
      headers: [{ name: "Authorization", value: "Bearer access-token-abc" }],
    });
  });

  /* The user typed that header into the panel, so it is the account they meant to use. A token
     OpenBot minted for the same address must not replace it without saying anything. */
  it("leaves a header the user wrote alone", () => {
    const signedIn = usable({ headers: [{ key: "authorization", value: "Bearer typed-by-hand" }] }, "access-token-abc");
    expect(claudeMcpServers([signedIn]).servers).toMatchObject({
      posthog: { headers: { authorization: "Bearer typed-by-hand" } },
    });
    expect(JSON.stringify(claudeMcpServers([signedIn]).servers)).not.toContain("access-token-abc");
  });

  it("both report a server that could not be resolved", () => {
    const expected = [{ name: "broken", reason: "command_not_found", detail: "Command not found: npx" }];
    expect(claudeMcpServers([failed]).dropped).toEqual(expected);
    expect(acpMcpServers([failed]).dropped).toEqual(expected);
  });
});

describe("mcpLaunchEnvironment", () => {
  it("launches with the PATH the command was looked up in", () => {
    // The lookup appends the managed directories to the configured PATH. The launch used to
    // spread the configured pairs last and lose them, so a server reaching the managed runtime
    // through its command could not find that runtime from its own `PATH`.
    const server: UsableMcpServer = {
      config: config({
        transport: "stdio",
        command: "bun",
        args: ["server.js"],
        url: "",
        headers: [],
        env: [{ key: "PATH", value: "/usr/bin:/bin" }],
      }),
      command: "/managed/bin/bun",
      workingDirectory: "",
      path: "/usr/bin:/bin:/managed/bin",
      authorization: null,
    };
    expect(mcpLaunchEnvironment(server)).toMatchObject({ PATH: "/usr/bin:/bin:/managed/bin" });
  });

  it("keeps a configured PATH when the lookup answered nothing", () => {
    const server: UsableMcpServer = {
      config: config({
        transport: "stdio",
        command: "server",
        url: "",
        headers: [],
        env: [{ key: "PATH", value: "/usr/bin:/bin" }],
      }),
      command: "",
      workingDirectory: "",
      path: null,
      authorization: null,
    };
    expect(mcpLaunchEnvironment(server)).toMatchObject({ PATH: "/usr/bin:/bin" });
  });
});

describe("pickWindowsExecutable", () => {
  it("prefers a result Windows can spawn over the extensionless shell script beside it", () => {
    const stdout = "C:\\Program Files\\nodejs\\npx\r\nC:\\Program Files\\nodejs\\npx.cmd\r\n";
    expect(pickWindowsExecutable(stdout, ".COM;.EXE;.BAT;.CMD")).toBe("C:\\Program Files\\nodejs\\npx.cmd");
  });

  it("ignores an extension this machine does not run", () => {
    const stdout = "C:\\tools\\thing.ps1\r\nC:\\tools\\thing.exe";
    expect(pickWindowsExecutable(stdout, ".COM;.EXE")).toBe("C:\\tools\\thing.exe");
  });

  it("keeps the order where.exe gave, because that order is the user's own PATH", () => {
    const stdout = "C:\\first\\thing.exe\r\nC:\\second\\thing.exe";
    expect(pickWindowsExecutable(stdout, ".EXE")).toBe("C:\\first\\thing.exe");
  });

  it("answers with the first line when no line matches, so an odd program still starts", () => {
    expect(pickWindowsExecutable("C:\\tools\\thing\r\n", ".EXE")).toBe("C:\\tools\\thing");
  });

  it("falls back to the system default when PATHEXT is unset", () => {
    expect(pickWindowsExecutable("C:\\n\\npx\r\nC:\\n\\npx.cmd", undefined)).toBe("C:\\n\\npx.cmd");
  });

  it("does not read a dot in a directory name as an extension", () => {
    expect(pickWindowsExecutable("C:\\my.tools\\thing\r\nC:\\my.tools\\thing.exe", ".EXE")).toBe(
      "C:\\my.tools\\thing.exe",
    );
  });

  it("has nothing to answer with when where.exe found nothing", () => {
    expect(pickWindowsExecutable("\r\n  \r\n", ".EXE")).toBeNull();
  });
});

describe("resolveMcpCommand", () => {
  afterEach(() => {
    clearMcpCommandCache();
  });

  it.runIf(process.platform !== "win32")("resolves a command once and reuses the answer", async () => {
    const directory = await mkdtemp(join(tmpdir(), "openbot-mcp-command-"));
    const executable = join(directory, "openbot-fake-server");
    try {
      await writeFile(executable, "#!/bin/sh\nexit 0\n");
      await chmod(executable, 0o755);
      expect(await resolveMcpCommand("openbot-fake-server", directory)).toBe(executable);

      // The login shell is what costs the time, so the second answer has to come from memory. A
      // deleted file proves it did: a fresh lookup would find nothing.
      await rm(executable);
      expect(await resolveMcpCommand("openbot-fake-server", directory)).toBe(executable);

      clearMcpCommandCache();
      expect(await resolveMcpCommand("openbot-fake-server", directory)).toBeNull();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it.runIf(process.platform !== "win32")("does not remember that a command was missing", async () => {
    const directory = await mkdtemp(join(tmpdir(), "openbot-mcp-command-"));
    const executable = join(directory, "openbot-late-server");
    try {
      expect(await resolveMcpCommand("openbot-late-server", directory)).toBeNull();

      // Installing the missing tool has to be enough. Remembering the miss would make a restart
      // the only way to be believed.
      await writeFile(executable, "#!/bin/sh\nexit 0\n");
      await chmod(executable, 0o755);
      expect(await resolveMcpCommand("openbot-late-server", directory)).toBe(executable);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("takes a path the user wrote as written, without a lookup", async () => {
    expect(await resolveMcpCommand("/usr/local/bin/server")).toBe("/usr/local/bin/server");
    expect(await resolveMcpCommand("  ")).toBeNull();
  });
});

describe("appendToolRuntimes", () => {
  it("keeps the inherited PATH when there is no login shell to ask", () => {
    // Windows always arrives here with `null`: `loginShellPath` has no equivalent there. Naming the
    // managed directory turns the value into the whole search path, so an inherited `PATH` left out
    // of it is gone - with it the user's own `npx`, `python` and `uvx`.
    const inherited = process.env.PATH ?? "";
    expect(appendToolRuntimes(null, ["/managed/bin"])).toBe(
      [...inherited.split(delimiter).filter((entry) => entry.length > 0), "/managed/bin"].join(delimiter),
    );
    expect(appendToolRuntimes(null, [])).toBeNull();
  });
});

describe("usableMcpServer with a managed tool runtime", () => {
  afterEach(() => {
    clearMcpCommandCache();
  });

  it.runIf(process.platform !== "win32")("lends a program only where the machine has none", async () => {
    const own = await mkdtemp(join(tmpdir(), "openbot-mcp-own-"));
    const managed = await mkdtemp(join(tmpdir(), "openbot-mcp-managed-"));
    try {
      for (const directory of [own, managed]) {
        await writeFile(join(directory, "openbot-fake-npx"), "#!/bin/sh\nexit 0\n");
        await chmod(join(directory, "openbot-fake-npx"), 0o755);
      }
      const tools = {
        binDirectories: [managed],
        commandAliases: { "openbot-absent-npx": join(managed, "bunx") },
      };
      const stdio = (command: string) =>
        config({ transport: "stdio", command, url: "", headers: [], env: [{ key: "PATH", value: own }] });

      // Last on `PATH`, so the build the user installed is the one that starts. This is the whole
      // mitigation for shipping a runtime: no machine that works today starts a different program.
      const installed = await usableMcpServer(stdio("openbot-fake-npx"), tools);
      expect(installed.command).toBe(join(own, "openbot-fake-npx"));
      expect(installed.path).toBe(`${own}${delimiter}${managed}`);

      // And an alias is read only after that whole list found nothing, which is the clean machine.
      const lent = await usableMcpServer(stdio("openbot-absent-npx"), tools);
      expect(lent.command).toBe(join(managed, "bunx"));
    } finally {
      await rm(own, { recursive: true, force: true });
      await rm(managed, { recursive: true, force: true });
    }
  });
});
