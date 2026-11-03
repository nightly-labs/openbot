/**
 * The folder picker for an agent on another computer. The native picker shows only this computer, so
 * this dialog lists the folders of the host one folder at a time, as the mobile app does: the folder
 * names, a step up, the home folder and the disks. Files and hidden folders are not in the list.
 */

import { type AgentFolderBrowse, agentFolderName } from "@openbot/contracts/ipc";
import { ArrowUp, Button, Dialog, Folder, HardDrive, IconButton, X } from "@openbot/ui";
import { createEffect, createSignal, For, Show } from "solid-js";
import { useText } from "../../text";

/** What the picked folder is for. Locate puts it in the place of a folder that is gone. */
export type HostFolderPickMode = "add" | "exclude" | "locate";

export interface HostFolderPick {
  mode: HostFolderPickMode;
  agentName: string;
  /** The folder to open first. Null, or a folder that the host cannot open, opens the home folder. */
  start: string | null;
}

export function HostFolderPicker(props: {
  /** The open request. Null closes the dialog. */
  request: HostFolderPick | null;
  /** Lists the folders in one host folder. Null lists the home folder. */
  browse: (path: string | null) => Promise<AgentFolderBrowse>;
  /** The picked folder, or null when the user closes the dialog. */
  onDone: (path: string | null) => void;
}) {
  const { t, errorMessage } = useText();
  const [listing, setListing] = createSignal<AgentFolderBrowse | null>(null);
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  let request = 0;

  function open(path: string | null, fallbackHome: boolean): void {
    const id = ++request;
    setLoading(true);
    setError(null);
    props
      .browse(path)
      .then((next) => {
        if (id !== request) return;
        setListing(next);
        setLoading(false);
      })
      .catch((failure: unknown) => {
        if (id !== request) return;
        // A start folder can be gone, such as the folder of a Locate. The home folder is the next place.
        if (fallbackHome && path !== null) return open(null, false);
        setLoading(false);
        setError(errorMessage(failure, t("agentSettings.folders.browse.failed")));
      });
  }

  // Each new request opens at its own start folder; the folder list of the request before goes.
  createEffect(
    () => props.request,
    (pick) => {
      setListing(null);
      setError(null);
      if (pick) open(pick.start, true);
      else ++request;
    },
  );

  const title = () => {
    const pick = props.request;
    if (!pick) return "";
    return pick.mode === "exclude"
      ? t("dialog.chooseAgentExclusion", { agent: pick.agentName })
      : t("dialog.chooseAgentFolder", { agent: pick.agentName });
  };
  const chooseLabel = () => {
    switch (props.request?.mode) {
      case "exclude":
        return t("agentSettings.folders.browse.exclude");
      case "locate":
        return t("agentSettings.folders.browse.locate");
      default:
        return t("agentSettings.folders.browse.add");
    }
  };

  return (
    <Dialog.Root
      open={props.request !== null}
      onOpenChange={(next) => {
        if (!next) props.onDone(null);
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay class="custom-provider-backdrop provider-more-backdrop">
          <Dialog.Content as="section" class="custom-provider-dialog provider-more-dialog host-folder-picker">
            <header class="provider-more-header">
              <Dialog.Title as="h2" class="provider-more-title">
                {title()}
              </Dialog.Title>
              <IconButton label={t("common.close")} variant="ghost" onClick={() => props.onDone(null)}>
                <X />
              </IconButton>
            </header>
            <Show when={listing()}>
              {(place) => (
                <>
                  <nav class="host-folder-picker-places" aria-label={t("agentSettings.folders.browse.places")}>
                    <Button variant="outline" size="xs" onClick={() => open(place().home, false)}>
                      <Folder aria-hidden="true" />
                      {t("agentSettings.folders.browse.home")}
                    </Button>
                    <For each={place().volumes} keyed={(volume) => volume.path}>
                      {(volume) => (
                        <Button variant="outline" size="xs" onClick={() => open(volume().path, false)}>
                          <HardDrive aria-hidden="true" />
                          {volume().name}
                        </Button>
                      )}
                    </For>
                  </nav>
                  <p class="host-folder-picker-path" title={place().path}>
                    {place().path}
                  </p>
                </>
              )}
            </Show>
            <div class="provider-more-list" aria-busy={loading() ? "true" : "false"}>
              <Show when={listing()?.parentPath}>
                {(parent) => (
                  <Button variant="ghost" class="provider-more-row" onClick={() => open(parent(), false)}>
                    <ArrowUp aria-hidden="true" />
                    <span class="provider-picker-name">
                      {t("agentSettings.folders.browse.parent", { folder: agentFolderName(parent()) })}
                    </span>
                  </Button>
                )}
              </Show>
              <For each={listing()?.entries ?? []} keyed={(entry) => entry.path}>
                {(entry) => (
                  <Button variant="ghost" class="provider-more-row" onClick={() => open(entry().path, false)}>
                    <Folder aria-hidden="true" />
                    <span class="provider-picker-name">{entry().name}</span>
                  </Button>
                )}
              </For>
              <Show when={listing()?.entries.length === 0}>
                <p class="host-folder-picker-note">{t("agentSettings.folders.browse.empty")}</p>
              </Show>
              <Show when={listing()?.truncated && listing()}>
                {(place) => (
                  <p class="host-folder-picker-note">
                    {t("agentSettings.folders.browse.truncated", { count: place().entries.length })}
                  </p>
                )}
              </Show>
              <Show when={error()}>{(message) => <p class="host-folder-picker-note">{message()}</p>}</Show>
            </div>
            <footer class="host-folder-picker-footer">
              <Button variant="ghost" onClick={() => props.onDone(null)}>
                {t("common.cancel")}
              </Button>
              <Button
                disabled={loading() || !listing()}
                onClick={() => {
                  const place = listing();
                  if (place) props.onDone(place.path);
                }}
              >
                {chooseLabel()}
              </Button>
            </footer>
          </Dialog.Content>
        </Dialog.Overlay>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
