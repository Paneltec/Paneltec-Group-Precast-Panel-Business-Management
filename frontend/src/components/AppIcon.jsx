/*
 * AppIcon — Microsoft Fluent Emoji 3D icon renderer.
 *
 * Usage:
 *   <AppIcon name="email" size={16} alt="Email" className="..." />
 *
 * The `name` is a concept key from /components/icon-map.json. The map resolves to
 * a Fluent UI Emoji folder; the filename is derived (lowercase, spaces → underscores,
 * hyphens preserved). Assets are served from jsDelivr CDN with long-term caching.
 *
 * Some Fluent emojis have a per-skin-tone subdir — for those, the map value is
 *   { folder: "Construction worker", skin: "Default" }
 * and the URL becomes  …/assets/<Folder>/<Skin>/3D/<file>_3d_<skin>.png
 *
 * Fallback chain:
 *   1) Mapped folder → CDN <img>
 *   2) `fallback` prop (lucide icon component) → rendered at the same size
 *   3) Empty span (zero visual cost) so layouts never break
 *
 * Lucide icons that legitimately STAY (don't swap to emoji at small sizes):
 *   - Chevron{Down,Up,Left,Right} — dropdown carets
 *   - Loader2 — spinning loaders
 *   - X — close buttons (Fluent's "Cross mark" is too red/loud at 14px)
 */
import iconMap from "./icon-map.json";

const CDN_BASE = "https://cdn.jsdelivr.net/gh/microsoft/fluentui-emoji@main/assets";

const toFile = (folder) =>
  folder.toLowerCase().replace(/ /g, "_") + "_3d";

const resolveUrl = (entry) => {
  if (!entry) return null;
  if (typeof entry === "string") {
    const folder = encodeURIComponent(entry);
    return `${CDN_BASE}/${folder}/3D/${toFile(entry)}.png`;
  }
  // skin-toned variant
  const folder = encodeURIComponent(entry.folder);
  const skin = entry.skin || "Default";
  const file = `${toFile(entry.folder)}_${skin.toLowerCase()}.png`;
  return `${CDN_BASE}/${folder}/${skin}/3D/${file}`;
};

export default function AppIcon({
  name,
  size = 20,
  alt,
  className = "",
  fallback: Fallback = null,
  decorative = false,
  style: extraStyle = {},
  ...rest
}) {
  const entry = iconMap[name];
  const url = resolveUrl(entry);

  if (!url) {
    if (Fallback) return <Fallback size={size} className={className} {...rest} />;
    return <span className={className} style={{ display: "inline-block", width: size, height: size }} aria-hidden="true" />;
  }

  return (
    <img
      src={url}
      alt={decorative ? "" : (alt || name)}
      aria-hidden={decorative || undefined}
      role={decorative ? "presentation" : "img"}
      loading="lazy"
      decoding="async"
      width={size}
      height={size}
      draggable={false}
      className={className}
      style={{
        display: "inline-block",
        verticalAlign: "-3px",
        userSelect: "none",
        objectFit: "contain",
        flexShrink: 0,
        ...extraStyle,
      }}
      data-icon={name}
      {...rest}
    />
  );
}
