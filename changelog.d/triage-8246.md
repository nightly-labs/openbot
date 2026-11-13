### Fixed

- A message to a Grok agent no longer waits without end when the Grok process stops answering.
  OpenBot now ends that process after 5 minutes with no output, shows "Grok did not answer in time, so
  OpenBot ended its process.", and starts Grok again for the next message. The same applies to the
  other agents that OpenBot runs over ACP.
