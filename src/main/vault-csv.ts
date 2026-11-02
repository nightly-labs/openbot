// Reads the logins of a password export in CSV format: Chrome, Edge, Safari, Firefox, 1Password,
// Bitwarden and LastPass all write a header row that names the address, user name and password columns.

import { sourceText } from "@openbot/i18n/source";

export interface CsvLogin {
  website: string;
  username: string;
  password: string;
  notes: string;
}

const COLUMNS = {
  website: ["url", "login_uri", "website", "uri", "web site"],
  username: ["username", "login_username", "user name", "login", "email"],
  password: ["password", "login_password"],
  notes: ["notes", "note", "extra", "comments"],
  type: ["type"],
} as const;

/** RFC 4180 rows: quoted fields may hold commas, line breaks and doubled quotes. */
function parseRows(source: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const text = source.startsWith("﻿") ? source.slice(1) : source;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"' && field === "") quoted = true;
    else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[index + 1] === "\n") index += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += char;
  }
  if (quoted) throw new Error(sourceText("error.vault.csvInvalid"));
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((cells) => cells.some((cell) => cell.trim()));
}

/** The logins in `source`. A row of another kind, such as a Bitwarden card or note, is left out. */
export function parseLoginCsv(source: string): { logins: CsvLogin[]; otherRows: number } {
  const [header, ...rows] = parseRows(source);
  if (!header) throw new Error(sourceText("error.vault.csvInvalid"));
  const names = header.map((name) => name.trim().toLowerCase());
  const column = (choices: readonly string[]) => names.findIndex((name) => choices.includes(name));
  const website = column(COLUMNS.website);
  const password = column(COLUMNS.password);
  if (website < 0 || password < 0) throw new Error(sourceText("error.vault.csvInvalid"));
  const username = column(COLUMNS.username);
  const notes = column(COLUMNS.notes);
  const type = column(COLUMNS.type);
  const logins: CsvLogin[] = [];
  let otherRows = 0;
  for (const cells of rows) {
    if (type >= 0 && cells[type]?.trim() && cells[type]?.trim().toLowerCase() !== "login") {
      otherRows += 1;
      continue;
    }
    logins.push({
      website: cells[website]?.trim() ?? "",
      username: username < 0 ? "" : (cells[username]?.trim() ?? ""),
      password: cells[password] ?? "",
      notes: notes < 0 ? "" : (cells[notes]?.trim() ?? ""),
    });
  }
  return { logins, otherRows };
}
