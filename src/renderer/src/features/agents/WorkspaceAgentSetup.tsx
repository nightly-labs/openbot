import { createSignal, Show } from "solid-js";
import { useServers } from "../servers/servers-context";
import { useAgentActions } from "./agent-actions";
import { useAgents } from "./agents-context";
import { FIRST_AGENT_SUGGESTIONS, FirstAgentSetup } from "./FirstAgentSetup";
import { WorkspaceProfileSetup } from "./WorkspaceProfileSetup";

/**
 * The create-an-agent form, which takes over the conversation pane instead of
 * opening over it. `mode` is derived from the agent list rather than passed in
 * because the first agent and the fifth are the same command with different copy.
 */
export function WorkspaceAgentSetup() {
  const { agentList, agentSetupDraft, setAgentSetupDraft, agentSetupError, creatingAgent, cancelAgentSetup } =
    useAgents();
  const [profileServer, setProfileServer] = createSignal<string | null>(null);
  const { activeServerId, activeServerSupportsCapability } = useServers();
  const { createAgent } = useAgentActions();

  return (
    <>
      <Show when={profileServer() === activeServerId()}>
        <WorkspaceProfileSetup onClose={() => setProfileServer(null)} />
      </Show>
      <FirstAgentSetup
        value={agentSetupDraft()}
        suggestions={FIRST_AGENT_SUGGESTIONS}
        mode={agentList().length === 0 ? "first" : "additional"}
        submitting={creatingAgent()}
        error={agentSetupError()}
        onChange={setAgentSetupDraft}
        onSubmit={createAgent}
        onGenerateProfile={
          activeServerSupportsCapability("agent-profile-generation")
            ? () => setProfileServer(activeServerId())
            : undefined
        }
        onCancel={agentList().length > 0 ? cancelAgentSetup : undefined}
      />
    </>
  );
}
