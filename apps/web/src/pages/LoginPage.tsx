import { useEffect, useState } from "react";
import { Link, useNavigate, useLocation } from "react-router-dom";
import { 
  Sparkles, Command, UploadCloud, Brain, 
  Video, BarChart4, ArrowRight, Loader2
} from "lucide-react";
import { api } from "@/lib/api";
import { useAuthStore } from "@/store/authStore";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
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
      const { data } = await api.post<{ token: string; user: { id: string; name: string; email: string } }>(
        "/auth/login",
        { email, password }
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

  const lifecycle = [
    { 
        icon: UploadCloud, 
        title: "Upload Your Profile", 
        desc: "Give it a topic, or upload your resume. The AI reads whichever you choose and builds the questions from it.",
        color: "text-blue-400"
    },
    { 
        icon: Brain, 
        title: "Think & Prepare", 
        desc: "See your questions ahead of time. You get 10 seconds to plan each answer so you stay calm and focused.",
        color: "text-indigo-400"
    },
    { 
        icon: Video, 
        title: "Practice with AI", 
        desc: "Talk to an AI interviewer that listens. It tracks your confidence and skills in a real-time simulation.",
        color: "text-violet-400"
    },
    { 
        icon: BarChart4, 
        title: "Get Expert Feedback", 
        desc: "Receive a full report on your technical accuracy, confidence just minutes after finishing.",
        color: "text-fuchsia-400"
    }
  ];

  return (
    <div className="min-h-screen flex flex-col lg:grid lg:grid-cols-12 bg-background overflow-x-hidden font-sans">
      {/* Left Side: Cinematic Marketing Block (Remains Dark/Atmospheric) */}
      <div className="relative hidden lg:flex lg:col-span-7 flex-col justify-between p-16 bg-gradient-to-br from-slate-950 via-black to-slate-900 overflow-hidden border-r border-white/5">
        <div className="absolute top-0 left-0 w-full h-full opacity-30 pointer-events-none">
          <div className="absolute top-[-10%] left-[-10%] w-[50%] h-[50%] bg-indigo-500 rounded-full blur-[140px] animate-pulse"></div>
          <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-violet-500 rounded-full blur-[120px] animate-pulse [animation-delay:2s]"></div>
        </div>
        
        <div className="relative z-10 flex items-center gap-3">
          <div className="w-11 h-11 bg-white rounded-2xl flex items-center justify-center shadow-xl shadow-white/10 ring-1 ring-white/20">
            <Command className="text-indigo-600 h-6 w-6" />
          </div>
          <div className="flex flex-col">
            <div className="flex items-center gap-2">
              <span className="text-2xl font-display font-black tracking-tighter text-white leading-none uppercase italic">EVOLVE</span>
              <span className="text-[10px] font-bold text-white/40 uppercase tracking-[0.2em] mt-0.5"> AI Interview System</span>
            </div>
          </div>
        </div>

        <div className="relative z-10 max-w-xl self-center w-full space-y-12">
          <div className="space-y-4">
            <h1 className="text-5xl font-display font-black text-white leading-none tracking-tighter italic">
              Experience the <span className="text-transparent bg-clip-text bg-gradient-to-r from-indigo-300 to-violet-200">future of talent.</span>
            </h1>
            <div className="w-20 h-1 bg-white/20 rounded-full"></div>
          </div>

          <div className="space-y-10 text-white">
            {lifecycle.map((step, i) => (
              <div key={i} className="flex gap-8 group transition-all duration-500 hover:translate-x-2">
                <div className="relative flex flex-col items-center">
                  <div className={`w-14 h-14 rounded-2xl bg-white/5 border border-white/10 shadow-lg flex items-center justify-center relative z-10 transition-transform group-hover:scale-110 group-hover:bg-white group-hover:border-white shadow-indigo-500/10`}>
                    <step.icon className={`h-6 w-6 ${step.color} group-hover:text-indigo-600 transition-colors`} />
                  </div>
                  {i < lifecycle.length - 1 && (
                    <div className="w-0.5 h-full bg-gradient-to-b from-white/20 to-transparent absolute top-14"></div>
                  )}
                </div>
                <div className="space-y-1 py-1">
                  <h3 className="text-lg font-black tracking-tight uppercase italic">{step.title}</h3>
                  <p className="opacity-50 text-sm leading-relaxed font-medium line-clamp-2 group-hover:line-clamp-none transition-all duration-500">{step.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="relative z-10 flex items-center justify-between border-t border-white/5 pt-8">
          <div className="flex flex-col gap-1">
            <h2 className="text-xl md:text-2xl font-display font-black tracking-tighter text-indigo-200 italic">
              Master the Stage. <span className="text-white/40">Own your Career.</span>
            </h2>
          </div>
        </div>
      </div>

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
              <h2 className="text-4xl sm:text-5xl font-display font-black tracking-tighter leading-none text-foreground italic">Elevate your practice.</h2>
              <p className="text-muted-foreground text-sm font-medium leading-relaxed">
                Experience the world's most advanced AI interview simulator. Join the next generation of professional talent.
              </p>
            </div>

            <div className="space-y-10">
              <form onSubmit={onSubmit} className="space-y-8">
                <div className="space-y-6">
                  <div className="space-y-2">
                    <Label htmlFor="email" className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground ml-1">Email Identity</Label>
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
                  <div className="space-y-2">
                    <div className="flex justify-between items-center ml-1">
                      <Label htmlFor="password" className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground">Credentials</Label>
                    </div>
                    <Input
                      id="password"
                      type="password"
                      autoComplete="current-password"
                      required
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="••••••••"
                      className="h-14 rounded-2xl bg-card border-border focus:border-primary/40 focus:ring-4 focus:ring-primary/5 transition-all font-medium text-foreground shadow-sm"
                    />
                  </div>
                </div>

                {error && (
                  <div className="p-4 rounded-2xl bg-destructive/5 border border-destructive/20 text-[10px] font-black text-destructive text-center animate-shake backdrop-blur-md uppercase tracking-widest">
                    AUTHENTICATION FAILED: {error}
                  </div>
                )}

                <Button type="submit" className="w-full h-16 rounded-[2rem] text-sm font-black shadow-2xl shadow-primary/10 hover:shadow-primary/20 transition-all group bg-primary hover:bg-primary/90 text-primary-foreground" disabled={loading}>
                  {loading ? (
                    <div className="flex items-center gap-3">
                      <Loader2 className="h-5 w-5 animate-spin" />
                      <span className="tracking-[0.3em] uppercase">Authenticating Stage...</span>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <span className="tracking-[0.3em] ml-2">ACCESS PLATFORM</span>
                      <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
                    </div>
                  )}
                </Button>
              </form>

              <div className="relative py-2">
                <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-[1px] bg-border"></div>
                <div className="relative z-10 flex justify-center">
                  <span className="bg-background px-6 text-[10px] font-black text-muted-foreground/40 uppercase tracking-[0.5em] italic">System Split</span>
                </div>
              </div>

              <div className="text-center space-y-6">
                <div className="space-y-4">
                  <p className="text-xs font-semibold text-muted-foreground italic">New to the platform?</p>
                  <Button variant="outline" className="w-full h-14 rounded-2xl border-primary/20 bg-background hover:bg-primary/5 hover:border-primary/40 font-black text-primary text-[10px] uppercase tracking-[0.2em] group shadow-sm transition-all shadow-none" asChild>
                    <Link to="/signup">
                      REQUEST ACCESS CREDENTIALS
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
