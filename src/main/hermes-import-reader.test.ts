import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vitest";
import { readHermesProfiles } from "./hermes-import-reader";
import { type HermesImportAgents, HermesImportService } from "./hermes-import-service";

// Failure modes: a value from `.env` or `auth.json`, an MCP argument, address, environment value or
// header, or a secret file inside a skill reaches the preview the renderer receives, or the profile
// data the import later writes into agents and MCP settings.
const SECRETS = [
  "sk-or-env-secret-1",
  "ghp_env_secret_2",
  "auth-json-secret-3",
  "mcp-arg-secret-4",
  "mcp-assign-secret-5",
  "mcp-env-secret-6",
  "mcp-query-secret-7",
  "mcp-header-secret-8",
  "skill-env-secret-9",
  "profile-env-secret-10",
];

async function write(path: string, text: string) {
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, text);
}

describe("Hermes import reader", () => {
  let directory = "";
  afterEach(async () => {
    if (directory) await rm(directory, { recursive: true, force: true });
  });

  it("keeps the names of secrets and never their values", async () => {
    directory = await mkdtemp(join(tmpdir(), "openbot-hermes-"));
    const root = join(directory, ".hermes");
    await write(join(root, ".env"), `OPENROUTER_API_KEY=${SECRETS[0]}\nexport GITHUB_TOKEN="${SECRETS[1]}"\n`);
    await write(join(root, "auth.json"), JSON.stringify({ access_token: SECRETS[2] }));
    await write(join(root, "SOUL.md"), "You are a careful research assistant.");
    await write(join(root, "memories", "MEMORY.md"), "The user writes in British English.\n§\nReports go to ~/notes.");
    await write(
      join(root, "config.yaml"),
      [
        "model:",
        "  provider: openrouter",
        "  default: nousresearch/hermes-4-405b",
        "mcp_servers:",
        "  tracker:",
        "    command: npx",
        `    args: ["-y", "tracker-mcp", "--token", "${SECRETS[3]}", "API_KEY=${SECRETS[4]}"]`,
        "    env:",
        `      TRACKER_TOKEN: ${SECRETS[5]}`,
        "  remote:",
        `    url: https://mcp.example.com/v1/sse?key=${SECRETS[6]}`,
        "    headers:",
        `      Authorization: Bearer ${SECRETS[7]}`,
      ].join("\n"),
    );
    await write(
      join(root, "skills", "notes", "SKILL.md"),
      "---\nname: notes\ndescription: Keeps notes.\n---\n\nWrite notes.",
    );
    await write(join(root, "skills", "leaky", "SKILL.md"), "---\nname: leaky\ndescription: Has a key file.\n---\n");
    await write(join(root, "skills", "leaky", ".env"), `KEY=${SECRETS[8]}`);
    await write(join(root, "profiles", "coder", ".env"), `CODER_KEY=${SECRETS[9]}`);
    await write(join(root, "profiles", "coder", "SOUL.md"), "You review pull requests.");

    const profiles = await Effect.runPromise(readHermesProfiles(root, "UTC"));
    const agents: HermesImportAgents = {
      listAgents: () => [],
      listMcpServers: () => [],
      createAgentProfile: () => Effect.die("unused"),
      updateAgent: () => Effect.die("unused"),
      deleteAgent: () => Effect.die("unused"),
      createRoutine: () => undefined,
      listRoutines: () => [],
      createMemory: () => undefined,
      listMemories: () => [],
      memoryLimit: () => 64,
      initializeMemorySelection: () => undefined,
      saveMcpServer: () => Effect.die("unused"),
    };
    const service = new HermesImportService(
      agents,
      {
        library: () => {
          throw new Error("unused");
        },
        installLocal: () => Effect.die("unused"),
      },
      join(directory, "links.json"),
      () => "UTC",
    );
    const preview = await Effect.runPromise(service.stage(root));

    const text = `${JSON.stringify(profiles, (_key, value) => (value instanceof Uint8Array ? new TextDecoder().decode(value) : value))}${JSON.stringify(preview)}`;
    for (const secret of SECRETS) expect(text).not.toContain(secret);

    expect(profiles?.map((profile) => profile.key)).toEqual(["default", "coder"]);
    const hermes = preview?.profiles.find((profile) => profile.key === "default");
    expect(hermes?.items.find((item) => item.id === "secrets")?.names).toEqual([
      "OPENROUTER_API_KEY",
      "GITHUB_TOKEN",
      "auth.json",
    ]);
    expect(hermes?.items.find((item) => item.id === "skipped-skill:leaky")?.reason).toBe("unsafeFile");
    const tracker = profiles?.[0]?.mcpServers.find((server) => server.name === "tracker");
    expect(tracker).toMatchObject({ enabled: false, env: [{ key: "TRACKER_TOKEN", value: "" }] });
    expect(profiles?.[0]?.mcpServers.find((server) => server.name === "remote")).toMatchObject({
      url: "https://mcp.example.com",
      headers: [{ key: "Authorization", value: "" }],
    });
  });
});
