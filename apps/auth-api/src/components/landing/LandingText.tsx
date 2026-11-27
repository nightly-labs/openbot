import type { JSX } from "@solidjs/web";
import { createContext, type ParentProps, useContext } from "solid-js";
import type { LandingPageText } from "../../lib/landing-page-text";

const LandingTextContext = createContext<(() => LandingPageText) | null>(null, { name: "LandingText" });

export function LandingTextProvider(props: ParentProps<{ text: LandingPageText }>): JSX.Element {
  return <LandingTextContext value={() => props.text}>{props.children}</LandingTextContext>;
}

export function useLandingText(): () => LandingPageText {
  const text = useContext(LandingTextContext);
  if (!text) throw new Error("The landing text is not loaded.");
  return text;
}
