import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

type Tone = "blue" | "amber" | "green" | "red";
const tones: Record<Tone, { icon: string; number: string }> = {
  blue: { icon: "text-[#90c8df]", number: "text-slate-100" },
  amber: { icon: "text-amber-300", number: "text-amber-300" },
  green: { icon: "text-emerald-300", number: "text-emerald-300" },
  red: { icon: "text-rose-300", number: "text-rose-300" },
};

export function MetricCard({ label, value, icon, tone = "blue" }: {
  label: string; value: number; icon: ReactNode; tone?: Tone;
}) {
  return <div className="flex min-h-[92px] min-w-0 items-start justify-between gap-2 border-b border-r border-[#344956] px-4 py-4 last:border-r-0 lg:border-b-0">
    <span aria-hidden="true" className={cn("order-2 grid size-6 shrink-0 place-items-center", tones[tone].icon)}>{icon}</span>
    <span className="flex min-w-0 flex-col gap-2">
      <strong className={cn("text-[28px] leading-none font-semibold tracking-tight tabular-nums", tones[tone].number)}>{value}</strong>
      <span className="text-xs leading-snug text-slate-300">{label}</span>
    </span>
  </div>;
}
