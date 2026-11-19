import { type McpServerConfig, mcpSignInEvent } from "@openbot/contracts/ipc";
import { createEffect, createMemo, createSignal } from "solid-js";
import { serverCanManageMcp } from "../../servers/server-capabilities";
import { conversationRuntime } from "../conversation-runtime";
import type { ConversationProps } from "../conversation-types";

export interface McpServersStoreDeps {
  props: ConversationProps;
}

export function createMcpServersStore(deps: McpServersStoreDeps) {
  const [mcpServers, setMcpServers] = createSignal<McpServerConfig[]>([]);
  let request = 0;
  const signInCardList = createMemo(() => {
    const threads = deps.props.threads;
    const threadMessages = [
      threads?.conversation,
      ...(threads?.side.tabs ?? []).map((tab) => threads?.side.thread(tab.id)?.conversation),
    ].flatMap((conversation) => conversation?.messages ?? []);
    return [
      ...deps.props.messages.flatMap((message) =>
        message.actionMarker?.kind === "mcp-sign-in"
          ? [{ messageId: message.id, mcpServerId: message.actionMarker.mcpServerId }]
          : [],
      ),
      ...threadMessages.flatMap((message) => {
        const signIn = mcpSignInEvent(message);
        return signIn ? [{ messageId: message.id, mcpServerId: signIn.mcpServerId }] : [];
      }),
    ];
  });
  const signInCardMessages = createMemo(() =>
    [...new Set(signInCardList().map((card) => card.messageId))].sort().join(","),
  );
  createEffect(
    () => [signInCardMessages(), deps.props.refreshMcpSignIns] as const,
    ([key, refresh]) => {
      if (key) refresh?.();
    },
  );
  const source = createMemo(() => {
    const server = deps.props.server;
    const supported = server?.kind !== "remote" || serverCanManageMcp(server);
    return `${server?.id ?? ""}\0${server?.connectionSequence ?? 0}\0${supported ? "supported" : "unsupported"}\0${deps.props.mcpSettingsOpen === true}\0${signInCardMessages()}`;
  });
  createEffect(source, (key) => {
    const current = ++request;
    const [serverId, , support] = key.split("\0");
    if (!serverId || support === "unsupported") {
      setMcpServers([]);
      return;
    }
    void conversationRuntime(deps.props)
      .agent.listMcpServers(serverId)
      .then((servers) => {
        if (current === request) setMcpServers(servers);
      })
      .catch(() => {});
  });

  return { mcpServers };
}
