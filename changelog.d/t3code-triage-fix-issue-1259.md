### Added

- OpenBot writes provider diagnostics to `logs/providers/providers.log` in its data folder: state changes, CLI checks, start times, model list results and provider errors. OpenBot removes credentials from each line, and does not write environment values, tool output or conversation text to the file.
- The provider settings show the last error of each provider until the provider lists its models again, with a "Copy diagnostics" action.

### Changed

- "The selected agent model is unavailable." now gives the cause: the provider is not connected, the provider listed no models (with its last error), or the provider does not list that model.
