// Adapted from React Bits PixelBlast by David Haz (2026).
// https://reactbits.dev/backgrounds/pixel-blast
// See pixel-blast.LICENSE.md. Skia uses logical pixels and premultiplied alpha.
export const PIXEL_BLAST_SHADER = `
uniform float2 resolution;
uniform float time;
uniform float3 color;
uniform float4 clicks[10];
uniform float4 brush;
uniform float2 direction;

const int FBM_OCTAVES = 5;
const float FBM_LACUNARITY = 1.25;
const float FBM_GAIN = 1.0;

float hash11(float n){ return fract(sin(n)*43758.5453); }

float vnoise(vec3 p){
  vec3 ip = floor(p);
  vec3 fp = fract(p);
  float n000 = hash11(dot(ip + vec3(0.0,0.0,0.0), vec3(1.0,57.0,113.0)));
  float n100 = hash11(dot(ip + vec3(1.0,0.0,0.0), vec3(1.0,57.0,113.0)));
  float n010 = hash11(dot(ip + vec3(0.0,1.0,0.0), vec3(1.0,57.0,113.0)));
  float n110 = hash11(dot(ip + vec3(1.0,1.0,0.0), vec3(1.0,57.0,113.0)));
  float n001 = hash11(dot(ip + vec3(0.0,0.0,1.0), vec3(1.0,57.0,113.0)));
  float n101 = hash11(dot(ip + vec3(1.0,0.0,1.0), vec3(1.0,57.0,113.0)));
  float n011 = hash11(dot(ip + vec3(0.0,1.0,1.0), vec3(1.0,57.0,113.0)));
  float n111 = hash11(dot(ip + vec3(1.0,1.0,1.0), vec3(1.0,57.0,113.0)));
  vec3 w = fp*fp*fp*(fp*(fp*6.0-15.0)+10.0);
  float x00 = mix(n000, n100, w.x);
  float x10 = mix(n010, n110, w.x);
  float x01 = mix(n001, n101, w.x);
  float x11 = mix(n011, n111, w.x);
  float y0  = mix(x00, x10, w.y);
  float y1  = mix(x01, x11, w.y);
  return mix(y0, y1, w.z) * 2.0 - 1.0;
}

float fbm2(vec2 uv, float t){
  vec3 p = vec3(uv * 3.0, t);
  float amp = 1.0;
  float freq = 1.0;
  float sum = 1.0;
  for (int i = 0; i < FBM_OCTAVES; ++i){
    sum  += amp * vnoise(p * freq);
    freq *= FBM_LACUNARITY;
    amp  *= FBM_GAIN;
  }
  return sum * 0.5 + 0.5;
}


half4 main(float2 position) {
  // Convert Skia's top-left origin to the reference shader's bottom-left origin.
  float2 coord = float2(position.x, resolution.y - position.y);
  float2 norm = coord / resolution;
  float age = max(time - brush.z, 0.0);
  float intensity = brush.w * exp(-age * 3.0)
    * exp(-dot(norm - brush.xy, norm - brush.xy) / (2.0 * 0.12 * 0.12));
  float wobble = 0.5 + 0.5 * sin(time * 5.0 + intensity * 6.2831853);
  coord += direction * (0.12 * intensity * wobble) * resolution;

  float pixelSize = 6.0;
  float2 fragCoord = coord - resolution * 0.5;
  float2 pixelId = floor(fragCoord / pixelSize);
  float2 pixelUV = fract(fragCoord / pixelSize);
  float seed = dot(pixelId, float2(127.1, 311.7));
  float2 scatter = float2(hash11(seed), hash11(seed + 19.19));
  float cellPixelSize = 8.0 * pixelSize;
  float2 cellCoord = floor(fragCoord / cellPixelSize) * cellPixelSize;
  float2 uv = cellCoord / resolution.y;
  // Independent noise samples prevent neighboring pixels from forming large clouds.
  // Stable seeds keep each square in place while its visibility changes over time.
  float base = fbm2(scatter * 8.0, time * 0.05) * 0.5 - 0.65;
  float feed = base + (1.35 - 0.5) * 0.3;

  for (int i = 0; i < 10; ++i) {
    if (clicks[i].w > 0.0) {
      float2 cuv = (clicks[i].xy - resolution * 0.5 - cellPixelSize * 0.5) / resolution.y;
      float t = max(time - clicks[i].z, 0.0);
      float r = distance(uv, cuv);
      float ring = exp(-pow((r - 0.4 * t) / 0.12, 2.0));
      feed = max(feed, ring * exp(-t) * exp(-10.0 * r) * 1.5);
    }
  }

  float threshold = hash11(seed + 73.31);
  float bw = step(threshold, feed);
  float h = hash11(seed + 41.73);
  float coverage = bw * (1.0 + (h - 0.5) * 0.35);
  float halfSize = sqrt(coverage) * 0.25;
  float2 center = 0.5 + (scatter - 0.5) * 0.15;
  float2 offset = abs(pixelUV - center);
  float d = max(offset.x, offset.y) - halfSize;
  // Logical-pixel antialiasing; derivatives are not available in RuntimeEffect.
  float mask = coverage * (1.0 - smoothstep(-0.5 / pixelSize, 0.5 / pixelSize, d * 2.0));
  float edge = min(min(norm.x, norm.y), min(1.0 - norm.x, 1.0 - norm.y));
  float alpha = clamp(mask * smoothstep(0.0, 0.07, edge), 0.0, 1.0);
  // Keep the reading area clear; the animation is a quiet accent at the edges.
  float contentDistance = length((norm - 0.5) / float2(0.30, 0.22));
  float contentFade = smoothstep(0.85, 1.55, contentDistance);
  alpha *= 0.42 * contentFade;
  return half4(color * alpha, alpha);
}
`;
