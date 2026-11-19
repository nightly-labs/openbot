export function chatContentIsVisible(content: number, viewport: number, scrollY: number, obstruction: number): boolean {
  "worklet";
  return content <= scrollY + viewport - obstruction + 2;
}
