export interface ComputerUseAgentCursorProps {
  /** Where the tip points, in the overlay's own pixels. */
  x: number;
  y: number;
}

/**
 * The agent cursor OpenBot draws itself.
 *
 * The driver draws one of its own, over the main screen and at the desktop's coordinates inside it,
 * so on a desktop of more than one display it lands as far from the work as that screen's origin is
 * from the desktop's. OpenBot then asks the driver for no cursor and draws this one instead, in the
 * overlay that already covers every display, where one set of coordinates holds everywhere.
 *
 * It is the same dart the OpenBot driver theme draws: a shape no desktop pointer has, because the
 * one thing it has to say is that something other than the user is driving this computer.
 *
 * It is decoration for a screen reader. The rim around the window carries the announcement, and a
 * point that moves with every click would otherwise interrupt the user many times a second.
 */
export function ComputerUseAgentCursor(props: ComputerUseAgentCursorProps) {
  return (
    <svg
      class="computer-use-agent-cursor"
      style={{ translate: `${props.x}px ${props.y}px` }}
      viewBox="0 0 45 49"
      aria-hidden="true"
    >
      {/*
       * The dart of the driver theme, corner for corner, with its tip on the origin: the tip is
       * the point the agent asked for, so nothing here is offset from it.
       *
       * The white stroke is drawn under the fill, which is what keeps the shape readable on a dark
       * window and on a light one without a second path.
       */}
      <path d="M0 0 L45 20 L27 31 L14 49 Z" stroke-linejoin="round" stroke-linecap="round" />
    </svg>
  );
}
