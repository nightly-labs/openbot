### Fixed

- A sign-in to an MCP server whose sign-in server answered with a web page stopped with a parser message, such as "Unexpected token '<'". OpenBot now tries the next sign-in address, as the standard asks. When no address answers in the correct form, it tells you that it cannot read the answer and that you can add an API key or a token in the server settings.
