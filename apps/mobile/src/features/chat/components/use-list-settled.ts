import { useAdaptiveRender } from "@legendapp/list/react-native";
import { useState } from "react";

export function useListSettled(): boolean {
  const light = useAdaptiveRender() === "light";
  const [settled, setSettled] = useState(!light);
  if (settled || light) return settled;
  setSettled(true);
  return true;
}
