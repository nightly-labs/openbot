### Added

- A task that an agent started can now report back to that agent. The task calls the new report_to_agent tool with a result, a blocker or a question. The agent receives the report in its own chat as a new turn, marked with the task and the kind. When the agent starts the task with notify, it also receives a short notice if the task ends, fails or is stopped without a report.
