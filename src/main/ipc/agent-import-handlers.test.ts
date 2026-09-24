// @vitest-environment node

// A user who sets up the export agent in Grok Bot by hand takes the export skill from here. Main
// reads the file the app ships and writes it only where the save dialog answered, so the renderer
// names no path. The handlers register through the trusted binder, so Electron is mocked.

import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { IPC_ENDPOINTS } from "@openbot/contracts/ipc";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Invoke = (event: unknown, request?: unknown) => unknown;
const { bound, showSaveDialog } = vi.hoisted(() => ({
  bound: new Map<string, Invoke>(),
  showSaveDialog: vi.fn(),
}));
vi.mock("electron", () => ({
  app: { getPath: () => "/downloads" },
  dialog: { showSaveDialog },
  ipcMain: { handle: (channel: string, invoke: Invoke) => bound.set(channel, invoke) },
}));
const { registerIpcGroup } = await import("./define-ipc-group");
const { agentImportIpcHandlers } = await import("./agent-import-handlers");
const { AgentImportService } = await import("../agent-import-service");

const TRUSTED_EVENT = { senderFrame: { url: "openbot-app://app/index.html" } };
const SKILL = "---\nname: openbot-export\ndescription: Export agents.\n---\n";

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "openbot-agent-import-handlers-"));
  const exportSkillPath = join(root, "SKILL.md");
  await writeFile(exportSkillPath, SKILL);
  bound.clear();
  showSaveDialog.mockReset();
  const agentImport = new AgentImportService(
    {
      listAgents: () => [],
      createAgentProfile: vi.fn(),
      createRoutine: vi.fn(),
      createMemory: vi.fn(),
      setAvatar: vi.fn(),
      deleteAgent: vi.fn(),
      channels: { command: vi.fn() },
      createChannelMemory: vi.fn(),
      createChannelRoutine: vi.fn(),
      deleteChannel: vi.fn(),
    },
    { library: vi.fn(), installLocal: vi.fn() },
    () => ({ id: "local", name: "You" }),
  );
  registerIpcGroup(
    "agentImport",
    agentImportIpcHandlers({ agentImport, getMainWindow: () => null, exportSkillPath }).agentImport,
  );
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("agentImportIpcHandlers", () => {
  it("refuses a channel selection it cannot read before the import starts", async () => {
    const apply = async (payload: { channelKeys?: string[] }) =>
      bound.get(IPC_ENDPOINTS.agentImport.apply.channel)?.(TRUSTED_EVENT, {
        token: "token-1",
        keys: ["research"],
        ...payload,
      });
    await expect(apply({})).rejects.toThrow("Invalid channel selection.");
    await expect(apply({ channelKeys: ["Not A Key"] })).rejects.toThrow("Invalid channel selection.");
    await expect(apply({ channelKeys: ["desk", "desk"] })).rejects.toThrow("Invalid channel selection.");
    // A readable selection reaches the service, which finds no open export.
    await expect(apply({ channelKeys: ["desk"] })).rejects.toThrow("The export is no longer open.");
  });

  it("answers the export skill's text", async () => {
    await expect(bound.get(IPC_ENDPOINTS.agentImport.readSkill.channel)?.(TRUSTED_EVENT)).resolves.toBe(SKILL);
  });

  it("saves the export skill where the user chose, and nothing when they cancel", async () => {
    const target = join(root, "chosen.md");
    showSaveDialog.mockResolvedValueOnce({ canceled: false, filePath: target });
    await expect(bound.get(IPC_ENDPOINTS.agentImport.saveSkill.channel)?.(TRUSTED_EVENT)).resolves.toEqual({
      saved: true,
    });
    expect(await readFile(target, "utf8")).toBe(SKILL);
    expect(showSaveDialog).toHaveBeenCalledWith(expect.objectContaining({ defaultPath: "/downloads/SKILL.md" }));

    showSaveDialog.mockResolvedValueOnce({ canceled: true, filePath: "" });
    await expect(bound.get(IPC_ENDPOINTS.agentImport.saveSkill.channel)?.(TRUSTED_EVENT)).resolves.toEqual({
      saved: false,
    });
  });
});
