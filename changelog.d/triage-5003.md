### Fixed

- OpenBot now tells every provider that tools are unavailable when it writes a channel summary, a title or an agent profile. Before, only Codex got this instruction. With OpenCode and other providers, a model could try a tool, for example to count the characters of a summary, and the generation failed. The channel summary then stayed at an old version.
