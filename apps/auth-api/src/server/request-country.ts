export function requestCountry(request: Request): string | undefined {
  const header = request.headers.get("cf-ipcountry");
  if (header) return header;
  const cf = "cf" in request ? request.cf : undefined;
  return typeof cf === "object" && cf !== null && "country" in cf && typeof cf.country === "string"
    ? cf.country
    : undefined;
}
