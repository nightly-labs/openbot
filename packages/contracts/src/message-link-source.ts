const OPENBOT_SOURCE_QUERY = "utm_source=openbot";
const SECRET_QUERY_PARAMETER =
  /signature|sign|token|hmac|hash|^auth|^session|^sig$|^s$|^h$|^md5$|^expires$|^state$|^code$|^ticket$|^otp$|^key$|^sid$|^x-(amz|goog)-/i;
const PRIVATE_HOST_SUFFIXES = [
  ".local",
  ".localhost",
  ".internal",
  ".lan",
  ".home.arpa",
  ".home",
  ".corp",
  ".intranet",
  ".test",
  ".invalid",
  ".example",
];

export function withOpenBotSource(address: string): string {
  const url = URL.parse(address);
  if (!url || (url.protocol !== "http:" && url.protocol !== "https:")) return address;
  const names = [...url.searchParams.keys()];
  if (
    !publicHostname(url.hostname) ||
    names.some((name) => name.toLowerCase() === "utm_source" || SECRET_QUERY_PARAMETER.test(name))
  )
    return address;
  url.search = url.search ? `${url.search}&${OPENBOT_SOURCE_QUERY}` : `?${OPENBOT_SOURCE_QUERY}`;
  return url.toString();
}

function publicHostname(hostname: string): boolean {
  const name = hostname.toLowerCase().replace(/\.$/, "");
  return (
    name.includes(".") &&
    !name.startsWith("[") &&
    !/^\d+(\.\d+){3}$/.test(name) &&
    !PRIVATE_HOST_SUFFIXES.some((suffix) => name.endsWith(suffix))
  );
}
