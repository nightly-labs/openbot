import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

export const MACHINE_HOSTING = "/root/openbot-hosting";

export interface PoolRelease {
  url: string;
  sha256: string;
}

export function hostingCopy() {
  const archive = execFileSync(
    "tar",
    ["-czf", "-", "--no-xattrs", "--exclude=*.ts", "-C", resolve(import.meta.dirname, ".."), "hosting"],
    { maxBuffer: 16 * 1024 * 1024 },
  );
  return `set -euo pipefail
rm -rf ${MACHINE_HOSTING}
install -d -m 0700 ${MACHINE_HOSTING}
base64 -d <<'OPENBOT_HOSTING' | tar -xz --no-same-owner --strip-components=1 -C ${MACHINE_HOSTING}
${archive.toString("base64")}
OPENBOT_HOSTING
`;
}

export function prepareScript(machineId: string, release: PoolRelease, authApi: string, keys: string) {
  return `${hostingCopy()}
bash ${MACHINE_HOSTING}/move-from-boat.sh prepare lsw-${machineId} 1000 1000 '${release.url}' ${release.sha256} '${authApi}'
bash ${MACHINE_HOSTING}/leaseweb-bootstrap.sh '${keys}'
`;
}

export function upgradeScript(release: PoolRelease, authApi: string) {
  return `${hostingCopy()}
bash ${MACHINE_HOSTING}/move-from-boat.sh upgrade '${release.url}' ${release.sha256} '${authApi}'
`;
}
