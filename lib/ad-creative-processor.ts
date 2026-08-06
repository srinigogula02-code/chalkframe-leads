import "server-only";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { uploadLeadImage } from "./r2";

export async function processAdCreativeImage(imageUrl: string): Promise<{
  url: string;
  bytes: Uint8Array | null;
  mimeType: string;
  width?: number;
  height?: number;
}> {
  const trimmed = imageUrl.trim();
  if (!trimmed) throw new Error("An image URL is required.");

  let buffer: Buffer | null = null;
  let contentType = "image/jpeg";

  if (trimmed.startsWith("data:image/")) {
    const matches = trimmed.match(/^data:(image\/[a-zA-Z+]+);base64,(.+)$/);
    if (!matches) throw new Error("Invalid base64 image data URI format.");
    contentType = matches[1];
    buffer = Buffer.from(matches[2], "base64");
  } else {
    try {
      // Fetch image server-side with browser User-Agent headers to bypass FB CDN restrictions
      const response = await fetch(trimmed, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
          Accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
          Referer: "https://www.facebook.com/",
        },
        signal: AbortSignal.timeout(30_000),
      });

      if (response.ok) {
        const arrayBuffer = await response.arrayBuffer();
        buffer = Buffer.from(arrayBuffer);
        contentType = response.headers.get("content-type") || "image/jpeg";
      }
    } catch (error) {
      console.warn("Server-side image fetch fallback:", error);
    }
  }

  // Fallback if image fetching or decoding failed: return raw URL directly
  if (!buffer) {
    return {
      url: trimmed,
      bytes: null,
      mimeType: "image/jpeg",
    };
  }

  try {
    // Compress & normalize ad creative image using sharp
    const image = sharp(buffer);
    const metadata = await image.metadata();

    const compressed = await image
      .resize({ width: 1440, height: 1440, fit: "inside", withoutEnlargement: true })
      .webp({ quality: 85 })
      .toBuffer();

    const key = `ad-creatives/${randomUUID()}.webp`;
    let publicUrl = trimmed;

    try {
      publicUrl = await uploadLeadImage({
        key,
        bytes: new Uint8Array(compressed),
        contentType: "image/webp",
        cacheControl: "public, max-age=31536000, immutable",
      });
    } catch (error) {
      console.warn("Cloudflare R2 upload fallback:", error);
    }

    return {
      url: publicUrl,
      bytes: new Uint8Array(compressed),
      mimeType: "image/webp",
      width: metadata.width,
      height: metadata.height,
    };
  } catch (err) {
    console.warn("Sharp compression fallback:", err);
    return {
      url: trimmed,
      bytes: null,
      mimeType: contentType,
    };
  }
}
