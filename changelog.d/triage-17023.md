### Fixed

- A workflow agent or model step no longer fails when a list answer field has no items. An empty list, such as no failed jobs, now completes the step, and a check such as `not issues` takes the yes branch.
- A workflow agent step now accepts an answer that the agent wrote in the answer tool's form, `{"answer": {…}}`, when it could not use the tool.
- When a required text field of a step answer is empty, the correction that OpenBot sends to the agent now says that the field is empty, not missing.
