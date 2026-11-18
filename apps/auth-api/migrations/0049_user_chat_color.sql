-- The chat color that the user picked for their own message bubbles, as lower-case `#rrggbb`. NULL =
-- no chat color. Members of every server of the user see it. The Worker that runs before this
-- deploy does not read the column, and its inserts get NULL.
ALTER TABLE users ADD COLUMN chat_color TEXT CHECK (
  chat_color IS NULL
  OR (length(chat_color) = 7 AND chat_color GLOB '#[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]')
);
