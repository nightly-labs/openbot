/**
 * Tests scripts/hosting/leaseweb-bootstrap.sh on a Leaseweb VPS that has OpenBot installed and an
 * SSH key for root:
 *
 *   bun scripts/hosting/leaseweb-bootstrap-e2e.ts --host=root@<address> [--restart=yes]
 *
 * It runs the bootstrap two times and checks that OpenBot keeps its process. The first run adds a
 * temporary key to the operator keys of the server: that key must sign in as root and not as the
 * service user, and a key that is not in the list must not sign in. A list with a bad line must
 * change nothing. At the end, a run with the list from before the test must remove the temporary
 * key. Then it checks on the
 * server that the service user cannot connect to the CloudStack router, to a private address or to
 * the metadata address, that root can still connect to the router, that no user can connect to port
 * 25, that the service user can connect to a public address, and that SSH offers keys only.
 *
 * `--restart=yes` also runs the checks that stop OpenBot. It puts a wrong router in the state file
 * and stops the rules: OpenBot must stop, and its next start must load the rules with the router of
 * the DHCP lease. Then it restarts the server: the rules must load before the network starts, and
 * the server state of `openbot status` must come back, and the server must run its newest kernel
 * with the boot arguments that it had.
 *
 * The report is in .openbot-build/leaseweb-bootstrap/.
 */

import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { createOpenBotLogger } from "@openbot/logging";

const logger = createOpenBotLogger("leaseweb-bootstrap-e2e");
const BOOTSTRAP = join(import.meta.dirname, "leaseweb-bootstrap.sh");
const REPORT_DIRECTORY = join(process.cwd(), ".openbot-build", "leaseweb-bootstrap");
const SSH_OPTIONS = ["-o", "BatchMode=yes", "-o", "ConnectTimeout=8", "-o", "ServerAliveInterval=15"];
const STATE_FILE = "/etc/openbot/egress-router";
const OPERATOR_KEYS = "/etc/ssh/openbot-operator-keys/root";
/** A documentation address (RFC 5737): never the router of a server. */
const WRONG_ROUTER = "192.0.2.1";
const COMMAND_DEADLINE_MS = 300_000;
const WAIT_DEADLINE_MS = 420_000;

/**
 * Prints one `key=value` line for each fact. A connection result is `connected`, `refused` (the
 * rules reject with a port-unreachable message, which gives the same error as a closed port),
 * `unreachable` (no route), `timeout` (no answer in 6 seconds) or `other`. The same connection as
 * root shows that a `refused` of the service user comes from the rules and not from the network.
 */
const PROBE = `
set -u
export LC_ALL=C
user=$(</opt/OpenBot/hosted/service-user)
router=$(cut -d, -f1 ${STATE_FILE})
connect='exec 3<>"/dev/tcp/$0/$1"'
result() {
  local output code
  output=$("$@" 2>&1)
  code=$?
  case "$code:$output" in
    0:*) echo connected ;;
    124:*) echo timeout ;;
    *"Connection refused"*) echo refused ;;
    *unreachable* | *"No route"*) echo unreachable ;;
    *) echo other ;;
  esac
}
as_root() { result timeout 6 bash -c "$connect" "$1" "$2"; }
as_user() { result runuser -u "$user" -- timeout 6 bash -c "$connect" "$1" "$2"; }
mail_rejects() { nft list chain inet openbot_egress output | sed -n 's/.*tcp dport 25 counter packets \\([0-9]*\\).*/\\1/p'; }
monotonic() { systemctl show "$1" -p "$2" --value; }
echo "bootId=$(</proc/sys/kernel/random/boot_id)"
echo "serviceUser=$user"
echo "openbotPid=$(systemctl show openbot.service -p MainPID --value)"
echo "openbot=$(systemctl is-active openbot.service)"
echo "rules=$(systemctl is-active openbot-egress-firewall.service)"
echo "updates=$(systemctl is-active unattended-upgrades.service)"
echo "routerState=$(<${STATE_FILE})"
echo "routerLease=$(sed -n 's/^SERVER_ADDRESS=//p' /run/systemd/netif/leases/* | sort -u | paste -sd, -)"
echo "rootRouter=$(as_root "$router" 80)"
echo "userRouter=$(as_user "$router" 80)"
echo "userRouterPassword=$(as_user "$router" 8080)"
echo "rootRouterPassword=$(as_root "$router" 8080)"
echo "userMetadata=$(as_user 169.254.169.254 80)"
echo "rootMetadata=$(as_root 169.254.169.254 80)"
echo "userPrivate=$(as_user 10.0.0.1 80)"
echo "rootPrivate=$(as_root 10.0.0.1 80)"
echo "userPublic=$(as_user openbot.run 443)"
echo "userSubmission=$(as_user smtp.gmail.com 587)"
before=$(mail_rejects)
echo "rootMail=$(as_root 1.1.1.1 25)"
echo "mailRejects=$(($(mail_rejects) - before))"
# The route comes from a router advertisement, on Leaseweb about 50 seconds after the start.
while [ -z "$(ip -6 route show default)" ] && [ "$(cut -d. -f1 /proc/uptime)" -lt 120 ]; do
  sleep 2
done
if [ -n "$(ip -6 route show default)" ]; then
  echo "userPrivate6=$(as_user fd00::1 80)"
  echo "rootPrivate6=$(as_root fd00::1 80)"
fi
echo "sshd=$(sshd -T | grep -E '^(passwordauthentication|kbdinteractiveauthentication|permitrootlogin|allowtcpforwarding) ' | sort | paste -sd, -)"
echo "updatePeriod=$(apt-config dump | sed -n 's/^APT::Periodic::Unattended-Upgrade "\\(.*\\)";$/\\1/p')"
echo "updateReboot=$(apt-config dump | sed -n 's/^Unattended-Upgrade::Automatic-Reboot "\\(.*\\)";$/\\1/p')"
# As needrestart does: the first key, in sort order, that matches the unit gives the value.
echo "updateServiceRestart=$(perl -e 'our %nrconf = (verbosity => 0, override_rc => {}); our $LOGPREF = ""; do "/etc/needrestart/needrestart.conf"; for my $re (sort keys %{$nrconf{override_rc}}) { next unless "openbot.service" =~ /$re/; print $nrconf{override_rc}{$re}; last }' 2>/dev/null)"
echo "updateOrigins=$(apt-config dump | sed -n 's/^Unattended-Upgrade::Allowed-Origins:: "\\(.*\\)";$/\\1/p' | paste -sd, -)"
# /boot/vmlinuz is a link that Ubuntu keeps on the newest kernel.
echo "kernelNewest=$(readlink /boot/vmlinuz | sed 's/^vmlinuz-//')"
echo "kernelFirstEntry=$(sed -n 's/^[[:space:]]*linux[[:space:]]*\\/boot\\/vmlinuz-\\([^ ]*\\) .*/\\1/p' /boot/grub/grub.cfg | head -n 1)"
echo "kernelRunning=$(uname -r)"
echo "kernelArguments=$(tr ' ' '\\n' </proc/cmdline | grep -v -E '^(BOOT_IMAGE=.*|root=.*)$' | paste -sd' ' -)"
echo "rulesLoaded=$(monotonic openbot-egress-firewall.service ExecMainExitTimestampMonotonic)"
echo "networkStarted=$(monotonic systemd-networkd.service ExecMainStartTimestampMonotonic)"
echo "server=$(runuser -u "$user" -- openbot status 2>/dev/null | sed -n 's/^Server: //p')"
`;

type Facts = Record<string, string>;

interface Check {
  name: string;
  expected: string;
  actual: string;
  pass: boolean;
}

interface Options {
  host: string;
  restart: boolean;
}

interface CommandResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  const bootstrap = await readFile(BOOTSTRAP, "utf8");
  const checks: Check[] = [];
  const expect = (name: string, actual: string | undefined, expected: string) => {
    checks.push({ name, expected, actual: actual ?? "", pass: actual === expected });
  };

  const start = await probe(options.host);
  if (start.openbot !== "active") throw new Error("openbot.service is not active. Install OpenBot first.");
  const server = start.server ?? "";
  const address = options.host.slice(options.host.indexOf("@") + 1);
  const keyDirectory = await mkdtemp(join(tmpdir(), "leaseweb-bootstrap-e2e-"));
  const operatorsBefore = await sshOk(options.host, `cat ${OPERATOR_KEYS} 2>/dev/null || true`);
  try {
    const operator = await temporaryKey(keyDirectory, "operator");
    const stranger = await temporaryKey(keyDirectory, "stranger");
    const withOperator = `${operatorsBefore}\n${operator.publicKey}\n`;
    // Run 1 gives the list. Run 2 has no argument and must keep it.
    for (const [index, list] of [withOperator, undefined].entries()) {
      const result = await bootstrapRun(options.host, bootstrap, list);
      expect(`bootstrap run ${index + 1} exit code`, String(result.code), "0");
      if (result.code !== 0) logger.error("The bootstrap failed.", { stderr: result.stderr.slice(-2000) });
    }
    const hardened = await probe(options.host);
    expect("OpenBot keeps its process through the bootstrap", hardened.openbotPid, start.openbotPid ?? "");
    expectHardened(expect, "bootstrap", hardened, server);
    expect("SSH offers keys only", await offeredLoginMethods(options.host), "publickey");
    expect("an operator key signs in as root", await signIn(`root@${address}`, operator.path), "root");
    expect(
      "an operator key does not sign in as the service user",
      await signIn(`${hardened.serviceUser}@${address}`, operator.path),
      "refused",
    );
    expect("a key that is not in the list does not sign in", await signIn(`root@${address}`, stranger.path), "refused");
    const damaged = await bootstrapRun(options.host, bootstrap, `${withOperator}not a key\n`);
    expect("a list with a bad line stops the bootstrap", String(damaged.code !== 0), "true");
    expect(
      "a list with a bad line changes no key",
      await sshOk(options.host, `cat ${OPERATOR_KEYS}`),
      keyLines(withOperator),
    );

    if (options.restart) await restartChecks(options.host, expect, hardened, server);
    expect("the operator key still signs in at the end", await signIn(`root@${address}`, operator.path), "root");

    await restoreOperators(options.host, bootstrap, operatorsBefore);
    expect("a removed operator key does not sign in", await signIn(`root@${address}`, operator.path), "refused");
    expect(
      "the operator keys are those from before the test",
      await sshOk(options.host, `cat ${OPERATOR_KEYS} 2>/dev/null || true`),
      operatorsBefore,
    );
  } finally {
    // A second restore after a failure in the test. It changes nothing after a good run.
    await restoreOperators(options.host, bootstrap, operatorsBefore);
    await rm(keyDirectory, { recursive: true, force: true });
  }

  const failed = checks.filter((check) => !check.pass);
  await mkdir(REPORT_DIRECTORY, { recursive: true });
  const reportPath = join(REPORT_DIRECTORY, "report.json");
  const report = {
    host: options.host,
    restart: options.restart,
    at: new Date().toISOString(),
    failed: failed.length,
    checks,
  };
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  for (const check of failed) logger.error("A check failed.", { ...check });
  logger.info("Wrote the bootstrap report.", { reportPath, checks: checks.length, failed: failed.length });
  if (failed.length > 0) process.exitCode = 1;
}

type Expect = (name: string, actual: string | undefined, expected: string) => void;

/** The checks that stop OpenBot: a stop of the rules, and a restart of the server. */
async function restartChecks(host: string, expect: Expect, hardened: Facts, server: string): Promise<void> {
  await sshOk(host, `echo ${WRONG_ROUTER} >${STATE_FILE} && systemctl stop openbot-egress-firewall.service`);
  const stopped = await sshOk(
    host,
    "systemctl is-active openbot.service; nft list table inet openbot_egress >/dev/null 2>&1; echo table=$?",
  );
  expect("OpenBot stops with the rules", stopped.trim().split("\n").join(","), "inactive,table=1");
  await sshOk(host, "systemctl start openbot.service");
  await waitForServer(host, server);
  expectHardened(expect, "start after a stop of the rules", await probe(host), server);

  // The connection ends with the server, so the exit code says nothing.
  await ssh(host, "systemctl reboot");
  const restarted = await waitForBoot(host, hardened.bootId ?? "");
  await waitForServer(host, server);
  const afterBoot = await probe(host);
  expectHardened(expect, "restart", afterBoot, server);
  expect("restart: the server runs the newest kernel", afterBoot.kernelRunning, afterBoot.kernelNewest ?? "");
  expect(
    "restart: the kernel has the boot arguments of the image",
    afterBoot.kernelArguments,
    hardened.kernelArguments ?? "",
  );
  expect(
    "restart: the rules load before the network starts",
    String(Number(afterBoot.rulesLoaded) > 0 && Number(afterBoot.rulesLoaded) < Number(afterBoot.networkStarted)),
    "true",
  );
  logger.info("The server restarted.", { bootId: restarted });
}

function expectHardened(expect: Expect, phase: string, facts: Facts, server: string): void {
  const name = (text: string) => `${phase}: ${text}`;
  expect(name("openbot.service"), facts.openbot, "active");
  expect(name("openbot-egress-firewall.service"), facts.rules, "active");
  expect(name("unattended-upgrades.service"), facts.updates, "active");
  expect(name("the state file names the DHCP server"), facts.routerState, facts.routerLease ?? "");
  // Without this, a router that answers nobody would pass the checks of the service user.
  expect(name("root connects to the router"), facts.rootRouter, "connected");
  expect(name("the service user cannot connect to the router"), facts.userRouter, "refused");
  const refusedByRules = (text: string, user: string | undefined, root: string | undefined) => {
    expect(name(`the service user cannot connect to ${text}`), user, "refused");
    expect(
      name(`the network does not refuse root at ${text}`),
      String(root !== undefined && root !== "refused"),
      "true",
    );
  };
  refusedByRules("the password port of the router", facts.userRouterPassword, facts.rootRouterPassword);
  refusedByRules("the metadata address", facts.userMetadata, facts.rootMetadata);
  refusedByRules("a private address", facts.userPrivate, facts.rootPrivate);
  // A server with no IPv6 route has no IPv6 facts.
  if (facts.userPrivate6 !== undefined)
    refusedByRules("a private IPv6 address", facts.userPrivate6, facts.rootPrivate6);
  expect(name("the service user connects to a public address"), facts.userPublic, "connected");
  expect(name("the service user connects to a mail submission port"), facts.userSubmission, "connected");
  expect(name("root cannot connect to port 25"), facts.rootMail, "refused");
  expect(name("the rules count the connection to port 25"), String(Number(facts.mailRejects) >= 1), "true");
  // OpenSSH before 10 (Ubuntu 24.04) prints the old name of this value.
  expect(
    name("sshd settings"),
    facts.sshd?.replace("without-password", "prohibit-password"),
    "allowtcpforwarding no,kbdinteractiveauthentication no,passwordauthentication no,permitrootlogin prohibit-password",
  );
  expect(name("updates install each day"), facts.updatePeriod, "1");
  expect(name("updates do not restart the server"), facts.updateReboot, "false");
  // The value that needrestart reads for the unit: 0 keeps it out of the restarts after an update.
  expect(name("updates do not restart OpenBot"), facts.updateServiceRestart, "0");
  const origins = (facts.updateOrigins ?? "").split(",");
  expect(
    name("updates come only from security origins"),
    String(origins.every((origin) => origin.endsWith("-security"))),
    "true",
  );
  expect(name("the newest kernel has the first boot entry"), facts.kernelFirstEntry, facts.kernelNewest ?? "");
  expect(name("server state"), facts.server, server);
}

/** The lines of a key list that the bootstrap keeps: no empty line and no comment. */
function keyLines(list: string): string {
  const lines = list.split("\n").filter((line) => line !== "" && !line.startsWith("#"));
  return lines.map((line) => `${line}\n`).join("");
}

function bootstrapRun(host: string, bootstrap: string, operatorKeys?: string): Promise<CommandResult> {
  const argument = operatorKeys === undefined ? "" : ` ${Buffer.from(operatorKeys).toString("base64")}`;
  return ssh(host, `bash -s${argument}`, bootstrap);
}

/** Gives the server the operator keys that it had before the test. The bootstrap accepts no empty list. */
async function restoreOperators(host: string, bootstrap: string, before: string): Promise<void> {
  if (keyLines(before) === "") await sshOk(host, `rm -f ${OPERATOR_KEYS}`);
  else if ((await bootstrapRun(host, bootstrap, before)).code !== 0)
    throw new Error("The bootstrap did not restore the operator keys.");
}

async function temporaryKey(directory: string, name: string): Promise<{ path: string; publicKey: string }> {
  const path = join(directory, name);
  const result = await run("ssh-keygen", ["-q", "-t", "ed25519", "-N", "", "-C", `e2e-${name}`, "-f", path]);
  if (result.code !== 0) throw new Error(`ssh-keygen failed: ${result.stderr.slice(-300)}`);
  return { path, publicKey: (await readFile(`${path}.pub`, "utf8")).trim() };
}

/**
 * Signs in with one key and nothing else: no configuration file, no agent and no shared connection
 * of the developer. Gives the user name on the server, or `refused`.
 */
async function signIn(target: string, keyPath: string): Promise<string> {
  const only = ["-F", "/dev/null", "-i", keyPath, "-o", "IdentitiesOnly=yes", "-o", "IdentityAgent=none"];
  const result = await run("ssh", [...only, ...SSH_OPTIONS, "-o", "ControlPath=none", target, "id -un"]);
  if (result.code === 0) return result.stdout.trim();
  return result.stderr.includes("Permission denied") ? "refused" : `exit ${result.code}`;
}

async function probe(host: string): Promise<Facts> {
  const facts: Facts = {};
  for (const line of (await sshOk(host, "bash -s", PROBE)).split("\n")) {
    const separator = line.indexOf("=");
    if (separator > 0) facts[line.slice(0, separator)] = line.slice(separator + 1);
  }
  return facts;
}

/** The login methods that sshd names when it refuses a login with no key. */
async function offeredLoginMethods(host: string): Promise<string> {
  const result = await run("ssh", [
    ...SSH_OPTIONS,
    "-o",
    "PubkeyAuthentication=no",
    "-o",
    "PreferredAuthentications=password,keyboard-interactive",
    host,
    "true",
  ]);
  const denied = /Permission denied \(([^)]*)\)/u.exec(result.stderr)?.[1];
  // The last line of the ssh error tells why it did not get to the login, such as a reset connection.
  return denied ?? `exit ${result.code}: ${result.stderr.trim().split("\n").at(-1) ?? ""}`;
}

async function waitForBoot(host: string, lastBootId: string): Promise<string> {
  const deadline = Date.now() + WAIT_DEADLINE_MS;
  while (Date.now() < deadline) {
    const result = await ssh(host, "cat /proc/sys/kernel/random/boot_id");
    const bootId = result.stdout.trim();
    if (result.code === 0 && bootId && bootId !== lastBootId) return bootId;
    await delay(4000);
  }
  throw new Error("The server did not start again.");
}

/** Waits until `openbot status` shows the server state that it had before the test. */
async function waitForServer(host: string, server: string): Promise<void> {
  const deadline = Date.now() + WAIT_DEADLINE_MS;
  const command = `runuser -u "$(</opt/OpenBot/hosted/service-user)" -- openbot status 2>/dev/null | sed -n 's/^Server: //p'`;
  while (Date.now() < deadline) {
    const result = await ssh(host, command);
    if (result.code === 0 && result.stdout.trim() === server) return;
    await delay(4000);
  }
  logger.warn("The server state did not come back.", { expected: server });
}

async function sshOk(host: string, command: string, input?: string): Promise<string> {
  const result = await ssh(host, command, input);
  if (result.code !== 0)
    throw new Error(`A command on the server failed (${result.code}): ${result.stderr.slice(-500)}`);
  return result.stdout;
}

function ssh(host: string, command: string, input?: string): Promise<CommandResult> {
  return run("ssh", [...SSH_OPTIONS, host, command], input);
}

function run(file: string, args: string[], input?: string): Promise<CommandResult> {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(file, args, { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const deadline = setTimeout(() => child.kill("SIGKILL"), COMMAND_DEADLINE_MS);
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", rejectRun);
    child.on("close", (code) => {
      clearTimeout(deadline);
      resolveRun({ code, stdout, stderr });
    });
    child.stdin.end(input ?? "");
  });
}

function parseOptions(argv: string[]): Options {
  const values = new Map(
    argv.map((argument) => {
      const match = /^--([a-z-]+)=(.*)$/u.exec(argument);
      if (!match) throw new Error(`Unknown argument: ${argument}`);
      return [match[1], match[2]] as const;
    }),
  );
  const host = values.get("host") ?? "";
  if (!/^[a-z_][a-z0-9_-]*@[A-Za-z0-9.:-]+$/u.test(host)) throw new Error("Pass --host=root@<address>.");
  const restart = values.get("restart") ?? "no";
  if (restart !== "yes" && restart !== "no") throw new Error("--restart must be yes or no.");
  return { host, restart: restart === "yes" };
}

await main();
