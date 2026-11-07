### Fixed

- An agent that answers a teammate's request with an unknown message ID now gets an error and can send the answer again. Before, the answer went to the teammate's main chat, not to the side thread that asked, and that side thread waited for an answer that never came.
