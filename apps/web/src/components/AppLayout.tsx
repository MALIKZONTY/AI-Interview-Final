import { Link, Outlet, useNavigate } from "react-router-dom";
import { Command } from "lucide-react";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Button } from "@/components/ui/button";
import { useAuthStore } from "@/store/authStore";

export function AppLayout() {
  const { user, logout } = useAuthStore();
  const navigate = useNavigate();

  return (
    <div className="min-h-screen flex flex-col">
      <header className="sticky top-0 z-40 border-b border-border/60 bg-background/80 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-[1800px] items-center justify-between px-8">
          <Link to="/" className="flex items-center gap-3 font-display font-bold text-xl tracking-tighter uppercase">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-lg shadow-primary/10 transition-transform hover:scale-105">
              <Command className="text-primary-foreground h-5 w-5" />
            </span>
            EVOLVE
          </Link>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            {user && (
              <>
                <div className="h-4 w-[1px] bg-border mx-2" />
                <span className="hidden sm:inline text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{user.username}</span>
                <Button
                  variant="ghost"
                  size="sm"
                  className="rounded-full px-4 text-[10px] font-bold uppercase tracking-widest hover:bg-destructive/10 hover:text-destructive"
                  onClick={() => {
                    logout();
                    navigate("/login");
                  }}
                >
                  Log out
                </Button>
              </>
            )}
          </div>
        </div>
      </header>
      <main className="flex-1 mx-auto w-full max-w-[1800px] px-8 py-10 animate-fade-in">
        <Outlet />
      </main>
    </div>
  );
}
