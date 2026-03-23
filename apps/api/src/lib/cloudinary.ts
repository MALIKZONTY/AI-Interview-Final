import { v2 as cloudinary } from "cloudinary";

/**
 * Configure Cloudinary from environment variables.
 * Call once at startup; safe to call multiple times.
 */
export function initCloudinary(): void {
  const { CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET } =
    process.env;
  if (!CLOUDINARY_CLOUD_NAME || !CLOUDINARY_API_KEY || !CLOUDINARY_API_SECRET) {
    console.warn(
      "[cloudinary] Missing CLOUDINARY_* env vars — uploads will fail until configured."
    );
    return;
  }
  cloudinary.config({
    cloud_name: CLOUDINARY_CLOUD_NAME,
    api_key: CLOUDINARY_API_KEY,
    api_secret: CLOUDINARY_API_SECRET,
  });
}

export { cloudinary };
