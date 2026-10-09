### Fixed

- Show a Gemini rate limit or spent quota as an error that says to wait or choose another model.
  Before, the turn failed with no message, because OpenBot waited for a usage reading that Gemini
  does not send. A model that Gemini cannot use and a Google service failure also get their own
  message.
- Say "Not reported" for Gemini, Cursor, Cline and custom ACP agents in the usage menu. These
  providers have no usage reading, so the menu showed "Unavailable" as if the reading failed.
- Stop starting Gemini, Cursor, Cline and custom ACP agents only to read their usage. Each usage
  check started the provider for a reading that is always empty.
- Retry a provider start when model discovery times out, as other start timeouts do.
