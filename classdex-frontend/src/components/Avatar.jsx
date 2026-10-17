import { useState } from "react";
import { getAvatarThumbnailUrl } from "../utils/photoUpload";

const AVATAR_SIZES = {
  xs: 24,
  sm: 32,
  md: 48,
  lg: 80,
  xl: 96,
};

export function getInitials(name = "") {
  const cleaned = String(name || "")
    .replace(/,/g, " ")
    .trim();
  if (!cleaned) return "U";
  const parts = cleaned.split(/\s+/).filter(Boolean);
  if (parts.length === 1) {
    return parts[0].slice(0, 2).toUpperCase();
  }
  return `${parts[0][0] || ""}${parts[parts.length - 1][0] || ""}`.toUpperCase() || "U";
}

function isUsablePhotoUrl(value) {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  if (!trimmed || trimmed === "null" || trimmed === "undefined") return false;
  return (
    trimmed.startsWith("https://") ||
    trimmed.startsWith("http://") ||
    trimmed.startsWith("data:image/") ||
    trimmed.startsWith("blob:") ||
    trimmed.startsWith("/")
  );
}

function resolveAvatarSize(size) {
  if (typeof size === "number" && Number.isFinite(size) && size > 0) {
    return { variant: "custom", px: size };
  }
  const key = typeof size === "string" ? size.trim().toLowerCase() : "md";
  if (AVATAR_SIZES[key]) {
    return { variant: key, px: AVATAR_SIZES[key] };
  }
  return { variant: "md", px: AVATAR_SIZES.md };
}

export default function Avatar({ src, name = "", alt = "", className = "", size = "md" }) {
  const [failedSrc, setFailedSrc] = useState(null);
  const { variant, px } = resolveAvatarSize(size);
  const rawSrc = isUsablePhotoUrl(src) ? src.trim() : "";
  const resolvedSrc = rawSrc ? getAvatarThumbnailUrl(rawSrc, variant, px) : "";
  const showImage = Boolean(resolvedSrc && failedSrc !== resolvedSrc);
  const initials = getInitials(name);
  const dimension = `${px}px`;
  const circleStyle = {
    width: dimension,
    height: dimension,
    minWidth: dimension,
    minHeight: dimension,
    maxWidth: dimension,
    maxHeight: dimension,
    aspectRatio: "1 / 1",
    flexShrink: 0,
    borderRadius: "9999px",
    overflow: "hidden",
  };

  return (
    <span
      className={`avatar avatar-${variant} aspect-square shrink-0 rounded-full overflow-hidden ${className}`.trim()}
      style={circleStyle}
      aria-hidden={alt ? undefined : "true"}
    >
      {showImage ? (
        <img
          src={resolvedSrc}
          alt={alt}
          width={px}
          height={px}
          loading="lazy"
          decoding="async"
          className="avatar-image h-full w-full rounded-full object-cover object-top"
          style={{ objectFit: "cover", objectPosition: "center top" }}
          onError={() => setFailedSrc(resolvedSrc)}
          onLoad={(event) => {
            if (!event.currentTarget.naturalWidth) {
              setFailedSrc(resolvedSrc);
            }
          }}
        />
      ) : (
        <span className="avatar-initials" aria-hidden="true">
          {initials}
        </span>
      )}
    </span>
  );
}

