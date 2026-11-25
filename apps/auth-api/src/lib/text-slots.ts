export const slot = (name: string) => `${name}`;
const SLOT_PATTERN = /([^]*)/;

export function slotted<Value>(text: string, values: Readonly<Record<string, Value>>): (string | Value)[] {
  const parts: (string | Value)[] = [];
  let rest = text;
  for (let match = SLOT_PATTERN.exec(rest); match; match = SLOT_PATTERN.exec(rest)) {
    if (match.index > 0) parts.push(rest.slice(0, match.index));
    const name = match[1] ?? "";
    const value = Object.hasOwn(values, name) ? values[name] : undefined;
    parts.push(value === undefined ? name : value);
    rest = rest.slice(match.index + match[0].length);
  }
  if (rest) parts.push(rest);
  return parts;
}
