import axios from "axios";
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { supabase, storageUpload, storageDelete, downloadFile } from "./supabase.js";

/**
 * Storage with a local-disk fallback.
 *
 * Supabase is used when SUPABASE_URL is configured and reachable; otherwise files
 * land under <cwd>/storage/<bucket>/<path> and are addressed by a `local://` URL.
 * Keeps the app runnable without any cloud storage account.
 */

const LOCAL_ROOT = resolve(process.cwd(), "storage");
const LOCAL_PREFIX = "local://";
const REMOTE_PREFIX = "supabase://";

export function isLocalUrl(url: string): boolean {
  return url.startsWith(LOCAL_PREFIX);
}

export function isRemoteUrl(url: string): boolean {
  return url.startsWith(REMOTE_PREFIX);
}

function splitPrefixedUrl(url: string, prefix: string): { bucket: string; path: string } {
  const rest = url.slice(prefix.length);
  const slash = rest.indexOf("/");
  if (slash < 1 || slash === rest.length - 1) {
    throw new Error(`Malformed storage url: ${url}`);
  }
  return { bucket: rest.slice(0, slash), path: rest.slice(slash + 1) };
}

/** Resolves bucket/path under LOCAL_ROOT, refusing anything that escapes it. */
function localPathFor(bucket: string, path: string): string {
  const target = resolve(LOCAL_ROOT, bucket, path);
  if (target !== LOCAL_ROOT && !target.startsWith(LOCAL_ROOT + sep)) {
    throw new Error(`Refusing storage path outside ${LOCAL_ROOT}: ${bucket}/${path}`);
  }
  return target;
}



/** Writes a buffer to Supabase when available, else to local disk. */
export async function storagePut(
  bucket: string,
  path: string,
  buffer: Buffer,
  contentType?: string
): Promise<{ url: string; path: string }> {
  if (supabase) {
    try {
      await storageUpload(bucket, path, buffer, contentType);
      /**
       * Deliberately not the public URL. Recordings are someone's face and voice, so
       * the bucket stays private and everything is read back through the service-role
       * client behind an owner check. A public URL would make any leaked link playable.
       */
      return { url: `${REMOTE_PREFIX}${bucket}/${path}`, path };
    } catch (e) {
      console.warn(
        `[storage] Supabase upload failed (${(e as Error).message}); falling back to local disk.`
      );
    }
  }

  const target = localPathFor(bucket, path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, buffer);
  return { url: `${LOCAL_PREFIX}${bucket}/${path}`, path };
}

/** Reads back whatever storagePut wrote, local or remote. */
export async function storageFetch(url: string): Promise<Buffer> {
  if (isLocalUrl(url)) {
    const { bucket, path } = splitPrefixedUrl(url, LOCAL_PREFIX);
    return readFileSync(localPathFor(bucket, path));
  }
  if (isRemoteUrl(url)) {
    const { bucket, path } = splitPrefixedUrl(url, REMOTE_PREFIX);
    return downloadFile(bucket, path);
  }
  // Plain https: rows written before the private-bucket change, still public.
  const res = await axios.get<ArrayBuffer>(url, {
    responseType: "arraybuffer",
    timeout: 120_000,
    maxContentLength: Infinity,
    maxBodyLength: Infinity,
  });
  return Buffer.from(res.data);
}

/** Best-effort delete; never throws. */
export async function storageRemove(url: string): Promise<void> {
  try {
    if (isLocalUrl(url)) {
      const { bucket, path } = splitPrefixedUrl(url, LOCAL_PREFIX);
      const target = localPathFor(bucket, path);
      if (existsSync(target)) unlinkSync(target);
      return;
    }
    if (isRemoteUrl(url)) {
      const { bucket, path } = splitPrefixedUrl(url, REMOTE_PREFIX);
      await storageDelete(bucket, path);
      return;
    }
    // Legacy public link: recover the object path after the bucket segment.
    const marker = "/interview/";
    const idx = url.indexOf(marker);
    if (idx >= 0) {
      await storageDelete("interview", url.slice(idx + marker.length));
    }
  } catch (e) {
    console.warn(`[storage] delete failed for ${url}:`, (e as Error).message);
  }
}

export const localStorageRoot = LOCAL_ROOT;
export const localAnswersDir = join(LOCAL_ROOT, "interview", "answers");
