### Fixed

- An agent that says it will do a task now does the task. Before, when the agent answered with
  words only, for example "I'll research the options now" or "Vou pesquisar isso agora", the
  request sometimes ended there, and you had to write "continue". Now OpenBot checks if the request
  is done and lets the agent continue. A short closing such as "Let me know if you need anything"
  still ends the request.
