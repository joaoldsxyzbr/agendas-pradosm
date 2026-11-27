import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ApiError, apiFetch } from "@/lib/api";
import { NexelloPreviewConfigSchema, NexelloPreviewPageSchema, type NexelloPreviewPage, type NexelloComparison } from "../../../../../shared/nexello-preview.ts";

const comparisonLabels: Record<NexelloComparison, string> = {
  unresolved_store: "Filial não identificada", duplicate_conflict: "Protocolo divergente na página",
  multiple_local: "Mais de um registro local", not_found: "Não localizado no Prado",
  protected_local: "Registro local protegido", same_fields: "Campos coincidentes", different_fields: "Campos divergentes",
};
export function NexelloPreview() {
  const [page, setPage] = useState<NexelloPreviewPage | null>(null);
  const config = useQuery({ queryKey: ["nexello-preview-config"], queryFn: async () =>
    NexelloPreviewConfigSchema.parse(await apiFetch<unknown>("/api/admin/nexello/config")), retry: false });
  const read = useMutation({
    mutationFn: async (number: number) => NexelloPreviewPageSchema.parse(await apiFetch<unknown>("/api/admin/nexello/pages/" + number, { method: "POST" })),
    onSuccess: data => setPage(data),
  });
  return <section aria-label="Consulta Nexello" className="min-w-0 rounded-md border border-[#344956] bg-[#192734]">
    <div className="flex flex-wrap items-start justify-between gap-4 border-b border-[#344956] p-5">
      <div className="max-w-2xl">
        <p className="text-xs font-medium text-[#90c8df]">Integração · Organiza</p>
        <h2 className="mt-1 text-xl font-semibold text-white">Consulta de agendamentos</h2>
        <p className="mt-2 text-sm leading-relaxed text-slate-300">Consulte o relatório 60 e compare os protocolos com os registros do Prado. A situação de aprovação não é informada e nenhuma agenda será gravada nesta consulta.</p>
      </div>
      <Button disabled={config.data?.available !== true || read.isPending} onClick={() => read.mutate(1)}>
        <RefreshCw size={16} aria-hidden="true" />{read.isPending ? "Consultando…" : "Consultar Nexello"}
      </Button>
    </div>
    <div className="space-y-3 p-5">
      {config.isPending && <p role="status" className="text-sm text-slate-300">Verificando configuração…</p>}
      {config.isError && <p role="alert" className="text-sm text-rose-300">Não foi possível verificar a configuração.</p>}
      {config.data?.available === false && <p role="status" className="text-sm text-slate-300">Conexão desabilitada neste ambiente. A leitura depende do novo Worker e de uma configuração autorizada.</p>}
      {read.isError && <p role="alert" className="text-sm text-rose-300">{read.error instanceof ApiError ? read.error.message : "Não foi possível validar a resposta."}</p>}
      {page && <>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm tabular-nums text-slate-300">Página {page.page} de {page.lastPage} · {page.total} linhas informadas pela fonte</p>
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" disabled={read.isPending || page.page <= 1} onClick={() => read.mutate(page.page - 1)}><ChevronLeft size={14} aria-hidden="true" />Anterior</Button>
            <Button variant="secondary" size="sm" disabled={read.isPending || page.page >= page.lastPage} onClick={() => read.mutate(page.page + 1)}>Próxima<ChevronRight size={14} aria-hidden="true" /></Button>
          </div>
        </div>
        <div className="overflow-x-auto rounded border border-[#344956]">
          <table aria-label="Registros observados na Nexello" className="w-full min-w-[1040px] text-left text-sm">
            <thead className="bg-[#223443] text-xs text-slate-300"><tr>{["Protocolo", "Data e horário", "Filial", "Fornecedor", "Tipo", "Situação externa", "Comparação local"].map(text => <th key={text} scope="col" className="px-3 py-3 font-medium">{text}</th>)}</tr></thead>
            <tbody className="divide-y divide-[#344956]">{page.rows.map(row => <tr key={row.index}>
              {row.kind === "invalid" ? <td colSpan={7} className="px-3 py-3 text-amber-200">Linha {row.index}: formato não reconhecido ({row.field}).</td> : <>
                <td className="px-3 py-3 tabular-nums">{row.protocol}</td>
                <td className="px-3 py-3 tabular-nums">{row.date}<span className="block text-xs text-slate-400">{row.startTime}–{row.endTime}</span></td>
                <td className="px-3 py-3">{row.storeCode ?? "Não resolvida"}</td>
                <td className="px-3 py-3">{row.supplier}</td>
                <td className="px-3 py-3">{row.type}</td>
                <td className="px-3 py-3 text-slate-300">Não informada</td>
                <td className="px-3 py-3 text-xs text-slate-200">{row.comparison ? comparisonLabels[row.comparison] : "Não comparado"}</td>
              </>}
            </tr>)}</tbody>
          </table>
          {!page.rows.length && <p className="p-4 text-sm text-slate-400">Nenhum registro nesta página.</p>}
        </div>
        <p className="text-xs leading-relaxed text-slate-400">A paginação não comprova uma visão completa ou estável do estado da Nexello. A comparação é por protocolo e campos observados, não comprova identidade, aprovação ou cancelamento. Duplicidades e alterações entre páginas ainda exigem revisão. Esta tela não permite importação automática.</p>
      </>}
    </div>
  </section>;
}
