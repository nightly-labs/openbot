### Fixed

- Gemini agents no longer fail every turn with "Invalid value at 'tools[0].function_declarations[…]…enum[0]' (TYPE_STRING)". Two OpenBot tools sent numbers in a list of allowed values, which Gemini accepts only as text.
