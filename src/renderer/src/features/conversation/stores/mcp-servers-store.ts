import { MCP_SERVERS_CAPABILITY, type McpServerConfig } from "@openbot/contracts/ipc";
import { createEffect, createMemo, createSignal } from "solid-js";
import type { ConversationProps } from "../conversation-types";

export interface McpServersStoreDeps {
  props: ConversationProps;
}

/**
 * The MCP servers the composer can tag with `$`.
 *
 * They are the host's, not the agent's: an MCP server is held by the computer that runs the agents,
 * so one list serves every conversation on that host. Nothing connects here. The list is read for
 * its names, and a tag is a hint in the prompt, so a server that cannot answer is still a server the
 * user can name.
 *
 * The list is read again when the server settings dialog or the marketplace closes, because those
 * are where a server is added or removed, and on a reconnection, because a remote host answers this
 * only while connected.
 */
export function createMcpServersStore(deps: McpServersStoreDeps) {
  const [mcpServers, setMcpServers] = createSignal<McpServerConfig[]>([]);
  let request = 0;
  const source = createMemo(() => {
    const server = deps.props.server;
    // A host that predates the capability answers 404, so it is not asked at all.
    const supported = server?.kind !== "remote" || server.compatibility?.capabilities.includes(MCP_SERVERS_CAPABILITY);
    return `${server?.id ?? ""}\0${server?.connectionSequence ?? 0}\0${supported ? "supported" : "unsupported"}\0${deps.props.mcpSettingsOpen === true}`;
  });
  createEffect(source, (key) => {
    const current = ++request;
    const [serverId, , support] = key.split("\0");
    if (!serverId || support === "unsupported") {
      setMcpServers([]);
      return;
    }
    void window.openbot.agent
      .listMcpServers(serverId)
      .then((servers) => {
        if (current === request) setMcpServers(servers);
      })
      .catch(() => {
        // Nothing waits for this list: the picker offers the skills it has, and without the servers
        // a `$` tag is one option short rather than an error over the composer.
      });
  });

  return { mcpServers };
}

export type McpServersStore = ReturnType<typeof createMcpServersStore>;
