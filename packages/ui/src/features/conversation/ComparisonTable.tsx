import type { JSX } from "@solidjs/web";
import { For } from "solid-js";
import { ScrollEdges } from "../../components/ScrollEdges";
import { firstTextDirection } from "../../content-direction";
import { useText } from "../../text";
import type { ComparisonTableBlock } from "./DataTable";

export function ComparisonTable(props: {
  table: ComparisonTableBlock;
  renderCell?: (text: string) => JSX.Element;
  selectionMessageId?: string | undefined;
}) {
  const { t } = useText();
  return (
    <ScrollEdges
      axis="x"
      class="message-table-frame"
      viewClass="message-data-table-scroll message-comparison-table-scroll"
      label={t("chat.table.comparison")}
    >
      <table
        class="message-data-table message-comparison-table"
        style={`--message-data-table-columns: ${props.table.headers.length}`}
        data-selection-message-id={props.selectionMessageId}
        dir={firstTextDirection([...props.table.headers, ...props.table.rows.flat()])}
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
    </ScrollEdges>
  );
}
