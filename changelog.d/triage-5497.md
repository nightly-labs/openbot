### Fixed

- On Windows, a Gemini (Antigravity) chat now ends its helper process when it is idle. Before, each Gemini chat that you opened since the start of OpenBot kept a helper process of about 120 MB, so OpenBot used more memory and became slow after hours of use. The first message after a chat was idle can now wait while Gemini starts.
