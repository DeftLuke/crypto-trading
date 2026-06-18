import { cn } from "@/lib/utils";
import { Card, CardContent } from "./card";

const variants = {
  default: "bg-zinc-700 text-zinc-200",
  secondary: "bg-zinc-800 text-zinc-300 border border-zinc-700",
  success: "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30",
  danger: "bg-red-500/15 text-red-400 border border-red-500/30",
  warning: "bg-amber-500/15 text-amber-400 border border-amber-500/30",
  info: "bg-blue-500/15 text-blue-400 border border-blue-500/30",
};

export function Badge({
  className,
  variant = "default",
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & { variant?: keyof typeof variants }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
        variants[variant],
        className
      )}
      {...props}
    />
  );
}

export function MetricCard({
  label,
  value,
  sub,
  trend,
}: {
  label: string;
  value: string;
  sub?: string;
  trend?: "up" | "down" | "neutral";
}) {
  return (
    <Card>
      <CardContent className="pt-4">
        <p className="text-xs text-zinc-500">{label}</p>
        <p
          className={cn(
            "mt-1 text-2xl font-bold tabular-nums",
            trend === "up" && "text-emerald-400",
            trend === "down" && "text-red-400",
            !trend && "text-zinc-100"
          )}
        >
          {value}
        </p>
        {sub && <p className="mt-1 text-xs text-zinc-500">{sub}</p>}
      </CardContent>
    </Card>
  );
}
