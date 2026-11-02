import { useAdaptiveRender } from "@legendapp/list/react-native";
import { useState } from "react";

/**
 * False while a row mounts during a fast fling of the chat list, and true from the first moment the
 * list is not in one. A row waits with its expensive parts, such as a page preview, a video download
 * or code colours, and keeps them after that. Outside a list it is always true.
 *
 * The component that calls it renders again when a fling starts or ends, so keep it small and pass
 * the result to a memoized child.
 */
export function useListSettled(): boolean {
  const light = useAdaptiveRender() === "light";
  const [settled, setSettled] = useState(!light);
  if (settled || light) return settled;
  setSettled(true);
  return true;
}
