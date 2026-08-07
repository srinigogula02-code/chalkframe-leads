import sharp from "sharp";

const CANVAS_WIDTH = 1920;
const CANVAS_HEIGHT = 1080;
const HALF_WIDTH = CANVAS_WIDTH / 2;
const PADDING = 30;

async function fitInside(bytes: Uint8Array) {
  return sharp(bytes, { failOn: "error", limitInputPixels: 40_000_000 })
    .rotate()
    .resize({ width: HALF_WIDTH - PADDING * 2, height: CANVAS_HEIGHT - PADDING * 2, fit: "inside", withoutEnlargement: false })
    .png()
    .toBuffer({ resolveWithObject: true });
}

async function fitInsideSingle(bytes: Uint8Array) {
  return sharp(bytes, { failOn: "error", limitInputPixels: 40_000_000 })
    .rotate()
    .resize({ width: CANVAS_WIDTH - PADDING * 2, height: CANVAS_HEIGHT - PADDING * 2, fit: "inside", withoutEnlargement: false })
    .png()
    .toBuffer({ resolveWithObject: true });
}

export async function createSingleImageCollage(redesign: Uint8Array) {
  const img = await fitInsideSingle(redesign);
  return sharp({ create: { width: CANVAS_WIDTH, height: CANVAS_HEIGHT, channels: 4, background: "#f3f0ea" } })
    .composite([
      { input: img.data, left: Math.round((CANVAS_WIDTH - img.info.width) / 2), top: Math.round((CANVAS_HEIGHT - img.info.height) / 2) },
    ])
    .png({ compressionLevel: 9 })
    .toBuffer();
}

export async function createComparisonCollage(original: Uint8Array, redesign: Uint8Array) {
  const [left, right] = await Promise.all([fitInside(original), fitInside(redesign)]);
  return sharp({ create: { width: CANVAS_WIDTH, height: CANVAS_HEIGHT, channels: 4, background: "#f3f0ea" } })
    .composite([
      { input: left.data, left: Math.round((HALF_WIDTH - left.info.width) / 2), top: Math.round((CANVAS_HEIGHT - left.info.height) / 2) },
      { input: right.data, left: HALF_WIDTH + Math.round((HALF_WIDTH - right.info.width) / 2), top: Math.round((CANVAS_HEIGHT - right.info.height) / 2) },
    ])
    .png({ compressionLevel: 9 })
    .toBuffer();
}

