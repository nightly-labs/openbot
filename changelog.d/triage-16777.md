### Fixed

- Agents that use Pi, OpenRouter, DeepSeek, Inception or a custom model service no longer show "[redacted]" in place of normal words in their replies. Before, a short password or API key in the Vault that was part of a word hid the full word. A saved password or key that stands alone as a word is still hidden. When you delete an item from the Vault, OpenBot also stops hiding its value at once, with no restart. On a joined server, the server must also be on this version.
