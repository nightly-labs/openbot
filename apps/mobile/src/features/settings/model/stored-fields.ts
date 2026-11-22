export function storedFields(stored: string | null): Map<string, unknown> | null {
  let value: unknown = null;
  try {
    value = stored === null ? null : JSON.parse(stored);
  } catch {
    return null;
  }
  return typeof value === "object" && value !== null ? new Map<string, unknown>(Object.entries(value)) : null;
}
