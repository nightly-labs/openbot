export interface GalleryTile {
  left: number;
  top: number;
  width: number;
  height: number;
}

export function galleryTiles(count: number, width: number, gap: number): { tiles: GalleryTile[]; height: number } {
  if (count <= 0 || width <= 0) return { tiles: [], height: 0 };
  const column = Math.floor((width - gap) / 2);
  const tiles: GalleryTile[] = [];
  let top = 0;
  let index = 0;
  if (count % 2 === 1) {
    tiles.push({ left: 0, top, width, height: column });
    top += column + gap;
    index = 1;
  }
  for (; index < count; index += 2) {
    tiles.push({ left: 0, top, width: column, height: column });
    tiles.push({ left: width - column, top, width: column, height: column });
    top += column + gap;
  }
  return { tiles, height: top - gap };
}
