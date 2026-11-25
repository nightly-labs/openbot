import type { JSX } from "@solidjs/web";
import { createEffect } from "solid-js";
import { ComposerNotice } from "./ComposerNotice";

export function ComposerErrorBanner(props: {
  message: string;
  title?: string | undefined;
  tone?: "warning" | "danger";
  reference?: string | null | undefined;
  onShown?: () => void;
  conversationKey?: string | null;
  onDismiss: () => void;
  action?: JSX.Element;
}): JSX.Element {
  createEffect(
    () => `${props.conversationKey ?? ""}\u0000${props.message}`,
    () => props.onShown?.(),
  );
  return (
    <ComposerNotice
      tone={props.tone ?? "danger"}
      title={props.title}
      body={props.message}
      reference={props.reference}
      conversationKey={props.conversationKey}
      action={props.action}
      onDismiss={() => props.onDismiss()}
    />
  );
}
