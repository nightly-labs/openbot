// @ts-check
"use strict";

try {
  const { readFileSync } = require("fs");
  const os = require("os");

  const cgroupCpuLimit = () => {
    const line = readFileSync("/proc/self/cgroup", "utf8")
      .split("\n")
      .find((entry) => entry.startsWith("0::"));
    if (!line) return Number.POSITIVE_INFINITY;
    let limit = Number.POSITIVE_INFINITY;
    for (let path = line.slice(3); ; path = path.slice(0, path.lastIndexOf("/"))) {
      try {
        const [quota, period] = readFileSync(`/sys/fs/cgroup${path}/cpu.max`, "utf8").trim().split(" ");
        if (quota !== "max" && Number(period) > 0) limit = Math.min(limit, Math.ceil(Number(quota) / Number(period)));
      } catch {}
      if (path === "" || path === "/") break;
    }
    return limit;
  };

  const cpus = os.cpus;
  const parallelism = typeof os.availableParallelism === "function" ? os.availableParallelism : null;
  const limit = Math.max(1, Math.min(cgroupCpuLimit(), parallelism ? parallelism() : Number.POSITIVE_INFINITY));
  if (limit < cpus().length) os.cpus = () => cpus().slice(0, limit);
  if (parallelism && limit < parallelism()) os.availableParallelism = () => limit;
  const { syncBuiltinESMExports } = require("module");
  if (typeof syncBuiltinESMExports === "function") syncBuiltinESMExports();
} catch {}
