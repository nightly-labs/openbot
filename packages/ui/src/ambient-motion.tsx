import type { JSX } from "@solidjs/web";
import { createContext, useContext } from "solid-js";

const AmbientMotionContext = createContext<() => boolean>(() => true);

export function AmbientMotion(props: { when: boolean; children: JSX.Element }): JSX.Element {
  return <AmbientMotionContext value={() => props.when}>{props.children}</AmbientMotionContext>;
}

export function useAmbientMotion(): () => boolean {
  return useContext(AmbientMotionContext);
}
