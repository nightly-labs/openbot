// Fixture for `no-raw-sqlite-transaction`. Every line the rule must reject carries a trailing
// `// flag`; every other line is correct code the rule must leave alone.
// Checked by `scripts/anti-slop-rules.test.ts`; not compiled and not linted.

withTransaction(db, () => db.prepare("DELETE FROM entries").run());
await withTransactionAsync(db, async () => writeRows(db));
db.exec("DELETE FROM entries; DELETE FROM selected;");
db.exec(`CREATE TRIGGER entry_insert AFTER INSERT ON entries BEGIN SELECT 1; END;`);
db.exec("PRAGMA foreign_keys = OFF");
db.prepare("SELECT 'BEGIN' AS word").get();
lines.push("BEGIN:VCALENDAR");
logger.info("COMMIT the change");
db.exec("BEGIN IMMEDIATE"); // flag
db.exec("BEGIN"); // flag
this.#db.exec("begin deferred"); // flag
database.connection.exec("COMMIT"); // flag
db.exec("END"); // flag
db.exec("ROLLBACK"); // flag
db.exec("ROLLBACK TO crm_proposal"); // flag
db.exec("SAVEPOINT crm_proposal"); // flag
db.exec('RELEASE crm_proposal'); // flag
db.exec(`SAVEPOINT ${name}`); // flag
db.exec(`  COMMIT`); // flag
db.prepare("BEGIN IMMEDIATE").run(); // flag
