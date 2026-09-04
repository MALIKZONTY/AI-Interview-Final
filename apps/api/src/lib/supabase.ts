import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const isUrlValid = (url?: string) => {
  try {
    return !!(url && new URL(url));
  } catch {
    return false;
  }
};

export const supabase = isUrlValid(supabaseUrl)
  ? createClient(supabaseUrl!, supabaseServiceRoleKey || "")
  : null;

/**
 * Utility to upload a buffer to a Supabase storage bucket.
 */
export async function storageUpload(
  bucket: string,
  path: string,
  buffer: Buffer,
  contentType?: string
): Promise<{ url: string; path: string }> {
  if (!supabase) {
    throw new Error("Supabase client not initialized. Check your SUPABASE_URL in .env");
  }

  const { data, error } = await supabase.storage
    .from(bucket)
    .upload(path, buffer, {
      contentType,
      upsert: true,
    });

  if (error) {
    throw error;
  }

  const { data: publicData } = supabase.storage.from(bucket).getPublicUrl(data.path);

  return {
    url: publicData.publicUrl,
    path: data.path,
  };
}

/**
 * Utility to create a signed upload URL for a specific path in a bucket.
 * Valid for 60 seconds. Returns the URL the client can PUT to.
 */
export async function createSignedUploadUrl(
  bucket: string,
  path: string
): Promise<{ signedUrl: string; token: string; path: string }> {
  if (!supabase) {
    throw new Error("Supabase client not initialized.");
  }

  const { data, error } = await supabase.storage
    .from(bucket)
    .createSignedUploadUrl(path);

  if (error) {
    throw error;
  }

  return {
    signedUrl: data.signedUrl,
    token: data.token,
    path: path,
  };
}

export async function listPath(bucket: string, path: string) {
  if (!supabase) throw new Error("Supabase client not initialized.");
  const { data, error } = await supabase.storage.from(bucket).list(path, {
    sortBy: { column: "name", order: "asc" },
  });
  if (error) throw error;
  return data;
}

export async function downloadFile(bucket: string, path: string): Promise<Buffer> {
  if (!supabase) throw new Error("Supabase client not initialized.");
  const { data, error } = await supabase.storage.from(bucket).download(path);
  if (error) throw error;
  const arrayBuffer = await data.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

export async function storageDelete(bucket: string, path: string): Promise<void> {
  if (!supabase) {
    console.error(`[supabase] Cannot delete ${path}; client not initialized.`);
    return;
  }
  const { error } = await supabase.storage.from(bucket).remove([path]);
  if (error) {
    console.error(`[supabase] Failed to delete ${path} from ${bucket}`, error);
  }
}
