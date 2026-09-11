import type { CustomMcpDesktopApi, CustomMcpSummary, SaveCustomMcpInput } from "@openbot/contracts/ipc";
import { createStore } from "solid-js";

interface CustomMcpState {
  servers: CustomMcpSummary[];
  loaded: boolean;
  fullAccess: boolean;
}

export function createCustomMcpStore(api: () => CustomMcpDesktopApi | undefined) {
  const [state, setState] = createStore<CustomMcpState>({ servers: [], loaded: false, fullAccess: false });

  function apply(servers: CustomMcpSummary[]): void {
    setState((current) => {
      current.servers = servers;
      current.loaded = true;
    });
  }

  function customMcpServers(): CustomMcpSummary[] {
    return state.servers;
  }

  function mcpFullAccess(): boolean {
    return state.fullAccess;
  }

  async function refreshCustomMcp(): Promise<void> {
    const group = api();
    if (!group) return;
    const [servers, access] = await Promise.all([group.list(), group.getFullAccess()]);
    apply(servers);
    setState((current) => {
      current.fullAccess = access.enabled;
    });
  }

  async function setMcpFullAccess(enabled: boolean): Promise<void> {
    const group = api();
    if (!group) throw new Error("This build cannot change MCP access.");
    const access = await group.setFullAccess({ enabled });
    setState((current) => {
      current.fullAccess = access.enabled;
    });
  }

  async function saveCustomMcp(input: SaveCustomMcpInput): Promise<void> {
    const group = api();
    if (!group) throw new Error("This build cannot save an MCP server.");
    apply((await group.save(input)).servers);
  }

  async function deleteCustomMcp(id: string): Promise<void> {
    const group = api();
    if (!group) throw new Error("This build cannot remove an MCP server.");
    apply((await group.delete({ id })).servers);
  }

  return { customMcpServers, mcpFullAccess, refreshCustomMcp, saveCustomMcp, deleteCustomMcp, setMcpFullAccess };
}

export type CustomMcpStore = ReturnType<typeof createCustomMcpStore>;
