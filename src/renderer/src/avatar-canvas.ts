export function loadSvg(svg: SVGSVGElement, size: number): Promise<HTMLImageElement> {
  svg.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  svg.setAttribute("width", String(size));
  svg.setAttribute("height", String(size));
  return loadImage(new Blob([new XMLSerializer().serializeToString(svg)], { type: "image/svg+xml" }));
}

export async function loadImage(blob: Blob): Promise<HTMLImageElement> {
  const url = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => (typeof reader.result === "string" ? resolve(reader.result) : reject(reader.error));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
  const image = new Image();
  image.src = url;
  await image.decode();
  return image;
}

export function withAlpha(hex: string, alpha: number): string {
  const value = hex.replace("#", "");
  const [r, g, b] = [0, 2, 4].map((offset) => Number.parseInt(value.slice(offset, offset + 2), 16));
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
