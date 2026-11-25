import { Dynamic, type JSX } from "@solidjs/web";
import { createEffect, createMemo, For, Show } from "solid-js";
import { ScrollEdges } from "../../components/ScrollEdges";
import { useText } from "../../text";
import { parseWordDocument, type WordBlock, type WordRun, type WordTableRow } from "./word-document";

export interface WordFilePreviewProps {
  bytes: Uint8Array | null;
  loading?: boolean;
  error?: string | null;
  class?: string;
  onTruncatedChange: (truncated: boolean) => void;
}

function styledRun(run: WordRun): JSX.Element {
  let content: JSX.Element = run.text;
  if (run.strike) content = <del>{content}</del>;
  if (run.underline) content = <u>{content}</u>;
  if (run.italic) content = <em>{content}</em>;
  if (run.bold) content = <strong>{content}</strong>;
  return content;
}

function WordRuns(props: { runs: WordRun[] }) {
  return <For each={props.runs}>{(run) => styledRun(run)}</For>;
}

function tableColumns(rows: WordTableRow[]): number {
  return Math.max(1, ...rows.map((row) => row.cells.reduce((total, cell) => total + cell.columnSpan, 0)));
}

function tableCellContent(paragraphs: WordRun[][]): JSX.Element {
  return (
    <For each={paragraphs}>
      {(paragraph) => (
        <div class="file-preview-document-line">
          <WordRuns runs={paragraph} />
        </div>
      )}
    </For>
  );
}

function tableRow(row: WordTableRow): JSX.Element {
  return (
    <tr>
      <For each={row.cells}>
        {(cell) => {
          if (row.header) return <th colspan={cell.columnSpan}>{tableCellContent(cell.paragraphs)}</th>;
          return <td colspan={cell.columnSpan}>{tableCellContent(cell.paragraphs)}</td>;
        }}
      </For>
    </tr>
  );
}

function WordTable(props: { rows: WordTableRow[] }) {
  const { t } = useText();
  const columns = `--message-markdown-table-columns: ${tableColumns(props.rows)}`;
  return (
    <ScrollEdges
      axis="x"
      class="message-table-frame message-markdown-table-frame"
      viewClass="message-markdown-table-scroll"
      label={t("chat.table.data")}
    >
      <table class="message-markdown-table" style={columns}>
        <tbody>
          <For each={props.rows}>{(row) => tableRow(row)}</For>
        </tbody>
      </table>
    </ScrollEdges>
  );
}

function listItems(items: WordRun[][]): JSX.Element {
  return (
    <For each={items}>
      {(item) => (
        <li class="file-preview-document-line">
          <WordRuns runs={item} />
        </li>
      )}
    </For>
  );
}

function blockElement(block: WordBlock): JSX.Element {
  switch (block.kind) {
    case "heading": {
      const tag = `h${block.level}`;
      return (
        <Dynamic
          component={tag}
          class="message-markdown-heading file-preview-document-line"
          data-level={block.level}
          dir="auto"
        >
          <WordRuns runs={block.runs} />
        </Dynamic>
      );
    }
    case "paragraph":
      return (
        <p class="file-preview-document-line" dir="auto">
          <WordRuns runs={block.runs} />
        </p>
      );
    case "list":
      if (block.ordered) return <ol dir="auto">{listItems(block.items)}</ol>;
      return <ul dir="auto">{listItems(block.items)}</ul>;
    case "table":
      return <WordTable rows={block.rows} />;
  }
}

export function WordFilePreview(props: WordFilePreviewProps) {
  const { t } = useText();
  const parsed = createMemo(() => {
    if (props.loading || props.error || !props.bytes) return null;
    try {
      return parseWordDocument(props.bytes);
    } catch {
      return null;
    }
  });
  const blocks = () => parsed()?.blocks ?? [];
  createEffect(
    () => parsed()?.truncated === true,
    (truncated) => {
      props.onTruncatedChange(truncated);
    },
  );
  const status = () => {
    if (props.loading) return t("common.loading");
    if (props.error) return props.error;
    if (props.bytes) return t("preview.document.readFailed");
    return t("preview.unavailable");
  };

  return (
    <div class={`word-file-preview${props.class ? ` ${props.class}` : ""}`}>
      <Show when={parsed()} fallback={<pre class="file-preview-markdown-status">{status()}</pre>}>
        <article class="message-markdown">
          <Show when={blocks().length > 0} fallback={<p>{t("preview.document.empty")}</p>}>
            <For each={blocks()}>{(block) => blockElement(block)}</For>
          </Show>
        </article>
      </Show>
    </div>
  );
}
