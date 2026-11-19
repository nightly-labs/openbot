function serviceHost(host: string): boolean {
  const name = host.toLowerCase();
  return name === "localhost" || name === "openbot.run" || name.endsWith(".openbot.run");
}

const URL_HOST = /\b([a-z][a-z0-9+.-]{0,31}:\/\/)([^\s/:?#[\]"'<>]{1,255})/giu;
const BARE_HOST =
  /(?<![A-Za-z0-9@._-])(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.){1,8}(?:com|net|org|io|dev|app|ai|co|me|xyz|run|cloud|site|online|tech|info|biz|pro|eu|uk|de|pl|fr|es|it|nl|be|at|ch|se|no|dk|fi|cz|ru|ua|jp|cn|kr|in|br|mx|au|nz|ca|us|tv|gg|sh|cc|local|lan|internal|home|arpa)(?![A-Za-z0-9_-]|\.[A-Za-z0-9]|\()/giu;
const IPV4 = /(?<![\d.])(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})(?!\d|\.\d)/gu;
const IPV6 =
  /\b[0-9a-f]{1,4}(?::[0-9a-f]{1,4}){3,7}\b|\b(?:[0-9a-f]{1,4}:){1,6}:(?:[0-9a-f]{1,4}(?::[0-9a-f]{1,4}){0,5})?/giu;
const UUID = /(?<![0-9a-f])[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?![0-9a-f])/giu;
const LONG_ID =
  /(?<![A-Za-z0-9])(?:(?=[A-Za-z0-9]{0,255}\d)(?=[A-Za-z0-9]{0,255}[A-Za-z])[A-Za-z0-9]{16,256}|\d{16,256})(?![A-Za-z0-9])/gu;
const USER_FOLDER = /(\/(?:Users|home)\/)(?!\[user\])[^/\s"'`:,;)]{1,255}/gu;

function addressKind(first: number, second: number) {
  if (first === 10 || (first === 172 && second >= 16 && second <= 31) || (first === 192 && second === 168))
    return "[private-ip]";
  if (first === 100 && second >= 64 && second <= 127) return "[shared-ip]";
  if (first === 127) return "[loopback-ip]";
  if (first === 169 && second === 254) return "[link-local-ip]";
  return "[public-ip]";
}

export function maskIdentifiers(value: string): string {
  return value
    .replace(URL_HOST, (match, scheme: string, host: string) =>
      serviceHost(host) || /^[\d.]+$/u.test(host) ? match : `${scheme}[host]`,
    )
    .replace(BARE_HOST, (host) => (serviceHost(host) ? host : "[host]"))
    .replace(IPV6, "[ipv6]")
    .replace(IPV4, (match, first: string, second: string, third: string, fourth: string) =>
      [first, second, third, fourth].some((part) => Number(part) > 255)
        ? match
        : addressKind(Number(first), Number(second)),
    )
    .replace(UUID, "[id]")
    .replace(LONG_ID, "[id]")
    .replace(USER_FOLDER, "$1[user]");
}
