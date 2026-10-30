import {
  parseSpreadsheet,
  SPREADSHEET_MAX_COLUMNS,
  SPREADSHEET_MAX_ROWS,
} from "@openbot/contracts/spreadsheet-workbook";
import { Button } from "@openbot/ui";
import { useText } from "@openbot/ui/text";
import { createMemo, createSignal, For, Show } from "solid-js";

export interface SpreadsheetFilePreviewProps {
  bytes: Uint8Array | null;
  loading?: boolean;
  error?: string | null;
  class?: string;
}

export function SpreadsheetFilePreview(props: SpreadsheetFilePreviewProps) {
  const { t, format } = useText();
  const parsed = createMemo(() => {
    if (props.loading || props.error || !props.bytes) return null;
    try {
      return parseSpreadsheet(props.bytes, format);
    } catch {
      return null;
    }
  });
  const parseError = () =>
    !props.loading && !props.error && props.bytes && !parsed() ? t("preview.spreadsheet.readFailed") : null;

  return (
    <div class={`spreadsheet-file-preview${props.class ? ` ${props.class}` : ""}`}>
      <Show
        when={parsed()}
        fallback={
          <pre class="file-preview-spreadsheet-status">
            {props.loading ? t("common.loading") : (props.error ?? parseError() ?? t("preview.unavailable"))}
          </pre>
        }
      >
        {(workbook) => {
          const [activeSheet, setActiveSheet] = createSignal(0);
          const sheet = () => workbook().sheets[activeSheet()] ?? workbook().sheets[0];
          return (
            <>
              <Show when={workbook().sheets.length > 1}>
                <div class="file-preview-spreadsheet-tabs">
                  <For each={workbook().sheets}>
                    {(current, index) => (
                      <Button
                        variant="outline"
                        type="button"
                        aria-pressed={activeSheet() === index() ? "true" : "false"}
                        data-cuelume-tap="select"
                        onClick={() => setActiveSheet(index())}
                      >
                        {current.name}
                      </Button>
                    )}
                  </For>
                </div>
              </Show>
              <div class="file-preview-spreadsheet-table-wrap">
                <table class="file-preview-spreadsheet-table">
                  <caption>{sheet()?.name}</caption>
                  <Show when={sheet()?.rows[0]}>
                    {(header) => (
                      <thead>
                        <tr>
                          <For each={header()}>{(value) => <th scope="col">{value}</th>}</For>
                        </tr>
                      </thead>
                    )}
                  </Show>
                  <tbody>
                    <For each={sheet()?.rows.slice(1)}>
                      {(row) => (
                        <tr>
                          <For each={row}>{(value) => <td>{value}</td>}</For>
                        </tr>
                      )}
                    </For>
                  </tbody>
                </table>
              </div>
              <Show when={workbook().truncated}>
                <p class="file-preview-spreadsheet-note">
                  {t("preview.spreadsheet.truncated", {
                    rows: format.number(SPREADSHEET_MAX_ROWS),
                    columns: format.number(SPREADSHEET_MAX_COLUMNS),
                  })}
                </p>
              </Show>
            </>
          );
        }}
      </Show>
    </div>
  );
}
