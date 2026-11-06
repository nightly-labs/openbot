import type { JSX } from "@solidjs/web";
import { createContext, type ParentProps, useContext } from "solid-js";
import type { LandingPageText } from "../../lib/landing-page-text";

const LandingTextContext = createContext<(() => LandingPageText) | null>(null, { name: "LandingText" });

/** Gives the sections of the home page their text, in the language of the route. */
export function LandingTextProvider(props: ParentProps<{ text: LandingPageText }>): JSX.Element {
  return <LandingTextContext value={() => props.text}>{props.children}</LandingTextContext>;
}

/** The text of the home page. Use it inside `LandingTextProvider`. */
export function useLandingText(): () => LandingPageText {
  const text = useContext(LandingTextContext);
  if (!text) throw new Error("The landing text is not loaded.");
  return text;
}
