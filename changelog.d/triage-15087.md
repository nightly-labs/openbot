### Fixed

- On macOS, a Kimi agent with "Workspace only" access now runs its commands, its file changes in the workspace and its OpenBot tools without an approval card, as other sandboxed agents do. Before, each of these actions waited for "Allow". At "Ask first", a Kimi approval card now shows "Run a command" with the command, or "Change files" with the file, instead of "Grant permissions".
