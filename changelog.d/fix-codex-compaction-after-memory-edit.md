### Fixed

- Codex chats continue after compaction when the agent saves a memory. Before, OpenBot could compact the same chat repeatedly and leave messages in the queue.
- The context indicator updates when Claude or an ACP agent finishes compacting after a memory edit. Before, it could stay on compaction in progress.
