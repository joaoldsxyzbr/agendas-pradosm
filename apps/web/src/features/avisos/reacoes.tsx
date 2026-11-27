import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { SmilePlus } from "lucide-react";
import { definirReacao } from "./api";
import type { Aviso, Reacao, ReacaoEmoji } from "./model";

const emojis: { emoji: ReacaoEmoji; label: string }[] = [
  { emoji: "👍", label: "De acordo" },
  { emoji: "👀", label: "Acompanhando" },
  { emoji: "😂", label: "Engraçado" },
];

export function Reacoes({ aviso, canReact, onChange }: { aviso: Aviso; canReact: boolean; onChange: (reacoes: Reacao[]) => void }) {
  const [aberto, setAberto] = useState(false);
  const reacoes = aviso.reacoes ?? [];
  const minha = reacoes.find(r => r.proprio)?.emoji;
  const mutation = useMutation({
    mutationFn: (emoji: ReacaoEmoji | null) => definirReacao(aviso.id, emoji),
    onSuccess: data => { onChange(data.reacoes); setAberto(false); },
  });
  if ((!canReact || aviso.proprio) && !reacoes.length) return null;
  return <div className={`flex flex-wrap items-center gap-1 text-xs ${aviso.tipo === "chat" && aviso.proprio ? "justify-end" : ""}`} data-testid={`reacoes-${aviso.id}`}>
    {emojis.map(({ emoji, label }) => {
      const grupo = reacoes.filter(r => r.emoji === emoji);
      if (!grupo.length) return null;
      return <details key={emoji} className="relative">
        <summary aria-label={`${label}: ${grupo.length} reações; consultar pessoas`} className={`cursor-pointer list-none rounded-full border px-2 py-0.5 ${minha === emoji ? "border-sky-400 bg-sky-500/20" : "border-slate-600 bg-slate-800"}`}>{emoji} {grupo.length}</summary>
        <ul className="mt-1 max-h-32 max-w-64 overflow-auto rounded border border-slate-600 bg-slate-900 p-2 text-slate-200">
          {grupo.map((r, i) => <li key={i} className="break-words">{r.nome}{r.proprio ? " (você)" : ""}</li>)}
        </ul>
      </details>;
    })}
    {canReact && !aviso.proprio && <button type="button" aria-label="Reagir" aria-expanded={aberto} className="rounded p-1 text-slate-400 hover:bg-slate-700 hover:text-slate-100 focus-visible:outline-2 focus-visible:outline-sky-400" onClick={() => setAberto(!aberto)}><SmilePlus size={15} /></button>}
    {canReact && aberto && !aviso.proprio && <div role="group" aria-label="Escolher reação" className="flex items-center gap-1 rounded-lg border border-slate-600 bg-slate-800 p-1">
      {emojis.map(({ emoji, label }) => <button key={emoji} type="button" aria-label={label} aria-pressed={minha === emoji} disabled={mutation.isPending} onClick={() => mutation.mutate(minha === emoji ? null : emoji)} className={`rounded px-2 py-1 text-lg hover:bg-slate-600 disabled:opacity-60 ${minha === emoji ? "bg-sky-500/25" : ""}`}>{emoji}</button>)}
    </div>}
    {mutation.isError && <span role="alert" className="text-rose-300">Não foi possível reagir. Tente novamente.</span>}
  </div>;
}
