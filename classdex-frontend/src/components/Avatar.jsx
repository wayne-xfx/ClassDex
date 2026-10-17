import { useState } from "react";

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

export default function Avatar({ src, name = "", alt = "", className = "", size }) {
  const [failedSrc, setFailedSrc] = useState(null);
  const validSrc = typeof src === "string" ? src.trim() : "";
  const showImage = Boolean(validSrc && failedSrc !== validSrc);
  const initials = getInitials(name);
  const style = size
    ? {
        width: typeof size === "number" ? `${size}px` : size,
        height: typeof size === "number" ? `${size}px` : size,
      }
    : undefined;

  return (
    <span
      className={`avatar ${className}`.trim()}
      style={style}
      aria-hidden={alt ? undefined : "true"}
    >
      {showImage ? (
        <img
          src={validSrc}
          alt={alt}
          loading="lazy"
          className="avatar-image"
          onError={() => setFailedSrc(validSrc)}
        />
      ) : (
        <span className="avatar-initials" aria-hidden="true">
          {initials}
        </span>
      )}
    </span>
  );
}
