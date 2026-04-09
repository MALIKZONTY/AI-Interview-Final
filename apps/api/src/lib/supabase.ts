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
