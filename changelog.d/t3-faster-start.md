### Fixed

- OpenBot starts faster, most of all on Windows: it reads its settings files together, it copies its skills to the agents together, and it no longer waits for the removal of old provider CLI versions before the window shows.
- A slow computer stays usable after OpenBot starts. OpenBot started all provider CLIs in the same second. Now it starts the provider of your chats first, so chat is ready sooner, and then the others two at a time.
- OpenBot no longer writes its skill files again at each start when they did not change. An antivirus program does not scan them again, and a provider does not load them again.
