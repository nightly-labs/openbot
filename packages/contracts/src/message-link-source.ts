const OPENBOT_SOURCE_QUERY = "utm_source=openbot";
const SIGNED_QUERY_PARAMETER = /signature|token|^sig$|^state$|^code$|^x-(amz|goog)-/i;
const PRIVATE_HOST_SUFFIXES = [".local", ".localhost", ".internal", ".lan", ".home.arpa"];

export function withOpenBotSource(address: string): string {
  const url = URL.parse(address);
  if (!url || (url.protocol !== "http:" && url.protocol !== "https:")) return address;
  const names = [...url.searchParams.keys()];
  if (
    !publicHostname(url.hostname) ||
    names.some((name) => name.toLowerCase() === "utm_source" || SIGNED_QUERY_PARAMETER.test(name))
  )
    return address;
  url.search = url.search ? `${url.search}&${OPENBOT_SOURCE_QUERY}` : `?${OPENBOT_SOURCE_QUERY}`;
  return url.toString();
}

function publicHostname(hostname: string): boolean {
  const name = hostname.toLowerCase();
  return (
    name.includes(".") &&
    !name.startsWith("[") &&
    !/^\d+(\.\d+){3}$/.test(name) &&
    !PRIVATE_HOST_SUFFIXES.some((suffix) => name.endsWith(suffix))
  );
}
