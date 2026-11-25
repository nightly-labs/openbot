### Fixed

- An OpenCode agent now keeps the model that you chose after OpenBot restarts or the computer wakes.
  Before, when OpenCode was slow to get its newest model list, the agent changed to an older model,
  for example from DeepSeek V4.1 Flash to DeepSeek V4 Flash, and showed no message. Grok, Mistral and
  custom agents get the same fix. An agent whose model was moved before this fix stays on the older model:
  select the model again in the agent's model picker.
