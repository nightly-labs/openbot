### Fixed

- When an agent passed parts of a teammate's request on to other agents, the teammate that asked got the agent's waiting note as the answer, and never got the real result. Now the answer comes after the other agents reply. When that later work fails, the teammate gets the failure note.
- When a teammate ended its turn with no answer, the agent that asked waited without end. Now it gets a note that the teammate gave no answer.
