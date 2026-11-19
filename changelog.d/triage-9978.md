### Fixed

- When an agent or a routine writes first to an allowed WhatsApp contact, the contact's reply now gets
  an answer. Without the WhatsApp Orchestrator, the reply goes to the agent that wrote. Before,
  OpenBot only saved it. With the orchestrator, the orchestrator sees which agent wrote first.
