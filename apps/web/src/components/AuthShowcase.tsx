import { useEffect, useState } from "react";
import { Command } from "lucide-react";

/**
 * The branding panel beside the sign-in and sign-up forms.
 *
 * Both pages render this same component so the two screens cannot drift apart —
 * they previously showed entirely different things, a rotating carousel on one and
 * a static feature list on the other.
 *
 * Desktop only: below `lg` the forms take the full width and the mobile header in
 * each page carries the branding instead.
 */

const SLIDES = [
  {
    url: "/branding/stage-1.png",
    slogan: "Master the Stage.",
    desc: "Practice interviews in a real-time AI simulation.",
  },
  {
    url: "/branding/stage-2.png",
    slogan: "Accelerate Growth.",
    desc: "Unlock your professional blueprint.",
  },
  {
    url: "/branding/stage-3.png",
    slogan: "Precision Feedback.",
    desc: "Get deep-scan insights in minutes.",
  },
];

const ROTATE_MS = 5000;

export function AuthShowcase() {
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    // Respect a reduced-motion preference by holding on the first slide.
    const reduced =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduced) return;

    const interval = setInterval(() => {
      setActiveIndex((prev) => (prev + 1) % SLIDES.length);
    }, ROTATE_MS);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="relative hidden lg:flex lg:col-span-7 flex-col justify-between overflow-hidden bg-black border-r border-white/5">
      {SLIDES.map((slide, i) => (
        <div
          key={slide.url}
          className={`absolute inset-0 transition-opacity duration-1000 ease-in-out ${
            i === activeIndex ? "opacity-50" : "opacity-0"
          }`}
        >
          <img src={slide.url} alt="" aria-hidden className="w-full h-full object-cover scale-105" />
        </div>
      ))}

      <div className="absolute inset-0 bg-gradient-to-t from-black via-transparent to-transparent"></div>

      <div className="relative z-10 p-16 flex flex-col justify-between h-full">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 bg-white rounded-2xl flex items-center justify-center shadow-xl shadow-white/10 ring-1 ring-white/20">
            <Command className="text-primary h-6 w-6" />
          </div>
          <div className="flex flex-col">
            <div className="flex items-center gap-2">
              <span className="text-2xl font-display font-black tracking-tighter text-white leading-none uppercase italic">
                EVOLVE
              </span>
              <span className="text-[10px] font-bold text-white/40 uppercase tracking-[0.2em] mt-0.5">
                {" "}
                AI Interview System
              </span>
            </div>
          </div>
        </div>

        <div className="max-w-xl space-y-6">
          <div className="flex gap-2">
            {SLIDES.map((slide, i) => (
              <div
                key={slide.url}
                className={`h-1 rounded-full transition-all duration-500 ${
                  i === activeIndex ? "w-12 bg-primary" : "w-4 bg-white/20"
                }`}
              />
            ))}
          </div>
          <div className="space-y-4 animate-slide-up" key={activeIndex}>
            <h1 className="text-7xl font-display font-black text-white leading-none tracking-tighter italic">
              {SLIDES[activeIndex].slogan}
            </h1>
            <p className="text-white/60 text-lg font-medium max-w-md italic">
              {SLIDES[activeIndex].desc}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
