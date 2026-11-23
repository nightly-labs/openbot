### Fixed

- Git commands work again in custom agents that hide environment variables with secret-like names. Before, all git commands of these agents failed with "missing config key GIT_CONFIG_KEY_0" when GitHub was connected.
