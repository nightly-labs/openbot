// @ts-check
// Loaded with `--require` in NODE_OPTIONS into every Node program that an agent starts on a server
// (see agentProcessEnvironment in src/main/server-memory.ts). In a container or a systemd unit with
// a CPU limit, os.cpus() still lists every CPU of the host, and build tools such as Next.js start one
// worker for each: 63 workers on a 64-CPU host that gives the server 8. This makes os.cpus() and
// os.availableParallelism() count only as many CPUs as the process may use. It changes nothing when
// /proc already shows the limit (LXCFS) or there is no limit. Every Node version that an agent may
// start loads it, so it uses no newer syntax or module names, and it never fails the program.
"use strict";

try {
  const { readFileSync } = require("fs");
  const os = require("os");

  /** The smallest CPU limit of the process's cgroup (v2) and its parents, or Infinity without one. */
  const cgroupCpuLimit = () => {
    const line = readFileSync("/proc/self/cgroup", "utf8")
      .split("\n")
      .find((entry) => entry.startsWith("0::"));
    if (!line) return Number.POSITIVE_INFINITY;
    let limit = Number.POSITIVE_INFINITY;
    // A parent's limit applies too, so each level from the process's own cgroup to the root counts.
    for (let path = line.slice(3); ; path = path.slice(0, path.lastIndexOf("/"))) {
      try {
        const [quota, period] = readFileSync(`/sys/fs/cgroup${path}/cpu.max`, "utf8").trim().split(" ");
        if (quota !== "max" && Number(period) > 0) limit = Math.min(limit, Math.ceil(Number(quota) / Number(period)));
      } catch {
        // The root cgroup and a cgroup without the cpu controller have no cpu.max.
      }
      if (path === "" || path === "/") break;
    }
    return limit;
  };

  const cpus = os.cpus;
  const parallelism = typeof os.availableParallelism === "function" ? os.availableParallelism : null;
  const limit = Math.max(1, Math.min(cgroupCpuLimit(), parallelism ? parallelism() : Number.POSITIVE_INFINITY));
  if (limit < cpus().length) os.cpus = () => cpus().slice(0, limit);
  // A Node version whose libuv does not read the cgroup counts the CPUs of the host here too.
  if (parallelism && limit < parallelism()) os.availableParallelism = () => limit;
  // `import { cpus } from "node:os"` reads a copy of the exports, which this updates.
  const { syncBuiltinESMExports } = require("module");
  if (typeof syncBuiltinESMExports === "function") syncBuiltinESMExports();
} catch {
  // A missing /proc or cgroup file leaves os as it is.
}
