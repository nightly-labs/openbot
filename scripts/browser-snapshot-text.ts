import type { DynamicRecord } from "@openbot/contracts/runtime-values";
import { z } from "zod";

/**
 * Parses the JSON text of a browser tool result. A snapshot in that text gives each element as one
 * line; this reads each line back into a record with the fields that the line holds.
 */
export function parseBrowserToolText(text: string) {
  return z
    .json()
    .parse(
      JSON.parse(text, (key, value: unknown) =>
        key === "elements" && Array.isArray(value) && value.every((line) => typeof line === "string")
          ? value.map(parseElementLine)
          : value,
      ),
    );
}

const jsonString = (token: string) => z.string().parse(JSON.parse(token));

/**
 * `ref [role] "name" [<tag>] [value="…"] [description="…"] [state:value…] [bounds=x,y,w,h]
 * [frame=id frameUrl="…"]`. A tag that the role implies is not in the line, so the record has no tag.
 */
function parseElementLine(line: string): DynamicRecord {
  const tokens = lineTokens(line);
  const [ref = "", second = ""] = tokens;
  const role = second.startsWith('"') ? null : second;
  const rest = tokens.slice(role === null ? 1 : 2);
  const name = jsonString(rest.shift() ?? '""');
  let tag: string | undefined;
  let value: string | null = null;
  let description = "";
  let bounds: DynamicRecord | null = null;
  let frameId: string | null = null;
  let frameUrl = "";
  const states: string[] = [];
  for (const token of rest) {
    if (token.startsWith("<") && token.endsWith(">")) tag = token.slice(1, -1);
    else if (token.startsWith("value=")) value = jsonString(token.slice(6));
    else if (token.startsWith("description=")) description = jsonString(token.slice(12));
    else if (token.startsWith("bounds=")) {
      const [x, y, width, height] = token.slice(7).split(",").map(Number);
      bounds = { x, y, width, height };
    } else if (token.startsWith("frame=")) frameId = token.slice(6);
    else if (token.startsWith("frameUrl=")) frameUrl = jsonString(token.slice(9));
    else states.push(token);
  }
  return {
    ref,
    role,
    name,
    ...(tag === undefined ? {} : { tag }),
    description,
    value,
    states,
    disabled: states.includes("disabled:true"),
    bounds,
    frame: frameId === null ? null : { id: frameId, url: frameUrl },
  };
}

/** Splits at spaces outside JSON strings. */
function lineTokens(line: string): string[] {
  const tokens: string[] = [];
  let start = -1;
  let quoted = false;
  for (let index = 0; index <= line.length; index++) {
    const character = line[index];
    if (start < 0) {
      if (character !== " " && character !== undefined) start = index;
      if (character === '"') quoted = true;
      continue;
    }
    if (quoted) {
      if (character === "\\") index++;
      else if (character === '"') quoted = false;
      continue;
    }
    if (character === '"') quoted = true;
    else if (character === " " || character === undefined) {
      tokens.push(line.slice(start, index));
      start = -1;
    }
  }
  return tokens;
}
