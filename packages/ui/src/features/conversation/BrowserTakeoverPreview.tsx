import type { BrowserPreview } from "@openbot/contracts/ipc";
import { Monitor, Skeleton } from "@openbot/ui";
import { Show } from "solid-js";

export function BrowserTakeoverPreview(props: {
  preview: BrowserPreview | null;
  previewStatus: "idle" | "loading" | "ready" | "failed";
  page: { title: string; host: string };
}) {
  return (
    <Show
      when={props.previewStatus === "ready" ? props.preview : null}
      fallback={
        <Show
          when={props.previewStatus === "loading" || props.previewStatus === "idle"}
          fallback={
            <div class="browser-takeover-preview-fallback">
              <Monitor aria-hidden="true" />
              <strong>{props.page.title}</strong>
              <span>{props.page.host}</span>
            </div>
          }
        >
          <Skeleton class="browser-takeover-preview-skeleton" />
        </Show>
      }
    >
      {(preview) => (
        <img
          src={preview().dataUrl}
          width={preview().width}
          height={preview().height}
          alt={`Preview of ${props.page.title}`}
        />
      )}
    </Show>
  );
}
