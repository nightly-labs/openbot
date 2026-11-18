## Agents

- Invalid `openbot_browser` tool calls now return localized, actionable errors instead of raw Zod text. Models get hints when they pass `url` without `tabId`; the composer banner shows a short user message instead of treating the failure as a generic provider error.