import { createContext, type PropsWithChildren, useContext } from "react";
import { useCSSVariable } from "uniwind";
import { mixColor } from "@/features/settings/model/message-color";

const SolidSurfaceContext = createContext<string | undefined>(undefined);

export function ChatSolidSurfaceProvider({ surface, children }: PropsWithChildren<{ surface: string | undefined }>) {
  return <SolidSurfaceContext.Provider value={surface}>{children}</SolidSurfaceContext.Provider>;
}

export function useSolidChatFill(share: number): string | undefined {
  const surface = useContext(SolidSurfaceContext);
  const control = String(useCSSVariable("--openbot-bg-control") ?? "");
  if (surface === undefined) return undefined;
  return mixColor(surface, control, share) ?? control;
}
