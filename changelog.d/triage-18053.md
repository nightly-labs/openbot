### Fixed

- A Gemini agent and its routines now answer when an app connected to the agent has a tool with a pair of numbers, such as a `coordinate` field, or a list field that can also be empty. Google refuses these tool formats. OpenBot leaves that app out of the Gemini chat and says which tool caused it. When OpenBot cannot find the tool, the chat now says in plain words that Gemini cannot read a tool of one of your apps and what to do, not Google's technical error text.
