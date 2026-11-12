const MAX_PHOTO_SIZE = 5 * 1024 * 1024;
const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

const VARIANT_THUMBNAIL_SIZES = {
  xs: 48,
  sm: 64,
  md: 96,
  lg: 160,
  xl: 192,
};

export function getAvatarThumbnailUrl(url, variant = "md", px = 48) {
  if (typeof url !== "string") return "";
  const trimmed = url.trim();
  if (!trimmed) return "";

  const uploadMarker = "/image/upload/";
  const markerIndex = trimmed.indexOf(uploadMarker);
  if (markerIndex === -1 || !/^https?:\/\/res\.cloudinary\.com\//i.test(trimmed)) {
    return trimmed;
  }

  const prefix = trimmed.slice(0, markerIndex + uploadMarker.length);
  const rest = trimmed.slice(markerIndex + uploadMarker.length);
  if (!rest || /^(?:[^/]*\b(?:w_\d+|h_\d+|c_fill)\b[^/]*)\//.test(rest)) {
    return trimmed;
  }

  const targetPx =
    VARIANT_THUMBNAIL_SIZES[variant] ||
    Math.max(48, Math.round((Number(px) || 48) * 2));
  const transformation = `w_${targetPx},h_${targetPx},c_fill,g_face,f_auto,q_auto`;
  return `${prefix}${transformation}/${rest}`;
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") resolve(reader.result);
      else reject(new Error("Unable to read that photo."));
    };
    reader.onerror = () => reject(new Error("Unable to read that photo."));
    reader.readAsDataURL(file);
  });
}

export async function uploadPhoto(file, options = {}) {
  if (!file || !ALLOWED_TYPES.has(file.type)) {
    throw new Error("Choose a JPG, PNG, or WebP image.");
  }
  if (file.size > MAX_PHOTO_SIZE) {
    throw new Error("Choose an image smaller than 5 MB.");
  }

  const hasViteEnv = typeof import.meta !== "undefined" && Boolean(import.meta.env);
  const cloudName = String(
    options.cloudName ?? (hasViteEnv ? import.meta.env.VITE_CLOUDINARY_CLOUD_NAME : "") ?? "",
  ).trim();
  const uploadPreset = String(
    options.uploadPreset ?? (hasViteEnv ? import.meta.env.VITE_CLOUDINARY_UPLOAD_PRESET : "") ?? "",
  ).trim();
  const isDev = options.isDev ?? (hasViteEnv ? Boolean(import.meta.env.DEV) : false);
  const fetchImpl = options.fetch ?? fetch;
  const readDataUrl = options.readAsDataUrl ?? readFileAsDataUrl;

  if (cloudName && uploadPreset) {
    const form = new FormData();
    form.append("file", file);
    form.append("upload_preset", uploadPreset);

    let failureReason = "";
    try {
      const response = await fetchImpl(
        `https://api.cloudinary.com/v1_1/${encodeURIComponent(cloudName)}/image/upload`,
        { method: "POST", body: form },
      );
      let result = null;
      try {
        result = await response.json();
      } catch {
        result = null;
      }
      if (response.ok && result?.secure_url) {
        return result.secure_url;
      }
      failureReason =
        result?.error?.message ||
        (!response.ok ? `HTTP ${response.status}` : "Cloudinary response missing secure_url");
    } catch (networkError) {
      failureReason = networkError?.message || "Network request failed";
    }

    if (isDev) {
      console.warn(
        `Cloudinary upload failed (${failureReason}). Using local data URL photo fallback for development.`,
      );
      return readDataUrl(file);
    }

    console.error("Cloudinary upload failed:", failureReason);
    throw new Error("Unable to upload photo right now. Please try again.");
  }

  if (isDev) {
    console.warn(
      "Cloudinary is not configured (VITE_CLOUDINARY_CLOUD_NAME / VITE_CLOUDINARY_UPLOAD_PRESET). Using local data URL photo fallback for development.",
    );
    return readDataUrl(file);
  }

  console.error(
    "Cloudinary is not configured (VITE_CLOUDINARY_CLOUD_NAME / VITE_CLOUDINARY_UPLOAD_PRESET) in production build.",
  );
  throw new Error("Photo upload service is not configured. Please contact your administrator.");
}
