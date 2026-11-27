export function tableCsv(rows: readonly (readonly string[])[]): string {
  return rows
    .map((cells) => cells.map((cell) => (/[",\r\n]/u.test(cell) ? `"${cell.replaceAll('"', '""')}"` : cell)).join(","))
    .join("\n");
}
