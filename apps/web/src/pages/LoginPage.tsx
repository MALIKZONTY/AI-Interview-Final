import { useEffect, useState } from "react";
import { Link, useNavigate, useLocation } from "react-router-dom";
import { ArrowRight, Command, Eye, EyeOff, Loader2, Sparkles } from "lucide-react";
import { api } from "@/lib/api";
import { useAuthStore } from "@/store/authStore";
import { AuthShowcase } from "@/components/AuthShowcase";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function LoginPage() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showPw, setShowPw] = useState(false);
  const token = useAuthStore((s) => s.token);
  const setAuth = useAuthStore((s) => s.setAuth);
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: { pathname: string } })?.from?.pathname ?? "/";

  useEffect(() => {
    if (token) navigate("/", { replace: true });
  }, [token, navigate]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const { data } = await api.post<{ token: string; user: { id: string; name: string; username: string } }>(
        "/auth/login",
        { username, password }
      );
      setAuth(data.token, data.user);
      navigate(from, { replace: true });
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error ??
        "Could not sign in";
      setError(msg);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex flex-col lg:grid lg:grid-cols-12 bg-background overflow-x-hidden font-sans">
      <AuthShowcase />

      {/* Right Side: Interaction Stage (Theme Adaptive) */}
      <div className="lg:col-span-5 flex-1 flex flex-col relative bg-background overflow-hidden relative">
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
           <div className="absolute top-[-10%] left-[-10%] w-[80%] h-[40%] bg-primary/5 blur-[100px] rounded-full"></div>
           <div className="absolute bottom-[-10%] right-[-10%] w-[60%] h-[30%] bg-primary/5 blur-[80px] rounded-full"></div>
        </div>

        {/* Mobile Header (Theme Adaptive) */}
        <header className="lg:hidden flex items-center justify-between p-6 border-b border-border bg-background/50 backdrop-blur-md sticky top-0 z-20">
            <div className="flex items-center gap-2 text-foreground">
                <div className="w-8 h-8 bg-primary rounded-xl flex items-center justify-center shadow-lg shadow-primary/20">
                    <Command className="text-primary-foreground h-5 w-5" />
                </div>
                <div className="flex flex-col">
                    <span className="text-sm font-display font-black tracking-tighter uppercase leading-none italic">EVOLVE</span>
                    <span className="text-[7px] font-bold text-muted-foreground uppercase tracking-[0.2em] mt-0.5">AI INTERVIEW SYSTEM</span>
                </div>
            </div>
            <div className="flex gap-2">
                 <div className="w-1.5 h-1.5 rounded-full bg-primary/20"></div>
                 <div className="w-1.5 h-1.5 rounded-full bg-primary/40"></div>
                 <div className="w-1.5 h-1.5 rounded-full bg-primary/60"></div>
            </div>
        </header>

        <div className="flex-1 flex flex-col items-center justify-center p-6 sm:p-12 relative z-10 w-full max-w-lg mx-auto">
          <div className="w-full space-y-10 sm:space-y-12 animate-slide-up py-8">
            <div className="space-y-4 text-center lg:text-left">
              <h2 className="text-4xl sm:text-5xl font-display font-black tracking-tighter leading-none text-foreground italic">Welcome back.</h2>
              <p className="text-muted-foreground text-sm font-medium leading-relaxed">
                Sign in to continue practising.
              </p>
            </div>

            <div className="space-y-10">
              <form onSubmit={onSubmit} className="space-y-8">
                <div className="space-y-6">
                  <div className="space-y-2">
                    <Label htmlFor="username" className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground ml-1">Username</Label>
                    <Input
                      id="username"
                      type="text"
                      autoComplete="username"
                      required
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      placeholder="your username"
                      className="h-14 rounded-2xl bg-card border-border focus:border-primary/40 focus:ring-4 focus:ring-primary/5 transition-all font-medium text-foreground shadow-sm"
                    />
                  </div>
                  <div className="space-y-2 relative">
                    <div className="flex justify-between items-center ml-1">
                      <Label htmlFor="password" className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground">Password</Label>
                    </div>
                    <Input
                      id="password"
                      type={showPw ? "text" : "password"}
                      autoComplete="current-password"
                      required
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="••••••••"
                      className="h-14 rounded-2xl bg-card border-border focus:border-primary/40 focus:ring-4 focus:ring-primary/5 transition-all font-medium text-foreground shadow-sm pr-12"
                    />
                    <button
                      type="button"
                      className="absolute right-4 bottom-4 text-muted-foreground/40 hover:text-primary transition-colors"
                      onClick={() => setShowPw(!showPw)}
                      aria-label={showPw ? "Hide password" : "Show password"}
                      aria-pressed={showPw}
                    >
                      {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>

                {error && (
                  <div className="p-4 rounded-2xl bg-destructive/5 border border-destructive/20 text-[10px] font-black text-destructive text-center animate-shake backdrop-blur-md uppercase tracking-widest">
                    {error}
                  </div>
                )}

                <Button type="submit" className="w-full h-16 rounded-[2rem] text-sm font-black shadow-2xl shadow-primary/10 hover:shadow-primary/20 transition-all group bg-primary hover:bg-primary/90 text-primary-foreground" disabled={loading}>
                  {loading ? (
                    <div className="flex items-center gap-3">
                      <Loader2 className="h-5 w-5 animate-spin" />
                      <span className="tracking-[0.2em] uppercase">Signing in...</span>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <span className="tracking-[0.2em] ml-2">SIGN IN</span>
                      <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
                    </div>
                  )}
                </Button>
              </form>

              <div className="relative py-2">
                <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-[1px] bg-border"></div>
                <div className="relative z-10 flex justify-center">
                  <span className="bg-background px-6 text-[10px] font-black text-muted-foreground/40 uppercase tracking-[0.3em]">or</span>
                </div>
              </div>

              <div className="text-center space-y-6">
                <div className="space-y-4">
                  <p className="text-xs font-semibold text-muted-foreground">Don't have an account?</p>
                  <Button variant="outline" className="w-full h-14 rounded-2xl border-primary/20 bg-background hover:bg-primary/5 hover:border-primary/40 font-black text-primary text-[10px] uppercase tracking-[0.2em] group shadow-sm transition-all shadow-none" asChild>
                    <Link to="/signup">
                      CREATE AN ACCOUNT
                      <Sparkles className="h-3 w-3 ml-2 group-hover:rotate-12 transition-transform" />
                    </Link>
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
