import * as React from "react";
import { cn } from "@/lib/utils";

type ProgressProps = React.HTMLAttributes<HTMLDivElement> & { value: number };

/** Simple determinate progress (0–100) for scores and timers. */
function Progress({ className, value, ...props }: ProgressProps) {
  const v = Math.min(100, Math.max(0, value));
  return (
    <div
      className={cn("relative h-2 w-full overflow-hidden rounded-full bg-muted", className)}
      {...props}
    >
      <div
        className="h-full bg-primary transition-all duration-300 ease-out rounded-full"
        style={{ width: `${v}%` }}
      />
    </div>
  );
}

export { Progress };
