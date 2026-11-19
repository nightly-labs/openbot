### Fixed

- When an agent writes first to an allowed WhatsApp contact, also in a routine run, the contact's
  reply now gets an answer. Without the WhatsApp Orchestrator, the reply goes to the agent that wrote.
  Before, OpenBot only saved it. With the orchestrator, the orchestrator sees which agent wrote first.
