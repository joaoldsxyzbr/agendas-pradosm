import type { ReactNode } from "react";

export function PageHeader({ eyebrow, title, description, actions }: {
  eyebrow: string;
  title: string;
  description: string;
  actions?: ReactNode;
}) {
  return <header className="flex flex-wrap items-center justify-between gap-4 border-b border-[#344956] pb-5">
    <div className="min-w-0 space-y-1.5">
      <p className="text-xs font-medium text-slate-400">{eyebrow}</p>
      <h1 className="text-[28px] font-semibold leading-tight tracking-tight text-slate-50">{title}</h1>
      <p className="max-w-[72ch] text-sm leading-relaxed text-slate-400">{description}</p>
    </div>
    {actions}
  </header>;
}
