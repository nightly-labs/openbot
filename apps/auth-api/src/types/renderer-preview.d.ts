declare module "@openbot/renderer-preview" {
  import type { JSX } from "@solidjs/web";

  export interface OpenBotPlaygroundProps {
    variant?: "default" | "landing";
    theme?: "dark" | "light";
  }

  export function OpenBotPlayground(props: OpenBotPlaygroundProps): JSX.Element;
}
