import { type BrowserWindow, dialog, type OpenDialogOptions } from "electron";

let picking = false;

export async function pickFolder(
  parent: BrowserWindow | null,
  options: OpenDialogOptions,
): Promise<string | undefined> {
  if (picking) return undefined;
  picking = true;
  const result = await (parent ? dialog.showOpenDialog(parent, options) : dialog.showOpenDialog(options)).finally(
    () => {
      picking = false;
    },
  );
  return result.canceled ? undefined : result.filePaths[0];
}
