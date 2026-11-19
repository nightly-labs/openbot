import { createMemo, Show } from "solid-js";

/** Lower case, no accents, and `_`, `/` and `-` as spaces: "cafe" finds "Café Orders". */
const foldChar = (char: string) =>
  char
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[\s_/-]/g, " ");

/**
 * The folded text, and for each of its code units the index of the character in `text` that made
 * it. Folding can change the length, so this map finds the matched part in the original name.
 * A run of spaces and separators becomes one space: "Sales - EU" is "sales eu".
 */
function foldName(text: string) {
  let folded = "";
  const source: number[] = [];
  let index = 0;
  for (const char of text) {
    const raw = foldChar(char);
    const part = raw === " " && folded.endsWith(" ") ? "" : raw;
    folded += part;
    for (let unit = 0; unit < part.length; unit++) source.push(index);
    index += char.length;
  }
  return { folded, source };
}

/** Where `query` is in `name`, and its rank: 0 at the start, 1 at the start of a word, 2 in a word. */
function findMatch(name: string, query: string): { at: number; rank: number } | undefined {
  if (name.startsWith(query)) return { at: 0, rank: 0 };
  const first = name.indexOf(query);
  for (let at = first; at > 0; at = name.indexOf(query, at + 1)) {
    if (name[at - 1] === " ") return { at, rank: 1 };
  }
  return first < 0 ? undefined : { at: first, rank: 2 };
}

/**
 * How well `name` fits the search: 0 when it starts with the query, 1 when a word does, 2 when it
 * only contains it. undefined when it does not match. An empty query matches each name at rank 0.
 */
export function nameRank(name: string, query: string): number | undefined {
  const text = foldName(query.trim()).folded;
  if (!text) return 0;
  return findMatch(foldName(name).folded, text)?.rank;
}

/** The items whose name matches. Names that start with the query, or have a word that does, come first. */
export function matchByName<T>(items: readonly T[], nameOf: (item: T) => string, query: string): T[] {
  if (!foldName(query.trim()).folded) return [...items];
  return items
    .flatMap((item) => {
      const rank = nameRank(nameOf(item), query);
      return rank === undefined ? [] : [{ item, rank }];
    })
    .sort((a, b) => a.rank - b.rank)
    .map((row) => row.item);
}

/** The name with the matched part in bold, so the eye finds why a row is in the list. */
export function MatchedName(props: { name: string; query: string; class?: string }) {
  const parts = createMemo(() => {
    const text = foldName(props.query.trim()).folded;
    const name = foldName(props.name);
    const match = text ? findMatch(name.folded, text) : undefined;
    if (!match) return { before: props.name, match: "", after: "" };
    const start = name.source[match.at] ?? 0;
    const end = name.source[match.at + text.length] ?? props.name.length;
    return {
      before: props.name.slice(0, start),
      match: props.name.slice(start, end),
      after: props.name.slice(end),
    };
  });
  return (
    <span class={props.class}>
      {parts().before}
      <Show when={parts().match}>
        <b>{parts().match}</b>
      </Show>
      {parts().after}
    </span>
  );
}
