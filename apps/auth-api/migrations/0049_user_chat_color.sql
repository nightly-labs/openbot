ALTER TABLE users ADD COLUMN chat_color TEXT CHECK (
  chat_color IS NULL
  OR (length(chat_color) = 7 AND chat_color GLOB '#[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]')
);
