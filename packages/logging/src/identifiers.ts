// Text that becomes public, such as the support log lines of a bug report, must not name a person,
// their network or their server. `redactText` masks secrets and email addresses. `maskIdentifiers`
// masks the values that are not secret but point to one user. A second run gives the same text.

/** A host of an OpenBot service says nothing about the user. Each other host can be the user's own. */
function serviceHost(host: string): boolean {
  const name = host.toLowerCase();
  return name === "localhost" || name === "openbot.run" || name.endsWith(".openbot.run");
}

// The host of a URL, without a port. An address in digits is left to the address rules.
const URL_HOST = /\b([a-z][a-z0-9+.-]{0,31}:\/\/)([^\s/:?#[\]"'<>]{1,255})/giu;
// A host name outside a URL, such as in `Failed to resolve my-server.example.com`. Only a name that
// ends in a known suffix counts, so a file name or a property path in an error stays readable. A
// call such as `list.at(` is not a name.
const BARE_HOST =
  /(?<![A-Za-z0-9@._-])(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.){1,8}(?:com|net|org|io|dev|app|ai|co|me|xyz|run|cloud|site|online|tech|info|biz|pro|eu|uk|de|pl|fr|es|it|nl|be|at|ch|se|no|dk|fi|cz|ru|ua|jp|cn|kr|in|br|mx|au|nz|ca|us|tv|gg|sh|cc|local|lan|internal|home|arpa)(?![A-Za-z0-9_-]|\.[A-Za-z0-9]|\()/giu;
const IPV4 = /(?<![\d.])(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})(?!\d|\.\d)/gu;
// Also a hardware address, which has six groups.
const IPV6 =
  /\b[0-9a-f]{1,4}(?::[0-9a-f]{1,4}){3,7}\b|\b(?:[0-9a-f]{1,4}:){1,6}:(?:[0-9a-f]{1,4}(?::[0-9a-f]{1,4}){0,5})?/giu;
const UUID = /(?<![0-9a-f])[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?![0-9a-f])/giu;
// A record ID, a hash or a device token: a long run of letters and digits together, or of digits.
// A word, a version and an error code have no such run.
const LONG_ID =
  /(?<![A-Za-z0-9])(?:(?=[A-Za-z0-9]{0,255}\d)(?=[A-Za-z0-9]{0,255}[A-Za-z])[A-Za-z0-9]{16,256}|\d{16,256})(?![A-Za-z0-9])/gu;
// The folder of a user account, which has the account name.
const USER_FOLDER = /(\/(?:Users|home)\/)(?!\[user\])[^/\s"'`:,;)]{1,255}/gu;

/**
 * The kind of an IPv4 address. A connection problem needs to tell a private network from a carrier
 * or VPN network and from the internet. The numbers themselves point to the user.
 */
function addressKind(first: number, second: number) {
  if (first === 10 || (first === 172 && second >= 16 && second <= 31) || (first === 192 && second === 168))
    return "[private-ip]";
  if (first === 100 && second >= 64 && second <= 127) return "[shared-ip]";
  if (first === 127) return "[loopback-ip]";
  if (first === 169 && second === 254) return "[link-local-ip]";
  return "[public-ip]";
}

/**
 * Masks what can point to one user in text that becomes public: network addresses, host names that
 * are not an OpenBot service, record IDs and hashes, and the name of a user folder. It does not mask
 * secrets or email addresses: run `redactText` first. Free text, such as the message of an error,
 * can still hold a name, so show the text to the user before it is sent.
 */
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
