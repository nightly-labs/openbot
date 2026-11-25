### Fixed

- A Gemini agent now answers when an app connected to it has a tool that Google refuses because a field has a list of values but no type. OpenBot leaves that app out of the chat and says which tool caused it. Before, each message failed with "Gemini stopped because of an error" or with Google's technical error text.
