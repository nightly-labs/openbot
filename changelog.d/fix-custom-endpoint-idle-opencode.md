### Fixed

- A new custom endpoint now shows its models in the model picker when no agent uses OpenCode or Pi.
  Before, OpenBot stopped the idle provider and did not start it again after the save, so the
  picker showed the endpoint with no models until OpenBot restarted.
