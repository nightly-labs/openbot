### Changed

- An agent in a workflow step that asks for answer fields now gives its answer with the `workflow_answer` tool. OpenBot checks the answer at once and tells the agent what to correct, so the agent can fix it in the same turn. An agent that does not call the tool still ends its reply with the JSON object, as before.
