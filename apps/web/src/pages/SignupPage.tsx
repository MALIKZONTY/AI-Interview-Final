import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  Sparkles, Command, Eye, EyeOff,
  ArrowRight, CheckCircle2, Loader2
} from "lucide-react";
import { api } from "@/lib/api";
import { useAuthStore } from "@/store/authStore";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

// High-Fidelity Assets Generated for the Carousel
const CAROUSEL_IMAGES = [
  {
    url: "/branding/stage-1.png",
    slogan: "Master the Stage.",
    desc: "Practice interviews in a real-time AI simulation."
  },
  {
    url: "/branding/stage-2.png",
    slogan: "Accelerate Growth.",
    desc: "Unlock your professional blueprint."
  },
  {
    url: "/branding/stage-3.png",
    slogan: "Precision Feedback.",
    desc: "Get deep-scan insights in minutes."
  }
];

export function SignupPage() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);

  const token = useAuthStore((s) => s.token);
  const setAuth = useAuthStore((s) => s.setAuth);
  const navigate = useNavigate();

  // Carousel Logic: Rotate every 5 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      setActiveIndex((prev) => (prev + 1) % CAROUSEL_IMAGES.length);
    }, 5000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (token) navigate("/", { replace: true });
  }, [token, navigate]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }
    if (password.length < 8) {
      setError("Password must be at least 8 characters");
      return;
    }
    setLoading(true);
    try {
      const { data } = await api.post<{
        token: string;
        user: { id: string; name: string; email: string };
      }>("/auth/register", { name, email, password, confirmPassword });
      setAuth(data.token, data.user);
      navigate("/", { replace: true });
    } catch (err: unknown) {
      const d = (err as { response?: { data?: { error?: string } } })?.response?.data;
      setError(d?.error ?? "Registration failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex flex-col lg:grid lg:grid-cols-12 bg-background overflow-x-hidden font-sans">
      {/* Left Side: Cinematic Image Carousel (Desktop Only, Remains Branding Focus) */}
      <div className="relative hidden lg:flex lg:col-span-7 flex-col justify-between overflow-hidden bg-black border-r border-white/5">
        {/* The Carousel Images */}
        {CAROUSEL_IMAGES.map((img, i) => (
          <div
            key={i}
            className={`absolute inset-0 transition-opacity duration-1000 ease-in-out ${i === activeIndex ? 'opacity-50' : 'opacity-0'}`}
          >
            <img
              src={img.url}
              alt={img.slogan}
              className="w-full h-full object-cover scale-105"
            />
          </div>
        ))}

        {/* Branding & Overlay */}
        <div className="absolute inset-0 bg-gradient-to-t from-black via-transparent to-transparent"></div>

        <div className="relative z-10 p-16 flex flex-col justify-between h-full">
          {/* Logo */}
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 bg-white rounded-2xl flex items-center justify-center shadow-xl shadow-white/10 ring-1 ring-white/20">
              <Command className="text-primary h-6 w-6" />
            </div>
            <div className="flex flex-col">
              <div className="flex items-center gap-2">
                <span className="text-2xl font-display font-black tracking-tighter text-white leading-none uppercase italic">EVOLVE</span>
                <span className="text-[10px] font-bold text-white/40 uppercase tracking-[0.2em] mt-0.5"> AI Interview System</span>
              </div>
            </div>
          </div>

          {/* Slogan Overlay */}
          <div className="max-w-xl space-y-6">
            <div className="flex gap-2">
              {CAROUSEL_IMAGES.map((_, i) => (
                <div
                  key={i}
                  className={`h-1 rounded-full transition-all duration-500 ${i === activeIndex ? 'w-12 bg-primary' : 'w-4 bg-white/20'}`}
                />
              ))}
            </div>
            <div className="space-y-4 animate-slide-up" key={activeIndex}>
              <h1 className="text-7xl font-display font-black text-white leading-none tracking-tighter italic">
                {CAROUSEL_IMAGES[activeIndex].slogan}
              </h1>
              <p className="text-white/60 text-lg font-medium max-w-md italic">
                {CAROUSEL_IMAGES[activeIndex].desc}
              </p>
            </div>
          </div>

        </div>
      </div>

      {/* Right Side: Interaction Stage (Theme Adaptive) */}
      <div className="lg:col-span-5 flex-1 flex flex-col relative bg-background overflow-hidden relative">
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div className="absolute top-[-10%] right-[-10%] w-[80%] h-[40%] bg-primary/5 blur-[100px] rounded-full"></div>
          <div className="absolute bottom-[-10%] left-[-10%] w-[60%] h-[30%] bg-primary/5 blur-[80px] rounded-full"></div>
        </div>

        {/* Mobile Header Block (Theme Adaptive) */}
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
          <div className="w-2 h-2 rounded-full bg-primary animate-pulse"></div>
        </header>

        <div className="flex-1 flex flex-col items-center justify-center p-6 sm:p-12 relative z-10 w-full max-w-lg mx-auto">
          <div className="w-full space-y-10 animate-slide-up py-8">
            <div className="space-y-4 text-center lg:text-left">
              <h2 className="text-4xl sm:text-5xl font-display font-black tracking-tighter leading-none text-foreground italic">Initialize account.</h2>
              <p className="text-muted-foreground text-sm font-medium leading-relaxed">
                Start your journey towards professional mastery.
              </p>
            </div>

            <div className="space-y-10">
              <form onSubmit={onSubmit} className="space-y-8">
                <div className="space-y-6">
                  <div className="space-y-2">
                    <Label htmlFor="name" className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground ml-1">Identity Name</Label>
                    <Input
                      id="name"
                      autoComplete="name"
                      required
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="e.g. Malik Zonty"
                      className="h-14 rounded-2xl bg-card border-border focus:border-primary/40 focus:ring-4 focus:ring-primary/5 transition-all font-medium text-foreground shadow-sm"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="email" className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground ml-1">Email Connection</Label>
                    <Input
                      id="email"
                      type="email"
                      autoComplete="email"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="email@example.com"
                      className="h-14 rounded-2xl bg-card border-border focus:border-primary/40 focus:ring-4 focus:ring-primary/5 transition-all font-medium text-foreground shadow-sm"
                    />
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                    <div className="space-y-2 relative">
                      <Label htmlFor="password" className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground ml-1">Password</Label>
                      <Input
                        id="password"
                        type={showPw ? "text" : "password"}
                        autoComplete="new-password"
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
                      >
                        {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="confirm" className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground ml-1">Confirm</Label>
                      <Input
                        id="confirm"
                        type={showPw ? "text" : "password"}
                        autoComplete="new-password"
                        required
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        placeholder="••••••••"
                        className="h-14 rounded-2xl bg-card border-border focus:border-primary/40 focus:ring-4 focus:ring-primary/5 transition-all font-medium text-foreground shadow-sm"
                      />
                    </div>
                  </div>
                </div>

                {error && (
                  <div className="p-4 rounded-2xl bg-destructive/5 border border-destructive/20 text-[10px] font-black text-destructive text-center animate-shake backdrop-blur-md uppercase tracking-widest">
                    INITIALIZATION FAILED: {error}
                  </div>
                )}

                <Button type="submit" className="w-full h-16 rounded-[2rem] text-sm font-black shadow-2xl shadow-primary/10 hover:shadow-primary/20 transition-all group bg-primary hover:bg-primary/90 text-primary-foreground mt-4" disabled={loading}>
                  {loading ? (
                    <div className="flex items-center gap-3">
                      <Loader2 className="h-5 w-5 animate-spin" />
                      <span className="tracking-[0.3em] uppercase">Constructing Identity...</span>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <span className="tracking-[0.3em] ml-2 uppercase">INITIALIZE ACCOUNT</span>
                      <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
                    </div>
                  )}
                </Button>
              </form>

              <div className="relative py-2">
                <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-[1px] bg-border"></div>
                <div className="relative z-10 flex justify-center">
                  <span className="bg-background px-6 text-[10px] font-black text-muted-foreground/40 uppercase tracking-[0.5em] italic">System Checkpoint</span>
                </div>
              </div>

              <div className="text-center">
                <p className="text-sm font-semibold text-muted-foreground italic mb-4">Already have an active profile?</p>
                <Button variant="outline" className="w-full h-14 rounded-2xl border-primary/20 bg-background hover:bg-primary/5 hover:border-primary/40 font-black text-primary text-[10px] uppercase tracking-[0.2em] group shadow-sm transition-all shadow-none" asChild>
                  <Link to="/login">
                    LOGIN TO EVOLVE
                    <Sparkles className="h-3 w-3 ml-2 group-hover:rotate-12 transition-transform" />
                  </Link>
                </Button>
              </div>
            </div>

          </div>
        </div>
      </div>
    </div>
  );
}
