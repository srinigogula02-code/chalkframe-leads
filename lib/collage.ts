import "server-only";

import { createHash } from "node:crypto";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import sharp from "sharp";
import { createComparisonCollage } from "@/lib/collage-image";
import { sql } from "@/lib/db";
import { processEmailDraftQueue, queueEmailDraftsForLead } from "@/lib/openrouter-email";
import { uploadLeadImage } from "@/lib/r2";

const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const ALLOWED_FORMATS = new Set(["jpeg", "png", "webp", "gif", "avif", "tiff"]);

type QueueRow = { id: string; url: string };

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
  const selection = await sql`SELECT i.id, i.url FROM leads l JOIN lead_images i ON i.id=l.collage_original_image_id AND i.lead_id=l.id WHERE l.id=${leadId}`;
  if (!selection[0]) {
    await sql`UPDATE redesign_images SET collage_status='waiting', collage_error=NULL, collage_started_at=NULL WHERE lead_id=${leadId} AND collage_status IN ('queued','processing')`;
    return;
  }
  const claimed = await sql`UPDATE redesign_images SET collage_status='processing', collage_error=NULL, collage_started_at=now()
    WHERE lead_id=${leadId} AND collage_status='queued'
    RETURNING id, url` as QueueRow[];
  if (!claimed.length) return;
  let originalBytes: Uint8Array;
  try { originalBytes = await fetchImage(String(selection[0].url)); }
  catch (error) { await markFailed(claimed.map(row => row.id), error instanceof Error ? `Original creative: ${error.message}` : "Original creative could not be loaded."); return; }

  let cursor = 0;
  const workers = Array.from({ length: Math.min(3, claimed.length) }, async () => {
    while (cursor < claimed.length) {
      const row = claimed[cursor++];
      try {
        const redesignBytes = await fetchImage(row.url);
        const collage = await createComparisonCollage(originalBytes, redesignBytes);
        const version = createHash("sha256").update(`${selection[0].id}\n${selection[0].url}\n${row.url}`).digest("hex").slice(0, 16);
        const now = new Date();
        const key = `leads/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, "0")}/collages/${leadId}/${row.id}-${version}.png`;
        const collageUrl = await uploadLeadImage({ key, bytes: collage, contentType: "image/png" });
        await sql`UPDATE redesign_images r SET collage_url=${collageUrl}, collage_status='completed', collage_error=NULL,
          collage_source_image_id=${String(selection[0].id)}, collage_source_redesign_url=${row.url}, collage_completed_at=now(), collage_started_at=NULL
          FROM leads l WHERE r.id=${row.id} AND r.lead_id=${leadId} AND r.lead_id=l.id AND r.url=${row.url} AND l.collage_original_image_id=${String(selection[0].id)} AND r.collage_status='processing'`;
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
