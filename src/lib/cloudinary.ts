import { v2 as cloudinary } from "cloudinary";

/**
 * Cloudinary configuration — server-side only.
 * Photos are uploaded to Cloudinary instead of local filesystem.
 * This means photos persist across deployments and are CDN-served.
 */

let configured = false;

try {
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
  });
  configured = true;
} catch {
  // Will fallback to local FS if not configured
}

export const isCloudinaryConfigured = configured;

/**
 * Upload a file buffer to Cloudinary.
 * @param buffer - The file buffer (from FormData File.arrayBuffer())
 * @param folder - Cloudinary folder (e.g. "broker-os/bookings")
 * @returns { url, publicId } or null on failure
 */
export async function uploadToCloudinary(
  buffer: Buffer,
  folder: string = "broker-os",
): Promise<{ url: string; publicId: string } | null> {
  if (!configured) return null;

  try {
    const result = await cloudinary.uploader.upload(
      `data:image/jpeg;base64,${buffer.toString("base64")}`,
      {
        folder,
        resource_type: "image",
        transformation: [
          { width: 1200, height: 1200, crop: "limit" }, // max 1200px
          { quality: "auto" }, // auto-optimize quality
        ],
      },
    );
    return { url: result.secure_url, publicId: result.public_id };
  } catch (error) {
    console.error("[cloudinary] Upload failed:", error);
    return null;
  }
}

/**
 * Generate a thumbnail URL from a Cloudinary URL.
 * Cloudinary supports on-the-fly transformations via URL params.
 * @param url - The full Cloudinary URL
 * @param width - Thumbnail width (default 400)
 * @returns thumbnail URL
 */
export function getCloudinaryThumbnail(url: string, width: number = 400): string {
  if (!url || !url.includes("cloudinary.com")) return url;
  // Insert transformation params into the URL
  // e.g. .../upload/v123/photo.jpg → .../upload/c_limit,w_400/f_auto/q_auto/v123/photo.jpg
  return url.replace(
    "/upload/",
    `/upload/c_limit,w_${width},h_${width}/f_auto/q_auto/`,
  );
}

/**
 * Delete a photo from Cloudinary by publicId.
 */
export async function deleteFromCloudinary(publicId: string): Promise<boolean> {
  if (!configured) return false;
  try {
    await cloudinary.uploader.destroy(publicId);
    return true;
  } catch (error) {
    console.error("[cloudinary] Delete failed:", error);
    return false;
  }
}

/**
 * Upload with unsigned upload (for client-side direct uploads if needed).
 * Uses Cloudinary's unsigned upload preset.
 */
export async function uploadUnsigned(
  file: File,
  uploadPreset: string,
): Promise<{ url: string; publicId: string } | null> {
  try {
    const formData = new FormData();
    formData.append("file", file);
    formData.append("upload_preset", uploadPreset);

    const res = await fetch(
      `https://api.cloudinary.com/v1_1/${process.env.CLOUDINARY_CLOUD_NAME}/image/upload`,
      { method: "POST", body: formData },
    );

    if (!res.ok) return null;
    const data = await res.json();
    return { url: data.secure_url, publicId: data.public_id };
  } catch (error) {
    console.error("[cloudinary] Unsigned upload failed:", error);
    return null;
  }
}
