import { useState } from "react";
import { useNavigate, Navigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";

export default function Login() {
  const { user, loading, login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  if (loading) return null;
  if (user) return <Navigate to="/" replace />;

  const onSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    const res = await login(email.trim().toLowerCase(), password);
    setSubmitting(false);
    if (res.ok) navigate("/");
    else setError(res.error || "Login failed");
  };

  return (
    <div
      className="min-h-screen w-full flex items-center justify-center relative"
      style={{
        backgroundImage:
          "linear-gradient(rgba(31,42,51,0.92), rgba(31,42,51,0.92)), url('https://images.unsplash.com/photo-1521459467264-802e2ef3141f?crop=entropy&cs=srgb&fm=jpg&ixid=M3w4NTYxOTF8MHwxfHNlYXJjaHwxfHxjb25jcmV0ZSUyMHdhbGwlMjB0ZXh0dXJlfGVufDB8fHx8MTc4MTQyNjIzMXww&ixlib=rb-4.1.0&q=85')",
        backgroundSize: "cover",
        backgroundPosition: "center",
      }}
    >
      <div className="w-full max-w-md mx-4">
        <div className="text-center mb-8">
          <div className="brand-wordmark text-4xl text-white leading-none">Paneltec</div>
          <div className="brand-wordmark text-4xl text-[#F5C518] leading-none">Group</div>
          <div className="mt-3 text-xs uppercase tracking-[0.28em] text-white/60">Precast Panel Business Management</div>
        </div>

        <div className="bg-white rounded p-8 shadow-2xl border border-white/10" data-testid="login-card">
          <h1 className="text-2xl font-bold tracking-tight text-[#1F2A33] mb-1">Sign in</h1>
          <p className="text-sm text-gray-500 mb-6">Use your Paneltec account to continue.</p>

          <form onSubmit={onSubmit} className="space-y-4">
            <div>
              <Label htmlFor="email" className="text-xs uppercase tracking-wider text-[#3A6B8C] font-bold">Email</Label>
              <Input
                id="email"
                type="email"
                autoComplete="username"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@paneltec.com.au"
                className="mt-1 h-11"
                data-testid="login-email-input"
              />
            </div>
            <div>
              <Label htmlFor="password" className="text-xs uppercase tracking-wider text-[#3A6B8C] font-bold">Password</Label>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="mt-1 h-11"
                data-testid="login-password-input"
              />
            </div>

            {error && (
              <div
                data-testid="login-error"
                className="text-sm text-red-700 bg-red-50 border border-red-200 px-3 py-2 rounded"
              >
                {error}
              </div>
            )}

            <Button
              type="submit"
              disabled={submitting}
              data-testid="login-submit-button"
              className="w-full h-11 bg-[#F5C518] text-[#1F2A33] font-bold hover:bg-[#E0B416] focus-visible:ring-[#1F2A33]"
            >
              {submitting ? "Signing in…" : "Sign in"}
            </Button>
          </form>

          <div className="mt-6 pt-4 border-t border-gray-100 text-[11px] text-gray-400 leading-relaxed">
            Authorised personnel only. JWT-secured session.
          </div>
        </div>

        <div className="mt-6 text-center text-[10px] uppercase tracking-[0.25em] text-white/40">
          © Paneltec Group · Phase 1
        </div>
      </div>
    </div>
  );
}
