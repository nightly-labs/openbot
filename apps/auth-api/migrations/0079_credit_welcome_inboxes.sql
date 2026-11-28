CREATE TABLE credit_welcome_inboxes (
  inbox TEXT PRIMARY KEY,
  user_id TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL
);

INSERT OR IGNORE INTO credit_welcome_inboxes(inbox, user_id, created_at)
SELECT inbox, user_id, created_at FROM (
  SELECT CASE WHEN substr(u.e, instr(u.e, '@') + 1) IN ('gmail.com', 'googlemail.com')
           THEN replace(substr(u.e, 1, CASE WHEN instr(u.e, '+') BETWEEN 1 AND instr(u.e, '@') THEN instr(u.e, '+') ELSE instr(u.e, '@') END - 1), '.', '') || '@gmail.com'
         END AS inbox,
         g.user_id, g.created_at
    FROM credit_grants g
    JOIN (SELECT id, lower(email) AS e FROM users) u ON u.id = g.user_id
   WHERE g.source = 'welcome'
)
WHERE inbox IS NOT NULL
ORDER BY created_at, user_id;

CREATE TRIGGER credit_welcome_inboxes_on_grant AFTER INSERT ON credit_grants
WHEN NEW.source = 'welcome' AND NEW.user_id IS NOT NULL
BEGIN
  INSERT OR IGNORE INTO credit_welcome_inboxes(inbox, user_id, created_at)
  SELECT inbox, NEW.user_id, NEW.created_at FROM (
    SELECT CASE WHEN substr(e, instr(e, '@') + 1) IN ('gmail.com', 'googlemail.com')
             THEN replace(substr(e, 1, CASE WHEN instr(e, '+') BETWEEN 1 AND instr(e, '@') THEN instr(e, '+') ELSE instr(e, '@') END - 1), '.', '') || '@gmail.com'
           END AS inbox
      FROM (SELECT lower(email) AS e FROM users WHERE id = NEW.user_id)
  )
  WHERE inbox IS NOT NULL;
END;
