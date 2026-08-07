import "server-only";

import { createHash } from "node:crypto";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import sharp from "sharp";
import { createComparisonCollage, createSingleImageCollage } from "@/lib/collage-image";
import { sql } from "@/lib/db";
import { processEmailDraftQueue, queueEmailDraftsForLead } from "@/lib/openrouter-email";
import { uploadLeadImage } from "@/lib/r2";

const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const ALLOWED_FORMATS = new Set(["jpeg", "png", "webp", "gif", "avif", "tiff"]);

type QueueRow = { id: string; url: string; collage_source_image_id?: string | null };
type OriginalImageMap = Map<string, { id: string; url: string }>;

function isPrivateIpv4(address: string) {
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some(part => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  const [a, b] = parts;
  return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19));
}

function isPrivateAddress(address: string) {
  if (isIP(address) === 4) return isPrivateIpv4(address);
  if (isIP(address) === 6) {
    const normalized = address.toLowerCase();
    return normalized === "::" || normalized === "::1" || normalized.startsWith("fc") || normalized.startsWith("fd") || normalized.startsWith("fe8") || normalized.startsWith("fe9") || normalized.startsWith("fea") || normalized.startsWith("feb") || normalized.startsWith("::ffff:127.") || normalized.startsWith("::ffff:10.") || normalized.startsWith("::ffff:192.168.");
  }
  return true;
}

async function validateRemoteUrl(value: string) {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error("The image URL is not safe to fetch.");
  const hostname = url.hostname.toLowerCase();
  if (hostname === "localhost" || hostname.endsWith(".local") || hostname.endsWith(".internal")) throw new Error("The image URL is not publicly reachable.");
  if (isIP(hostname)) {
    if (isPrivateAddress(hostname)) throw new Error("The image URL is not publicly reachable.");
  } else {
    const addresses = await lookup(hostname, { all: true, verbatim: true });
    if (!addresses.length || addresses.some(result => isPrivateAddress(result.address))) throw new Error("The image host is not publicly reachable.");
  }
  return url;
}

async function readLimited(response: Response) {
  const declared = Number(response.headers.get("content-length") || 0);
  if (declared > MAX_IMAGE_BYTES) throw new Error("An image is larger than 20 MB.");
  if (!response.body) throw new Error("The image host returned an empty response.");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_IMAGE_BYTES) { await reader.cancel(); throw new Error("An image is larger than 20 MB."); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}

async function fetchImage(urlValue: string) {
  let url = await validateRemoteUrl(urlValue);
  for (let redirects = 0; redirects <= 3; redirects += 1) {
    const response = await fetch(url, {
      redirect: "manual",
      signal: AbortSignal.timeout(15_000),
      headers: { "user-agent": "ChalkframeCollage/1.0", accept: "image/*" },
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      if (!location || redirects === 3) throw new Error("The image redirected too many times.");
      url = await validateRemoteUrl(new URL(location, url).toString());
      continue;
    }
    if (!response.ok) throw new Error(`The image host returned ${response.status}.`);
    const contentType = response.headers.get("content-type")?.toLowerCase() || "";
    if (contentType && !contentType.startsWith("image/")) throw new Error("The URL did not return an image.");
    const bytes = await readLimited(response);
    const metadata = await sharp(bytes, { failOn: "error", limitInputPixels: 40_000_000 }).metadata();
    if (!metadata.format || !ALLOWED_FORMATS.has(metadata.format)) throw new Error("This image format cannot be used in a collage.");
    return bytes;
  }
  throw new Error("The image could not be downloaded.");
}

async function markFailed(ids: string[], message: string) {
  if (!ids.length) return;
  await sql`UPDATE redesign_images SET collage_status='failed', collage_error=${message.slice(0, 500)}, collage_started_at=NULL WHERE id = ANY(${ids}::uuid[]) AND collage_status='processing'`;
}

export async function processCollageQueue(leadId: string) {
  // Fetch all available original ad creative images for this lead
  const [allOriginals, leadRow] = await Promise.all([
    sql`SELECT id, url FROM lead_images WHERE lead_id=${leadId} ORDER BY position ASC, created_at ASC`,
    sql`SELECT id, collage_original_image_id FROM leads WHERE id=${leadId}`,
  ]);

  if (!allOriginals.length) {
    const claimed = (await sql`UPDATE redesign_images 
      SET collage_status='processing', collage_error=NULL, collage_started_at=now()
      WHERE lead_id=${leadId} AND collage_status='queued'
      RETURNING id, url, collage_source_image_id`) as QueueRow[];

    if (!claimed.length) return;

    for (const row of claimed) {
      try {
        const redesignBytes = await fetchImage(row.url);
        const collage = await createSingleImageCollage(redesignBytes);
        
        const version = createHash("sha256").update(`single\n${row.url}`).digest("hex").slice(0, 16);
        const now = new Date();
        const key = `leads/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, "0")}/collages/${leadId}/${row.id}-${version}.png`;
        const collageUrl = await uploadLeadImage({ key, bytes: collage, contentType: "image/png" });

        await sql`UPDATE redesign_images 
          SET collage_url=${collageUrl}, collage_status='completed', collage_error=NULL,
              collage_source_image_id=NULL, collage_source_redesign_url=${row.url}, 
              collage_completed_at=now(), collage_started_at=NULL
          WHERE id=${row.id} AND lead_id=${leadId} AND collage_status='processing'`;
      } catch (error) {
        await markFailed([row.id], error instanceof Error ? error.message : "The single image banner could not be created.");
      }
    }

    const draftQueue = await queueEmailDraftsForLead(leadId).catch(() => ({ queued: 0 }));
    if (draftQueue.queued > 0) processEmailDraftQueue(leadId);
    return;
  }

  const originalMap: OriginalImageMap = new Map();
  allOriginals.forEach(img => originalMap.set(String(img.id), { id: String(img.id), url: String(img.url) }));

  const defaultOriginal = (leadRow[0]?.collage_original_image_id && originalMap.get(String(leadRow[0].collage_original_image_id))) || originalMap.values().next().value;

  const claimed = (await sql`UPDATE redesign_images 
    SET collage_status='processing', collage_error=NULL, collage_started_at=now()
    WHERE lead_id=${leadId} AND collage_status='queued'
    RETURNING id, url, collage_source_image_id`) as QueueRow[];

  if (!claimed.length) return;

  // Cache fetched original image bytes so we don't re-download the same original multiple times
  const originalBytesCache = new Map<string, Uint8Array>();

  async function getOriginalBytes(sourceId: string, sourceUrl: string): Promise<Uint8Array> {
    if (originalBytesCache.has(sourceId)) {
      return originalBytesCache.get(sourceId)!;
    }
    const bytes = await fetchImage(sourceUrl);
    originalBytesCache.set(sourceId, bytes);
    return bytes;
  }

  let cursor = 0;
  const workers = Array.from({ length: Math.min(3, claimed.length) }, async () => {
    while (cursor < claimed.length) {
      const row = claimed[cursor++];
      try {
        // Match specific original creative paired with this redesign, or fallback to lead default original
        const targetOriginal = (row.collage_source_image_id && originalMap.get(String(row.collage_source_image_id))) || defaultOriginal;

        let originalBytes: Uint8Array | null = null;
        if (targetOriginal?.url) {
          try {
            originalBytes = await getOriginalBytes(targetOriginal.id, targetOriginal.url);
          } catch {
            // Original image fetch failed (e.g. Facebook CDN expired or ad went inactive) -> fall back to single redesign banner
            originalBytes = null;
          }
        }

        const redesignBytes = await fetchImage(row.url);
        
        let collage: Uint8Array;
        let version: string;
        if (originalBytes && targetOriginal) {
          collage = await createComparisonCollage(originalBytes, redesignBytes);
          version = createHash("sha256").update(`${targetOriginal.id}\n${targetOriginal.url}\n${row.url}`).digest("hex").slice(0, 16);
        } else {
          collage = await createSingleImageCollage(redesignBytes);
          version = createHash("sha256").update(`single\n${row.url}`).digest("hex").slice(0, 16);
        }

        const now = new Date();
        const key = `leads/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, "0")}/collages/${leadId}/${row.id}-${version}.png`;
        const collageUrl = await uploadLeadImage({ key, bytes: collage, contentType: "image/png" });

        await sql`UPDATE redesign_images 
          SET collage_url=${collageUrl}, collage_status='completed', collage_error=NULL,
              collage_source_image_id=${originalBytes && targetOriginal ? targetOriginal.id : null},
              collage_source_redesign_url=${row.url}, 
              collage_completed_at=now(), collage_started_at=NULL
          WHERE id=${row.id} AND lead_id=${leadId} AND collage_status='processing'`;
      } catch (error) {
        await markFailed([row.id], error instanceof Error ? error.message : "The collage could not be created.");
      }
    }
  });

  await Promise.all(workers);

  try {
    const queued = await queueEmailDraftsForLead(leadId);
    if (queued.queued > 0) await processEmailDraftQueue(leadId);
  } catch (error) {
    console.error("Email draft queue failed after collage generation", { leadId, error });
  }
}
