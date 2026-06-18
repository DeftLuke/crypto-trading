"use client";

import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

const tooltipStyle = {
  contentStyle: { background: "#18181b", border: "1px solid #3f3f46", borderRadius: 8 },
  labelStyle: { color: "#a1a1aa" },
};

export function EquityChart({ data }: { data: { label: string; value: number }[] }) {
  if (!data.length) return <div className="flex h-48 items-center justify-center text-sm text-zinc-500">No data</div>;
  return (
    <ResponsiveContainer width="100%" height={220}>
      <AreaChart data={data}>
        <defs>
          <linearGradient id="eq" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#10b981" stopOpacity={0.35} />
            <stop offset="100%" stopColor="#10b981" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
        <XAxis dataKey="label" tick={{ fill: "#71717a", fontSize: 10 }} />
        <YAxis tick={{ fill: "#71717a", fontSize: 10 }} width={48} />
        <Tooltip {...tooltipStyle} />
        <Area type="monotone" dataKey="value" stroke="#10b981" fill="url(#eq)" strokeWidth={2} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function DrawdownChart({ data }: { data: { label: string; value: number }[] }) {
  if (!data.length) return null;
  return (
    <ResponsiveContainer width="100%" height={160}>
      <AreaChart data={data}>
        <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
        <XAxis dataKey="label" tick={{ fill: "#71717a", fontSize: 10 }} />
        <YAxis tick={{ fill: "#71717a", fontSize: 10 }} width={40} />
        <Tooltip {...tooltipStyle} />
        <Area type="monotone" dataKey="value" stroke="#ef4444" fill="#ef444433" strokeWidth={1.5} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function BarChartSimple({ data, dataKey = "value" }: { data: Record<string, unknown>[]; dataKey?: string }) {
  return (
    <ResponsiveContainer width="100%" height={200}>
      <BarChart data={data}>
        <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
        <XAxis dataKey="label" tick={{ fill: "#71717a", fontSize: 10 }} />
        <YAxis tick={{ fill: "#71717a", fontSize: 10 }} width={40} />
        <Tooltip {...tooltipStyle} />
        <Bar dataKey={dataKey} fill="#10b981" radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function LineChartSimple({ data, lines }: { data: Record<string, unknown>[]; lines: string[] }) {
  const colors = ["#10b981", "#3b82f6", "#f59e0b"];
  return (
    <ResponsiveContainer width="100%" height={200}>
      <LineChart data={data}>
        <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
        <XAxis dataKey="label" tick={{ fill: "#71717a", fontSize: 10 }} />
        <YAxis tick={{ fill: "#71717a", fontSize: 10 }} width={40} />
        <Tooltip {...tooltipStyle} />
        {lines.map((key, i) => (
          <Line key={key} type="monotone" dataKey={key} stroke={colors[i % colors.length]} dot={false} strokeWidth={2} />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}
