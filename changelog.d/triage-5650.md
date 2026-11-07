### Fixed

- An agent that ends a short answer with its next work, such as "Let me run the tests." or "I'm going
  to fix the parser.", now continues by itself. Before, only a few phrases, such as "I'll now …",
  started the automatic continuation. An agent that asks "Would you like me to continue with the
  remaining files?" now also continues, also when its plan has open steps.
