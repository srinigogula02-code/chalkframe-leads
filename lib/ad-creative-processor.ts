import "server-only";

import { randomUUID } from "node:crypto";
import { isIP } from "node:net";
import { lookup } from "node:dns/promises";
import sharp from "sharp";
import { uploadLeadImage } from "./r2";

const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const ALLOWED_FORMATS = new Set(["jpeg", "png", "webp", "gif", "avif", "tiff"]);

function privateIpv4(address: string) {
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some(part => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  const [a, b] = parts;
  return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127)
    || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)
    || (a === 198 && (b === 18 || b === 19));
}

function privateAddress(address: string) {
  if (isIP(address) === 4) return privateIpv4(address);
  if (isIP(address) === 6) {
    const normalized = address.toLowerCase();
    return normalized === "::" || normalized === "::1" || normalized.startsWith("fc") || normalized.startsWith("fd")
      || normalized.startsWith("fe8") || normalized.startsWith("fe9") || normalized.startsWith("fea") || normalized.startsWith("feb");
  }
  return true;
}

async function safeRemoteUrl(value: string) {
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new Error("Use a public HTTP(S) image URL.");
  const hostname = url.hostname.toLowerCase();
  if (hostname === "localhost" || hostname.endsWith(".local") || hostname.endsWith(".internal")) throw new Error("The image URL must be publicly reachable.");
  if (isIP(hostname)) {
    if (privateAddress(hostname)) throw new Error("The image URL must be publicly reachable.");
  } else {
    const addresses = await lookup(hostname, { all: true, verbatim: true });
    if (!addresses.length || addresses.some(result => privateAddress(result.address))) throw new Error("The image URL must be publicly reachable.");
  }
  return url;
}

async function readLimited(response: Response) {
  const declared = Number(response.headers.get("content-length") || 0);
  if (declared > MAX_IMAGE_BYTES) throw new Error("The creative image is larger than 20 MB.");
  if (!response.body) throw new Error("The image host returned an empty response.");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_IMAGE_BYTES) {
      await reader.cancel();
      throw new Error("The creative image is larger than 20 MB.");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return Buffer.from(bytes);
}

async function fetchCreative(value: string) {
  if (value.startsWith("data:image/")) {
    const match = value.match(/^data:(image\/[a-zA-Z+.-]+);base64,([A-Za-z0-9+/=]+)$/);
    if (!match) throw new Error("The pasted image data is invalid.");
    const bytes = Buffer.from(match[2], "base64");
    if (!bytes.length || bytes.length > MAX_IMAGE_BYTES) throw new Error("The pasted image must be smaller than 20 MB.");
    return bytes;
  }

  let url = await safeRemoteUrl(value);
  for (let redirects = 0; redirects <= 3; redirects += 1) {
    const response = await fetch(url, {
      redirect: "manual",
      headers: {
        "User-Agent": "Chalkframe Leads/1.0",
        Accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
        Referer: "https://www.facebook.com/",
      },
      signal: AbortSignal.timeout(30_000),
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      if (!location || redirects === 3) throw new Error("The image redirected too many times.");
      url = await safeRemoteUrl(new URL(location, url).toString());
      continue;
    }
    if (!response.ok) throw new Error(`The image host returned ${response.status}.`);
    const contentType = response.headers.get("content-type")?.toLowerCase() || "";
    if (contentType && !contentType.startsWith("image/")) throw new Error("The URL did not return an image.");
    return readLimited(response);
  }
  throw new Error("The creative image could not be downloaded.");
}

export async function processAdCreativeImage(imageUrl: string): Promise<{
  url: string;
  bytes: Uint8Array;
  mimeType: "image/webp";
  width: number;
  height: number;
}> {
  const trimmed = imageUrl.trim();
  if (!trimmed) throw new Error("An image URL is required.");
  const source = await fetchCreative(trimmed);
  const image = sharp(source, { failOn: "error", limitInputPixels: 40_000_000 });
  const metadata = await image.metadata();
  if (!metadata.format || !ALLOWED_FORMATS.has(metadata.format) || !metadata.width || !metadata.height) {
    throw new Error("Use a valid PNG, JPEG, WebP, GIF, AVIF, or TIFF creative image.");
  }
  const compressed = await image
    .rotate()
    .resize({ width: 1440, height: 1440, fit: "inside", withoutEnlargement: true })
    .webp({ quality: 90 })
    .toBuffer();
  const url = await uploadLeadImage({
    key: `ad-creatives/${randomUUID()}.webp`,
    bytes: new Uint8Array(compressed),
    contentType: "image/webp",
    cacheControl: "public, max-age=31536000, immutable",
  });
  return { url, bytes: new Uint8Array(compressed), mimeType: "image/webp", width: metadata.width, height: metadata.height };
}
