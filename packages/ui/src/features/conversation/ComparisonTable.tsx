import type { JSX } from "@solidjs/web";
import { For } from "solid-js";
import { useText } from "../../text";
import type { ComparisonTableBlock } from "./DataTable";

export function ComparisonTable(props: { table: ComparisonTableBlock; renderCell?: (text: string) => JSX.Element }) {
  const { t } = useText();
  return (
    <section
      class="message-data-table-scroll message-comparison-table-scroll"
      aria-label={t("chat.table.comparison")}
      tabindex="0"
    >
      <table
        class="message-data-table message-comparison-table"
        style={`--message-data-table-columns: ${props.table.headers.length}`}
      >
        <thead>
          <tr>
            <For each={props.table.headers}>
              {(header) => <th scope="col">{props.renderCell?.(header) ?? header}</th>}
            </For>
          </tr>
        </thead>
        <tbody>
          <For each={props.table.rows}>
            {(row) => (
              <tr>
                <For each={row}>
                  {(cell, index) => (
                    <td>
                      {index() === 0 ? (
                        (props.renderCell?.(cell) ?? cell)
                      ) : (
                        <span class={cell === "✓" ? "message-comparison-table-yes" : "message-comparison-table-no"}>
                          {cell}
                        </span>
                      )}
                    </td>
                  )}
                </For>
              </tr>
            )}
          </For>
        </tbody>
      </table>
    </section>
  );
}
