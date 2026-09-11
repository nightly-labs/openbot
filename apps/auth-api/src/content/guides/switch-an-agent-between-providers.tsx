export function SwitchAnAgentBetweenProviders() {
  return (
    <>
      <p>
        Providers are good at different things and they change month to month. Moving an agent between them is a
        setting, not a migration: the agent keeps its workspace, its thread and its name.
      </p>

      <h2>Change the provider</h2>
      <p>
        Open the agent and choose another provider. The next turn runs on the new one. Nothing is copied and nothing is
        reset, because the thread was never the provider's to hold in the first place.
      </p>

      <h2>What carries across, and what does not</h2>
      <p>
        The workspace, the thread and the agent's identity carry across: they are yours and they are on your disk. The
        provider's own resume state does not. In practice that means the new provider reads the conversation rather than
        continuing a session inside it, so the first turn after a switch can be slightly slower.
      </p>

      <h2>When to switch</h2>
      <p>
        Switch when the work changes, not when an answer disappoints you. A second opinion from another model on the
        same thread is cheap and often useful; swapping provider after every poor turn just makes the thread harder to
        read later.
      </p>
    </>
  );
}
