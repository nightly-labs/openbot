### Fixed

- A WhatsApp group message that a newly linked number could not read at first is no longer lost.
  WhatsApp sends such a message again, and OpenBot now saves it in the group history and gives a
  mention to the WhatsApp Orchestrator. Before, OpenBot dropped the second copy as a duplicate, so
  the group history stayed empty.
