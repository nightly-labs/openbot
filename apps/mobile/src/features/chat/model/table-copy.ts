/** Rows as CSV (RFC 4180), as the desktop table copies them: a cell with a comma, a quote or a line break goes in quotes. */
export function tableCsv(rows: readonly (readonly string[])[]): string {
  return rows
    .map((cells) => cells.map((cell) => (/[",\r\n]/u.test(cell) ? `"${cell.replaceAll('"', '""')}"` : cell)).join(","))
    .join("\n");
}
