import sharp from "sharp";

const MAX_WIDTH = 1200;
const TARGET_BYTES = 1024 * 1024;

export async function compressImage(input: Uint8Array, declaredType: string) {
  const metadata = await sharp(input, { animated: declaredType === "image/gif", limitInputPixels: 40_000_000 }).metadata();
  const animated = declaredType === "image/gif" && (metadata.pages ?? 1) > 1;
  let output: Buffer; let contentType: "image/jpeg"|"image/png"|"image/gif"; let extension: "jpg"|"png"|"gif";
  if (animated) {
    output = await sharp(input, { animated: true, limitInputPixels: 40_000_000 }).rotate().resize({ width: MAX_WIDTH, withoutEnlargement: true }).gif({ effort: 7 }).toBuffer();
    contentType = "image/gif"; extension = "gif";
  } else if (metadata.hasAlpha) {
    output = await sharp(input, { limitInputPixels: 40_000_000 }).rotate().resize({ width: MAX_WIDTH, withoutEnlargement: true }).png({ compressionLevel: 9, palette: true, quality: 82, effort: 8 }).toBuffer();
    if (output.byteLength > TARGET_BYTES) output = await sharp(input, { limitInputPixels: 40_000_000 }).rotate().resize({ width: 900, withoutEnlargement: true }).png({ compressionLevel: 9, palette: true, quality: 70, effort: 10 }).toBuffer();
    contentType = "image/png"; extension = "png";
  } else {
    output = await sharp(input, { limitInputPixels: 40_000_000 }).rotate().resize({ width: MAX_WIDTH, withoutEnlargement: true }).flatten({ background: "#ffffff" }).jpeg({ quality: 82, progressive: true, mozjpeg: true }).toBuffer();
    if (output.byteLength > TARGET_BYTES) output = await sharp(input, { limitInputPixels: 40_000_000 }).rotate().resize({ width: 1000, withoutEnlargement: true }).flatten({ background: "#ffffff" }).jpeg({ quality: 70, progressive: true, mozjpeg: true }).toBuffer();
    contentType = "image/jpeg"; extension = "jpg";
  }
  if (output.byteLength > TARGET_BYTES) throw new Error("The optimized image is still over 1 MB. Use a simpler or smaller image.");
  const result = await sharp(output).metadata();
  return { bytes: output, contentType, extension, width: result.width ?? null, height: result.height ?? null, originalBytes: input.byteLength };
}
