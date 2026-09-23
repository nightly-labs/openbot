/** How far one file of a sending message is, from 0 to 1. Files upload one at a time, in order. */
export function uploadProgressAt(index: number, completed: number, current: number) {
  if (index < completed) return 1;
  return index === completed ? Math.min(Math.max(current, 0), 1) : 0;
}
