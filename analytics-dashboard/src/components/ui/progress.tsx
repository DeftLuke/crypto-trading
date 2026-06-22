import { cn } from "@/lib/utils";

export function ProgressBar({
  value,
  className,
  barClassName,
  showLabel = true,
}: {
  value: number;
  className?: string;
  barClassName?: string;
  showLabel?: boolean;
}) {
  const pct = Math.min(100, Math.max(0, value));
  return (
    <div className={cn("flex min-w-0 items-center gap-2", className)}>
      <div className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-zinc-800">
        <div
          className={cn("h-full rounded-full bg-emerald-500 transition-all duration-500", barClassName)}
          style={{ width: `${pct}%` }}
        />
      </div>
      {showLabel && <span className="w-10 shrink-0 text-right text-xs tabular-nums text-zinc-400">{pct.toFixed(0)}%</span>}
    </div>
  );
}
