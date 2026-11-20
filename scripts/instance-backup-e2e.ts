import { spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { migrateOpenBotDatabase } from "../src/backend/openbot-database-schema";

const reportRoot = resolve(".openbot-build/instance-backup-e2e");
const dind = `openbot-backup-e2e-${randomBytes(4).toString("hex")}`;
const script = "/opt/openbot-docker/instances/openbot-instance";
const data = "/srv/openbot/main/data";
const agentId = "agent-e2e-1";
const results: Array<{ name: string; ok: boolean; detail: string }> = [];

interface Run {
  status: number;
  stdout: string;
  stderr: string;
}

function run(command: string, args: string[], input?: string): Run {
  const result = spawnSync(command, args, { encoding: "utf8", input, maxBuffer: 64 * 1024 * 1024 });
  if (result.error) throw result.error;
  return { status: result.status ?? -1, stdout: result.stdout, stderr: result.stderr };
}

function shell(command: string): Run {
  return run("docker", ["exec", "--interactive", dind, "bash", "-euo", "pipefail", "-c", command]);
}

function must(command: string): string {
  const result = shell(command);
  if (result.status !== 0) throw new Error(`${command} failed (${result.status}): ${result.stderr}${result.stdout}`);
  return result.stdout.trim();
}

function instance(...args: string[]): Run {
  return shell([script, ...args].map((arg) => `'${arg}'`).join(" "));
}

function check(name: string, ok: boolean, detail: string): void {
  results.push({ name, ok, detail });
  process.stdout.write(`${ok ? "pass" : "FAIL"} ${name}: ${detail}\n`);
}

function running(): boolean {
  return shell("docker inspect --format '{{.State.Running}}' openbot-main").stdout.trim() === "true";
}

function completeBackups(): string[] {
  const out = shell('for f in /backups/main/*Z; do [ -f "$f/manifest.json" ] && basename "$f"; done; true').stdout;
  return out.split("\n").filter(Boolean);
}

function summary(result: Run): string {
  return `exit ${result.status}: ${(result.stderr || result.stdout).trim().split("\n").slice(-4).join(" | ")}`;
}

async function writeFixture(root: string): Promise<void> {
  const config = join(root, ".config/OpenBot");
  const shared = join(root, "OpenBot/Shared/Data");
  await mkdir(config, { recursive: true });
  await mkdir(shared, { recursive: true });
  await mkdir(join(root, ".local/share/keyrings"), { recursive: true });
  await mkdir(join(root, ".config/openbot-container"), { recursive: true });
  await mkdir(join(root, "OpenBot/Agents/E2E"), { recursive: true });

  const now = new Date().toISOString();
  const db = new DatabaseSync(join(config, "openbot.db"));
  try {
    migrateOpenBotDatabase(db);
    db.prepare(
      "INSERT INTO projection_agents (agent_id, thread_id, model, updated_at, sort_order, agent_json, last_event_sequence) VALUES (?, ?, 'test', ?, 0, ?, 1)",
    ).run(agentId, "thread-e2e-1", now, JSON.stringify({ id: agentId, name: "E2E" }));
    db.prepare(
      "INSERT INTO projection_threads (thread_id, agent_id, title, created_at, updated_at, last_event_sequence) VALUES ('thread-e2e-1', ?, 'E2E', ?, ?, 1)",
    ).run(agentId, now, now);
    db.prepare(
      "INSERT INTO projection_thread_messages (thread_id, message_id, author, status, created_at, ordinal, message_json, last_event_sequence) VALUES ('thread-e2e-1', 'message-1', 'user', 'complete', ?, 0, '{}', 1)",
    ).run(now);
    db.prepare(
      "INSERT INTO projection_agent_memories (memory_id, agent_id, text, normalized_text, origin, created_at, updated_at, last_event_sequence) VALUES ('memory-1', ?, 'The user likes tea.', 'the user likes tea.', 'manual', ?, ?, 1)",
    ).run(agentId, now, now);
  } finally {
    db.close();
  }

  const tables = new DatabaseSync(join(shared, "agent-data.db"));
  try {
    tables.exec(
      "CREATE TABLE openbot_metadata (table_name TEXT PRIMARY KEY, owner_agent_id TEXT NOT NULL, created_at TEXT NOT NULL)",
    );
    tables.exec("CREATE TABLE contacts (name TEXT, email TEXT)");
    tables.exec("INSERT INTO contacts VALUES ('Ada', 'ada@example.com')");
    tables.exec("CREATE TABLE tasks (title TEXT)");
    tables.prepare("INSERT INTO openbot_metadata VALUES ('contacts', ?, ?)").run(agentId, now);
    tables.prepare("INSERT INTO openbot_metadata VALUES ('tasks', 'agent-removed', ?)").run(now);
  } finally {
    tables.close();
  }

  await writeFile(join(root, ".local/share/keyrings/login.keyring"), randomBytes(512));
  await writeFile(join(root, ".config/openbot-container/keyring-password"), randomBytes(32).toString("hex"), {
    mode: 0o600,
  });
  await writeFile(join(root, "OpenBot/Agents/E2E/notes.md"), "Saved before the backup.\n");
  await writeFile(join(root, "OpenBot/Agents/E2E/attachment.bin"), randomBytes(256 * 1024));
}

const standIn = `FROM alpine:3.22
LABEL org.opencontainers.image.version=0.40.0
RUN printf '#!/bin/sh\\ntrap "date > /data/.e2e-clean-stop; exit 0" TERM\\ndate >> /data/.e2e-starts\\nwhile true; do sleep 1 & wait $!; done\\n' >/app && chmod 0755 /app
USER 1000:1000
ENTRYPOINT ["/app"]
`;

async function main(): Promise<void> {
  await mkdir(reportRoot, { recursive: true });
  const fixture = await mkdtemp(join(reportRoot, "fixture-"));
  try {
    await writeFixture(fixture);
    const started = run("docker", ["run", "--detach", "--privileged", "--name", dind, "docker:28-dind"]);
    if (started.status !== 0) throw new Error(`Docker-in-Docker did not start: ${started.stderr}`);
    const ready = run("docker", [
      "exec",
      dind,
      "sh",
      "-c",
      "for i in $(seq 120); do docker info >/dev/null 2>&1 && exit 0; sleep 1; done; exit 1",
    ]);
    if (ready.status !== 0) throw new Error("The Docker daemon in the container did not start.");
    const packages = run("docker", [
      "exec",
      dind,
      "apk",
      "add",
      "--quiet",
      "bash",
      "coreutils",
      "util-linux",
      "findutils",
      "sqlite",
      "zstd",
      "tar",
      "e2fsprogs",
      "gzip",
    ]);
    if (packages.status !== 0) throw new Error(`The packages did not install: ${packages.stderr}`);
    const scriptsCopied = run("docker", ["cp", resolve("docker"), `${dind}:/opt/openbot-docker`]);
    if (scriptsCopied.status !== 0) throw new Error(`The instance scripts did not copy: ${scriptsCopied.stderr}`);
    const fixtureCopied = run("docker", ["cp", `${fixture}/.`, `${dind}:/fixture`]);
    if (fixtureCopied.status !== 0) throw new Error(`The instance fixture did not copy: ${fixtureCopied.stderr}`);
    must(`mkdir -p /stand-in && cat >/stand-in/Dockerfile <<'EOF'\n${standIn}EOF`);
    must("docker build --quiet --tag ghcr.io/nightly-labs/openbot:latest /stand-in >/dev/null");

    must(`mkdir -p /srv/openbot/main/data /backups
      fallocate --length 256M /srv/openbot/main/data.img
      mkfs.ext4 -q -m 0 /srv/openbot/main/data.img
      mount -o loop /srv/openbot/main/data.img ${data}
      cp -a /fixture/. ${data}/ && chown -R 1000:1000 ${data} && chmod 0700 ${data}
      printf 'OPENBOT_NAME=main\\nOPENBOT_CPUS=1\\nOPENBOT_MEM=1g\\nOPENBOT_DISK=256M\\nOPENBOT_BACKUP_DIR=/backups\\nOPENBOT_BACKUP_KEEP=2\\nOPENBOT_BACKUP_MAX_AGE=24\\n' >/opt/openbot-docker/instances/main.env
      docker run --detach --name openbot-main --stop-timeout 20 -v ${data}:/data ghcr.io/nightly-labs/openbot:latest >/dev/null`);
    const dataHash = must(`sha256sum ${data}/.config/OpenBot/openbot.db | cut -d ' ' -f 1`);

    let result = instance("backups", "main");
    check(
      "status before the first backup is overdue",
      result.status === 1 && /older than 24 hours/.test(result.stdout),
      summary(result),
    );

    result = instance("backup", "main", "--verify");
    const first = completeBackups()[0] ?? "";
    check("backup and verify", result.status === 0 && first !== "", summary(result));
    check("instance runs again after the backup", running(), `running=${running()}`);
    check("clean stop before the copy", shell(`test -f ${data}/.e2e-clean-stop`).status === 0, "stop file written");
    const manifest = JSON.parse(must(`cat /backups/main/${first}/manifest.json`));
    check(
      "manifest has the version, checksum and downtime",
      manifest.openbotVersion === "0.40.0" &&
        /^[0-9a-f]{64}$/.test(manifest.archiveSha256) &&
        manifest.wasRunning === true,
      JSON.stringify({
        version: manifest.openbotVersion,
        archive: manifest.archive,
        downtime: manifest.downtimeSeconds,
      }),
    );
    const verified = JSON.parse(must(`cat /backups/main/${first}/verified.json`));
    check(
      "verification counts the saved data",
      verified.agents === 1 &&
        verified.threads === 1 &&
        verified.messages === 1 &&
        verified.memories === 1 &&
        verified.sharedTables === 2,
      JSON.stringify(verified),
    );
    check(
      "verification reports a shared table owner that is not an agent",
      verified.warnings.some((warning: string) => warning.includes("1 shared table owners")),
      JSON.stringify(verified.warnings),
    );
    check(
      "the backup folder is private",
      must(`stat --format=%a /backups/main /backups/main/${first}`) === "700\n700",
      must("stat --format=%a /backups/main"),
    );

    result = instance("backups", "main", "--json");
    const status = JSON.parse(result.stdout);
    check(
      "status after a backup",
      result.status === 0 &&
        status.overdue === false &&
        status["backup-success"]?.result === "ok" &&
        status["verify-success"]?.result === "ok",
      summary(result),
    );

    const invalidSources = [
      {
        name: "main database",
        path: ".config/OpenBot/openbot.db",
        error: /OpenBot cannot open openbot\.db|openbot\.db is damaged/,
      },
      {
        name: "shared database",
        path: "OpenBot/Shared/Data/agent-data.db",
        error: /shared tables cannot open|shared tables are damaged/,
      },
    ];
    for (const source of invalidSources) {
      const beforeInvalid = completeBackups();
      const successHash = must("sha256sum /srv/openbot/main/backup-status/verify-success.json | cut -d ' ' -f 1");
      must(
        `cp -a ${data}/${source.path} /root/e2e-healthy-database && printf 'not a SQLite database\n' > ${data}/${source.path}`,
      );
      const invalidResult = instance("backup", "main");
      must(`mv /root/e2e-healthy-database ${data}/${source.path}`);
      const invalidBackup = completeBackups().find((name) => !beforeInvalid.includes(name)) ?? "";
      if (!invalidBackup) throw new Error(`The invalid ${source.name} backup was not created.`);
      check(
        `an unverified backup saves invalid ${source.name} bytes with valid checksums`,
        invalidResult.status === 0 &&
          completeBackups().length === beforeInvalid.length + 1 &&
          shell(
            `cd /backups/main/${invalidBackup} && sha256sum --check --quiet --strict SHA256SUMS && test ! -e verified.json`,
          ).status === 0,
        summary(invalidResult),
      );
      const targetHashes = must(
        `cd ${data} && sha256sum .config/OpenBot/openbot.db OpenBot/Shared/Data/agent-data.db OpenBot/Agents/E2E/notes.md OpenBot/Agents/E2E/attachment.bin .local/share/keyrings/login.keyring .config/openbot-container/keyring-password .e2e-starts .e2e-clean-stop`,
      );
      const targetRunningBefore = running();
      const refused = instance("restore", "main", invalidBackup, "--replace");
      check(
        `restore refuses an invalid ${source.name} before it stops the target`,
        refused.status > 0 && source.error.test(refused.stderr) && !/Stopping openbot-main/.test(refused.stdout),
        summary(refused),
      );
      const targetRunningAfter = running();
      const afterHashes = must(
        `cd ${data} && sha256sum .config/OpenBot/openbot.db OpenBot/Shared/Data/agent-data.db OpenBot/Agents/E2E/notes.md OpenBot/Agents/E2E/attachment.bin .local/share/keyrings/login.keyring .config/openbot-container/keyring-password .e2e-starts .e2e-clean-stop`,
      );
      check(
        `a refused ${source.name} restore keeps target bytes and running state`,
        targetRunningBefore && targetRunningAfter && targetHashes === afterHashes,
        JSON.stringify({
          before: createHash("sha256").update(targetHashes).digest("hex"),
          after: createHash("sha256").update(afterHashes).digest("hex"),
          targetRunningBefore,
          targetRunningAfter,
        }),
      );
      check(
        `a refused ${source.name} restore removes verification work without staging or replacement`,
        must(`find ${data} -maxdepth 1 \\( -name '.openbot-restore*' -o -name '.openbot-replaced*' \\) | wc -l`) ===
          "0" &&
          must("find /var/tmp -maxdepth 1 -name 'openbot-verify.*' | wc -l") === "0" &&
          completeBackups().length === beforeInvalid.length + 1,
        "no restore, replacement or verification folder stays; the source backup stays",
      );
      const failedStatus = instance("backups", "main", "--json");
      const failedVerify = JSON.parse(failedStatus.stdout);
      check(
        `a refused ${source.name} restore records failure and keeps the last verification success`,
        failedStatus.status === 1 &&
          failedVerify.lastVerify === "failed" &&
          failedVerify["verify-attempt"]?.result === "failed" &&
          source.error.test(failedVerify["verify-attempt"]?.error ?? "") &&
          failedVerify["verify-success"]?.result === "ok" &&
          successHash === must("sha256sum /srv/openbot/main/backup-status/verify-success.json | cut -d ' ' -f 1"),
        `lastVerify=${failedVerify.lastVerify}; prior success hash matches`,
      );
      must(`rm -rf /backups/main/${invalidBackup}`);
    }

    must(`mv ${data}/.config/openbot-container/keyring-password /root/keyring-password`);
    result = instance("backup", "main");
    must(`mv /root/keyring-password ${data}/.config/openbot-container/keyring-password`);
    check(
      "a backup without the keyring password fails",
      result.status !== 0 && /keyring-password is missing/.test(result.stderr) && completeBackups().length === 1,
      summary(result),
    );
    check("instance runs after a failed backup", running(), `running=${running()}`);
    result = instance("backups", "main");
    check(
      "status shows the failed backup",
      result.status === 1 && /Last backup: failed/.test(result.stdout),
      result.stdout.trim(),
    );

    must("mkdir -p /small && mount -t tmpfs -o size=64k tmpfs /small");
    must("sed -i 's#^OPENBOT_BACKUP_DIR=.*#OPENBOT_BACKUP_DIR=/small#' /opt/openbot-docker/instances/main.env");
    const startsBefore = must(`wc -l < ${data}/.e2e-starts`);
    result = instance("backup", "main");
    must("sed -i 's#^OPENBOT_BACKUP_DIR=.*#OPENBOT_BACKUP_DIR=/backups#' /opt/openbot-docker/instances/main.env");
    check(
      "a backup to a full disk fails without a stop",
      result.status !== 0 &&
        /free/.test(result.stderr) &&
        must(`wc -l < ${data}/.e2e-starts`) === startsBefore &&
        running(),
      summary(result),
    );
    check(
      "no partial backup stays",
      must("find /small /backups -name '*.partial' | wc -l") === "0",
      "no .partial folder",
    );

    must(
      `cp -a /backups/main/${first} /backups/main/damaged && printf 'x' | dd of=/backups/main/damaged/${manifest.archive} bs=1 seek=100 conv=notrunc 2>/dev/null`,
    );
    result = instance("verify", "main", "damaged");
    must("rm -rf /backups/main/damaged");
    check(
      "a damaged archive fails verification",
      result.status !== 0 && /checksums/.test(result.stderr),
      summary(result),
    );
    check(
      "verification removes its temporary folder",
      must("find /var/tmp -maxdepth 1 -name 'openbot-verify.*' | wc -l") === "0",
      "no openbot-verify folder in /var/tmp",
    );

    const beforeFailedVerify = completeBackups();
    must(
      "sed -i 's/^OPENBOT_BACKUP_KEEP=.*/OPENBOT_BACKUP_KEEP=1/' /opt/openbot-docker/instances/main.env && mv /usr/bin/sqlite3 /usr/bin/sqlite3.off",
    );
    result = instance("backup", "main", "--verify");
    must(
      "mv /usr/bin/sqlite3.off /usr/bin/sqlite3 && sed -i 's/^OPENBOT_BACKUP_KEEP=.*/OPENBOT_BACKUP_KEEP=2/' /opt/openbot-docker/instances/main.env",
    );
    const afterFailedVerify = completeBackups();
    check(
      "a failed verification keeps the older backups",
      result.status !== 0 &&
        /sqlite3/.test(result.stderr) &&
        beforeFailedVerify.every((name) => afterFailedVerify.includes(name)) &&
        afterFailedVerify.length === beforeFailedVerify.length + 1,
      afterFailedVerify.join(", "),
    );
    must(`rm -rf /backups/main/${afterFailedVerify.find((name) => !beforeFailedVerify.includes(name))}`);

    instance("backup", "main");
    result = instance("backup", "main");
    const kept = completeBackups();
    check(
      "retention keeps 2 backups",
      result.status === 0 && kept.length === 2 && !kept.includes(first),
      kept.join(", "),
    );

    must(
      `printf '{\\n  "step": "backup",\\n  "result": "running",\\n  "startedAt": "2026-01-01T00:00:00Z"\\n}\\n' >/srv/openbot/main/backup-status/backup-attempt.json`,
    );
    result = instance("backups", "main");
    check(
      "status shows a backup that stopped without a result",
      result.status === 1 && /Last backup: stopped without a result/.test(result.stdout),
      summary(result),
    );

    must(`cp -a /backups/main/${kept[1]} /backups/main/29991231T000000Z`);
    result = instance("backup", "main", "--verify");
    const made = /^Backup \/backups\/main\/(\S+):/m.exec(result.stdout)?.[1] ?? "";
    const afterClock = completeBackups();
    must("rm -rf /backups/main/29991231T000000Z");
    check(
      "retention keeps a new backup that sorts first",
      result.status === 0 && made !== "" && afterClock.includes(made) && afterClock.length === 2,
      afterClock.join(", "),
    );
    check(
      "--verify checks the new backup",
      result.stdout.includes(`Verifying /backups/main/${made}.`),
      `verified ${made}`,
    );

    must("docker rm --force openbot-main >/dev/null");
    result = instance("backup", "main");
    const removedBackup = completeBackups().at(-1) ?? "";
    const removedVersion = must(
      `sed -n 's/^  "openbotVersion": "\\(.*\\)",$/\\1/p' /backups/main/${removedBackup}/manifest.json`,
    );
    must(
      `docker run --detach --name openbot-main --stop-timeout 20 -v ${data}:/data ghcr.io/nightly-labs/openbot:latest >/dev/null`,
    );
    check(
      "a backup without a container has the version of the image",
      result.status === 0 && removedVersion === "0.40.0",
      `openbotVersion ${removedVersion}`,
    );
    const latest = completeBackups().at(-1) ?? "";

    const lock = "/run/openbot-instance-update-main.lock";
    const waited = must(
      `flock ${lock} sleep 30 & holder=$!; until ! flock --nonblock ${lock} true; do sleep 0.1; done; set +e; timeout 3 ${script} down main >/dev/null 2>&1; code=$?; set -e; kill $holder; wait $holder 2>/dev/null || true; echo $code`,
    );
    check("down waits for the lock of the instance", waited === "124" && running(), `timeout exit ${waited}`);

    must(`echo changed > ${data}/OpenBot/Agents/E2E/after-backup.md && rm ${data}/OpenBot/Agents/E2E/notes.md`);
    must(
      `mkdir -p /trap && ln -s /trap ${data}/.openbot-replaced && ln -s /trap ${data}/.openbot-restore && ln -s /trap ${data}/.openbot-replaced.x && chown -h 1000:1000 ${data}/.openbot-*`,
    );
    result = instance("restore", "main", latest);
    check(
      "restore without --replace refuses data",
      result.status !== 0 && /--replace/.test(result.stderr) && running(),
      summary(result),
    );

    must(
      `cp -a /backups/main/${latest} /backups/main/newer && sed -i 's/"openbotVersion": "0.40.0"/"openbotVersion": "99.0.0"/' /backups/main/newer/manifest.json`,
    );
    result = instance("restore", "main", "newer", "--replace");
    must("rm -rf /backups/main/newer");
    check(
      "restore refuses a backup from a newer OpenBot",
      result.status !== 0 && /99\.0\.0/.test(result.stderr) && running(),
      summary(result),
    );

    result = instance("restore", "main", latest, "--replace");
    check(
      "restore refuses a folder from a restore that did not end",
      result.status !== 0 && /did not end/.test(result.stderr) && running(),
      summary(result),
    );
    must(`rm ${data}/.openbot-replaced.x`);
    result = instance("restore", "main", latest, "--replace");
    check("restore with --replace", result.status === 0, summary(result));
    check("instance stays stopped after a restore", !running(), `running=${running()}`);
    const restored = must(
      `cd ${data} && test -f OpenBot/Agents/E2E/notes.md && test ! -e OpenBot/Agents/E2E/after-backup.md && test -z "$(find . -maxdepth 1 -name '.openbot-*')" && sha256sum .config/OpenBot/openbot.db | cut -d ' ' -f 1`,
    );
    check("restored data is the backup", restored === dataHash, `openbot.db ${restored.slice(0, 12)}`);
    check(
      "restore does not follow links that an agent made",
      must("ls -A /trap | wc -l") === "0",
      "the link target stays empty",
    );
    check(
      "restored files belong to the user of the data",
      must(`find ${data} -mindepth 1 ! -user 1000 ! -path '${data}/lost+found*' | wc -l`) === "0",
      "owner 1000",
    );
    must("docker start openbot-main >/dev/null");
    check("instance starts on the restored data", running(), `running=${running()}`);
  } finally {
    run("docker", ["rm", "--force", "--volumes", dind]);
    await rm(fixture, { recursive: true, force: true });
    const failed = results.filter((result) => !result.ok);
    await writeFile(
      join(reportRoot, "report.json"),
      `${JSON.stringify({ finishedAt: new Date().toISOString(), passed: results.length - failed.length, failed: failed.length, results }, null, 2)}\n`,
    );
    process.stdout.write(
      `${results.length - failed.length}/${results.length} passed. Report: ${join(reportRoot, "report.json")}\n`,
    );
    if (failed.length > 0 || results.length === 0) process.exitCode = 1;
  }
}

await main();
