import { useText } from "@openbot/ui/text";
import { createMemo, For, Show } from "solid-js";

/** Above this many cells (changed old lines times changed new lines), the view shows a plain replace. */
const LCS_CELL_LIMIT = 4_000_000;

export interface DiffRow {
  kind: "same" | "added" | "removed";
  text: string;
  oldLine: number | null;
  newLine: number | null;
}

/** A line diff of two texts, by longest common subsequence after the shared start and end are cut off. */
export function diffLines(oldText: string, newText: string): DiffRow[] {
  // An empty text has no lines, so a new file shows only added lines.
  const before = oldText === "" ? [] : oldText.split("\n");
  const after = newText === "" ? [] : newText.split("\n");
  let start = 0;
  while (start < before.length && start < after.length && before[start] === after[start]) start++;
  let endBefore = before.length;
  let endAfter = after.length;
  while (endBefore > start && endAfter > start && before[endBefore - 1] === after[endAfter - 1]) {
    endBefore--;
    endAfter--;
  }
  const rows: DiffRow[] = [];
  const same = (from: number, to: number, offset: number) => {
    for (let index = from; index < to; index++) {
      rows.push({ kind: "same", text: before[index] ?? "", oldLine: index + 1, newLine: index + offset + 1 });
    }
  };
  same(0, start, 0);
  const oldPart = before.slice(start, endBefore);
  const newPart = after.slice(start, endAfter);
  const n = oldPart.length;
  const m = newPart.length;
  if (n * m > LCS_CELL_LIMIT) {
    for (const [index, text] of oldPart.entries()) {
      rows.push({ kind: "removed", text, oldLine: start + index + 1, newLine: null });
    }
    for (const [index, text] of newPart.entries()) {
      rows.push({ kind: "added", text, oldLine: null, newLine: start + index + 1 });
    }
  } else {
    // lengths[i * (m + 1) + j] is the LCS length of oldPart[i..] and newPart[j..].
    const lengths = new Uint32Array((n + 1) * (m + 1));
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        lengths[i * (m + 1) + j] =
          oldPart[i] === newPart[j]
            ? (lengths[(i + 1) * (m + 1) + j + 1] ?? 0) + 1
            : Math.max(lengths[(i + 1) * (m + 1) + j] ?? 0, lengths[i * (m + 1) + j + 1] ?? 0);
      }
    }
    let i = 0;
    let j = 0;
    // On a tie the removed line comes first, as in a unified diff.
    while (i < n || j < m) {
      if (i < n && j < m && oldPart[i] === newPart[j]) {
        rows.push({ kind: "same", text: oldPart[i] ?? "", oldLine: start + i + 1, newLine: start + j + 1 });
        i++;
        j++;
      } else if (j < m && (i === n || (lengths[i * (m + 1) + j + 1] ?? 0) > (lengths[(i + 1) * (m + 1) + j] ?? 0))) {
        rows.push({ kind: "added", text: newPart[j] ?? "", oldLine: null, newLine: start + j + 1 });
        j++;
      } else {
        rows.push({ kind: "removed", text: oldPart[i] ?? "", oldLine: start + i + 1, newLine: null });
        i++;
      }
    }
  }
  same(endBefore, before.length, endAfter - endBefore);
  return rows;
}

export interface DiffViewProps {
  /** The file name, shown in the header. */
  name: string;
  oldText: string;
  newText: string;
}

/** The changes between two versions of a text file, as one column with added and removed lines. */
export function DiffView(props: DiffViewProps) {
  const { t } = useText();
  const rows = createMemo(() => diffLines(props.oldText, props.newText));
  const added = () => rows().filter((row) => row.kind === "added").length;
  const removed = () => rows().filter((row) => row.kind === "removed").length;

  return (
    <section class="diff-view" aria-label={t("preview.diff.label", { name: props.name })}>
      <header class="diff-view-header">
        <span class="diff-view-name">{props.name}</span>
        <span class="diff-view-count" data-diff="added">
          {t("preview.diff.added", { count: added() })}
        </span>
        <span class="diff-view-count" data-diff="removed">
          {t("preview.diff.removed", { count: removed() })}
        </span>
      </header>
      <Show when={added() + removed() > 0} fallback={<p class="diff-view-empty">{t("preview.diff.noChanges")}</p>}>
        <pre class="diff-view-lines" dir="ltr">
          <For each={rows()}>
            {(row) => (
              <span class="diff-view-row" data-diff={row.kind}>
                <span class="diff-view-number" aria-hidden="true">
                  {row.oldLine ?? ""}
                </span>
                <span class="diff-view-number" aria-hidden="true">
                  {row.newLine ?? ""}
                </span>
                <span class="diff-view-text">{row.text}</span>
              </span>
            )}
          </For>
        </pre>
      </Show>
    </section>
  );
}
