### Fixed

- The OpenRouter model list no longer shows the "(batch)" models. They work only for batch jobs, so
  a chat with one of them failed with a 404 error.
- On a server, the model picker of a second Gemini (or other provider) account now shows the models
  of that account's plan, such as Gemini 4 Argon on an Ultra plan. Before, it showed only the models
  of the first account. The server must also be on the new version of OpenBot.
- The Gemini usage ring shows again on a plan for which Google sends no Gemini limit. It shows the
  "Claude and GPT models" limit, and the usage popover names it.
