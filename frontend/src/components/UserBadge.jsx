/**
 * Compact display for a user reference resolved by the backend (`*_user` fields).
 * Server shape: { id, name, email, is_deleted, exists } | null
 *
 * Rendering rules:
 *  - null / undefined          → muted dash "—"
 *  - exists:false              → muted italic "Unknown user"
 *  - exists:true, deleted:true → "<name> (deleted)" muted italic
 *  - exists:true, deleted:false→ name (bold optional)
 */
export default function UserBadge({ user, fallback = "—", bold = false, className = "", testid }) {
  if (!user) {
    return <span className={`text-gray-400 ${className}`} data-testid={testid}>{fallback}</span>;
  }
  if (!user.exists) {
    return (
      <span className={`italic text-gray-400 ${className}`} data-testid={testid}>
        Unknown user
      </span>
    );
  }
  const display = user.name || user.email || "User";
  if (user.is_deleted) {
    return (
      <span className={`italic text-gray-500 ${className}`} data-testid={testid}>
        {display}{" "}
        <span className="text-[10px] uppercase tracking-wider font-bold text-red-700 not-italic">(deleted)</span>
      </span>
    );
  }
  return (
    <span className={`${bold ? "font-semibold text-[#1F2A33]" : "text-gray-700"} ${className}`} data-testid={testid}>
      {display}
    </span>
  );
}
