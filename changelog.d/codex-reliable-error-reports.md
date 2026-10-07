### Added

- Report safe provider failure causes and error/warning notifications to OpenPanel, including invalid upload requests from ChatGPT and OpenCode.
- Keep bounded local error queues and retry delivery after network failures or restarts. Tracking changes clear pending reports.
- Add a separate analytics setting for the browser app. Error reports exclude messages, prompts, paths, and raw exception text.
