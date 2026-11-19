// Makes the default name of a new hosted server in each interface language, as the add-server dialog does,
// and checks that the account server accepts each one (issue #12619: "云服务器" has no slug for a host
// address). A name that the account server accepts in its own language stays the same.
// Writes .openbot-build/hosted-server-default-name/report.json. Run: bun scripts/hosted-server-default-name-smoke.ts
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseHostedServerName } from "@openbot/contracts/hosted-servers";
import { TRANSLATED_LOCALES, translateFor } from "@openbot/i18n";
import { hostedServerDefaultName } from "../src/renderer/src/features/servers/hosted-server-name";

const OUT = resolve(import.meta.dirname, "../.openbot-build/hosted-server-default-name");
// The first server, the second, and a large count.
const SERVER_COUNTS = [0, 1, 98];

const rows = TRANSLATED_LOCALES.flatMap((locale) => {
  const t = translateFor(locale);
  return SERVER_COUNTS.map((serverCount) => {
    const translated =
      serverCount === 0
        ? t("server.hosted.defaultName")
        : t("server.hosted.defaultNameNumbered", { number: serverCount + 1 });
    const name = hostedServerDefaultName(translated);
    return { locale, serverCount, translated, name, accepted: parseHostedServerName(name) === name };
  });
});

mkdirSync(OUT, { recursive: true });
writeFileSync(resolve(OUT, "report.json"), `${JSON.stringify(rows, null, 2)}\n`);

for (const row of rows) {
  assert.ok(row.accepted, `${row.locale}: the account server refuses "${row.name}".`);
  if (parseHostedServerName(row.translated)) {
    assert.equal(row.name, row.translated.trim(), `${row.locale}: an accepted name changed.`);
  }
}
const prefixed = rows.filter((row) => row.name !== row.translated.trim());
process.stdout.write(
  `${rows.length} default names are accepted. ${prefixed.length} have the brand word before them: ${[
    ...new Set(prefixed.map((row) => row.locale)),
  ].join(", ")}.\nReport: ${resolve(OUT, "report.json")}\n`,
);
