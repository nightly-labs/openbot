/**
 * The art of the Draw, Sticky note and Shapes tools in the canvas tool bar. Each picture stands in
 * the bar: the pen stands on the bar and the bar cuts its foot, and the notes and the shapes sit in
 * the centre of the button. The viewBox of each picture puts its layers there. The picture shows the
 * current choice of its tool: the colour of the pen or the eraser, the colour of the next note, and
 * the next shape in its colour. The colours come from the palette. Light and dark faces, not shadows, give
 * the depth, and a cut in the bar colour keeps the layers apart.
 */

import { createUniqueId } from "solid-js";
import { type CanvasColor, colorVar, type NoteTone, type ShapeKind } from "./workflow-node-parts";

/**
 * The fill of a front layer (light at the top left, full colour at the bottom right) and its edge,
 * which catches the light at the top left only.
 */
function ArtGradients(props: { id: string }) {
  return (
    <defs>
      <linearGradient id={`${props.id}-fill`} x1="0" y1="0" x2="1" y2="1">
        <stop class="wfn-art-stop-light" offset="0" />
        <stop class="wfn-art-stop-color" offset="0.72" />
      </linearGradient>
      <linearGradient id={`${props.id}-edge`} x1="0" y1="0" x2="1" y2="1">
        <stop class="wfn-art-stop-edge" offset="0" />
        <stop class="wfn-art-stop-clear" offset="0.6" />
      </linearGradient>
    </defs>
  );
}

/**
 * A pencil with three faces in the ink colour and a sharpened wood tip with a lead in the ink
 * colour. In eraser mode the pencil turns round and shows its metal band and pink rubber.
 */
export function DrawArt(props: { color: CanvasColor; eraser: boolean }) {
  return (
    <svg
      class="wfn-tool-art"
      viewBox="0 0 44 56"
      data-eraser={props.eraser ? "" : undefined}
      style={{ "--wfn-art-color": colorVar(props.color) }}
      aria-hidden="true"
    >
      <g class="wfn-art-layer" data-layer="pen">
        <polygon class="wfn-art-wood" points="22,7 28,21 28,24 16,24 16,21" />
        <polygon class="wfn-art-wood-shade" points="22,7 28,21 28,24 24,24" />
        <polygon class="wfn-art-color" points="22,7 24.4,12.6 19.6,12.6" />
        <polygon class="wfn-art-face-dark" points="22,7 24.4,12.6 22.8,12.6" />
        <path class="wfn-art-face-light" d="M16 60V21q2 4 4 0v39z" />
        <path class="wfn-art-color" d="M20 60V21q2 4 4 0v39z" />
        <path class="wfn-art-face-dark" d="M24 60V21q2 4 4 0v39z" />
        <rect class="wfn-art-gloss" x="17" y="24" width="1" height="36" rx="0.5" />
      </g>
      <g class="wfn-art-layer" data-layer="eraser">
        <rect class="wfn-art-rubber" x="16" y="7" width="12" height="11" rx="3" />
        <path class="wfn-art-rubber-shade" d="M24 7h1a3 3 0 0 1 3 3v8h-4z" />
        <rect class="wfn-art-gloss" x="17.5" y="9.5" width="1" height="6" rx="0.5" />
        <rect class="wfn-art-metal" x="15.5" y="16" width="13" height="7" rx="1" />
        <rect class="wfn-art-metal-groove" x="15.5" y="18" width="13" height="0.8" />
        <rect class="wfn-art-metal-groove" x="15.5" y="20.4" width="13" height="0.8" />
        <rect class="wfn-art-face-light" x="16" y="23" width="4" height="37" />
        <rect class="wfn-art-color" x="20" y="23" width="4" height="37" />
        <rect class="wfn-art-face-dark" x="24" y="23" width="4" height="37" />
        <rect class="wfn-art-gloss" x="17" y="24" width="1" height="36" rx="0.5" />
      </g>
    </svg>
  );
}

const NOTE = "M14 9h24a2 2 0 0 1 2 2v18l-9 9H14a2 2 0 0 1-2-2V15a2 2 0 0 1 2-2z";

/** Three notes in a stack. The front note has the colour of the next note, and a curled corner. */
export function StickyArt(props: { tone: NoteTone }) {
  const id = createUniqueId();
  return (
    <svg
      class="wfn-tool-art"
      viewBox="0 6 52 56"
      style={{ "--wfn-art-color": colorVar(props.tone) }}
      aria-hidden="true"
    >
      <ArtGradients id={id} />
      <g class="wfn-art-layer" data-layer="back">
        <rect class="wfn-art-tint-back wfn-art-cut" x="12" y="11" width="28" height="28" rx="2" />
      </g>
      <g class="wfn-art-layer" data-layer="middle">
        <rect class="wfn-art-tint-middle wfn-art-cut" x="12" y="10" width="28" height="28" rx="2" />
      </g>
      <g class="wfn-art-layer" data-layer="front">
        <path class="wfn-art-cut" d={NOTE} fill={`url(#${id}-fill)`} />
        <path class="wfn-art-edge" d={NOTE} stroke={`url(#${id}-edge)`} />
        <path class="wfn-art-curl" d="M40 29l-9 9c.6-3.6 1.5-5.6 2.9-6.6 1.4-1.1 3.3-1.8 6.1-2.4z" />
      </g>
    </svg>
  );
}

/** The outline of each shape in the art, in a 22 by 22 box at the front of the picture. */
function frontShape(shape: ShapeKind) {
  switch (shape) {
    case "rectangle":
      return <rect x="15" y="14" width="22" height="22" rx="3" />;
    case "circle":
      return <circle cx="26" cy="25" r="11.5" />;
    case "oval":
      return <rect x="12" y="18" width="28" height="15" rx="7.5" />;
    case "diamond":
      return <polygon points="26,12 39,25 26,38 13,25" />;
    case "triangle":
      return <polygon points="26,12 39,36 13,36" />;
    case "inverted":
      return <polygon points="13,14 39,14 26,38" />;
    case "star":
      return (
        <polygon points="26,11 29.5,20.5 39.5,20.8 31.6,27 34.4,36.7 26,31 17.6,36.7 20.4,27 12.5,20.8 22.5,20.5" />
      );
  }
}

/** A square and a circle in tints of the next shape colour, behind the next shape in full colour. */
export function ShapesArt(props: { shape: ShapeKind; color: CanvasColor }) {
  const id = createUniqueId();
  return (
    <svg
      class="wfn-tool-art"
      viewBox="0 9 52 56"
      style={{ "--wfn-art-color": colorVar(props.color) }}
      aria-hidden="true"
    >
      <ArtGradients id={id} />
      <g class="wfn-art-layer" data-layer="back">
        <rect class="wfn-art-tint-back wfn-art-cut" x="8" y="18" width="20" height="20" rx="3" />
      </g>
      <g class="wfn-art-layer" data-layer="middle">
        <circle class="wfn-art-tint-middle wfn-art-cut" cx="38" cy="30" r="9" />
      </g>
      <g class="wfn-art-layer" data-layer="front">
        <g class="wfn-art-cut" fill={`url(#${id}-fill)`}>
          {frontShape(props.shape)}
        </g>
        <g class="wfn-art-edge" stroke={`url(#${id}-edge)`}>
          {frontShape(props.shape)}
        </g>
      </g>
    </svg>
  );
}
