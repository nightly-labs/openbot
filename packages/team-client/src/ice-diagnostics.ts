const ICE_SERVER_URL = /^(stun|turns?):([a-z0-9.-]{1,253})((?::\d{1,5})?(?:\?transport=(?:udp|tcp))?)$/iu;
const ADDRESS = /\b\d{1,3}(?:\.\d{1,3}){3}\b|\[?\b[0-9a-f]{0,4}(?::[0-9a-f]{0,4}){2,7}\b\]?/giu;

function isServiceHost(name: string): boolean {
  return name === "openbot.run" || name.endsWith(".openbot.run");
}

export function iceServerErrorDetail(url: string, errorCode: number, errorText: string): string {
  const parts = ICE_SERVER_URL.exec(url);
  const name = parts?.[2]?.toLowerCase() ?? "";
  const server = parts ? `${parts[1]}:${isServiceHost(name) ? name : "[host]"}${parts[3]}` : "unknown server";
  const text = errorText.replace(ADDRESS, "[address]").trim().slice(0, 120);
  return `${server} ${errorCode}${text ? ` ${text}` : ""}`;
}

const ICE_ROUTE = /^[a-z]{1,8}\/[a-z]{1,8} -> [a-z]{1,8}\/[a-z]{1,8}$/u;

interface IceCandidateStats {
  candidateType?: string;
  protocol?: string;
}

function candidateRoute(candidate: IceCandidateStats | null | undefined): string {
  return `${candidate?.candidateType ?? "unknown"}/${candidate?.protocol ?? "unknown"}`;
}

export function iceCandidateRoute(
  local: IceCandidateStats | null | undefined,
  remote: IceCandidateStats | null | undefined,
): string {
  return `${candidateRoute(local)} -> ${candidateRoute(remote)}`;
}

export function knownIceCandidateRoute(route: string | undefined): string {
  return route && ICE_ROUTE.test(route) ? route : "unknown";
}
