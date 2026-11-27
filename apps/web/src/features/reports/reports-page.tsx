import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Activity, ArrowDownRight, ArrowRight, ArrowUpRight, CalendarDays, CheckCircle2, ChevronDown, RefreshCw, XCircle } from "lucide-react";
import { PageHeader } from "@/components/operations/page-header";
import { Loading } from "@/components/ui/loading";
import { Button } from "@/components/ui/button";
import { formatDay } from "@/features/receiving/model";
import { getOccurrences, getReport, getStores } from "./api";
import { Card, Panel, ReportDialog, Failure, HelpTip } from "./reports-shell";
import {
  clampPercent, delta, group, occurrenceCount, initialFilters, numberBR, percentBR,
  presetRange, previousRange, rate, totals, validRange,
  type Delta, type Grouped, type Occurrences, type OccurrenceType, type Supplier, type ReportFilters, type SemAgendaSupplier, type Totals,
} from "./model";

const panel = "min-w-0 rounded-md border border-[#344956] bg-[#192734] p-4 md:p-5";
const input = "h-9 w-full min-w-0 rounded-md border border-[#526777] bg-[#223443] px-3 text-xs text-white outline-none focus-visible:border-sky-400 [color-scheme:dark]";
const heads = "px-3 py-2.5 text-left text-xs font-semibold text-slate-300";
const cells = "px-3 py-3 text-xs text-slate-200";

const STATUS = [
  { key: "recebido", label: "Recebidos", color: "#24c78b" },
  { key: "naoChegou", label: "Não recebidos", color: "#f0525f" },
  { key: "naoCompareceu", label: "Não compareceu", color: "#ffbf40" },
  { key: "aguardando", label: "Aguardando", color: "#9464ed" },
  { key: "recusado", label: "Recusados", color: "#94a7bf" },
] as const;

const originNames: Record<string, string> = {
  historico: "Sistema · agenda antiga concluída",
  sistema: "Sistema · fechamento do dia",
  manual: "Registrado manualmente",
};
const shortDate = (iso: string) => /^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso.slice(8) + "/" + iso.slice(5, 7) : iso;
const Empty = ({ text }: { text: string }) => <p className="text-xs text-slate-400">{text}</p>;

function DeltaTag({ delta: value }: { delta: Delta }) {
  if (!value) return null;
  const tone = value.kind === "neutral" || (!value.up && !value.down)
    ? "text-slate-400"
    : value.up === (value.kind === "good") ? "text-emerald-300" : "text-rose-300";
  return <p className={"mt-1.5 flex items-center gap-1 text-xs " + tone}>
    {value.up ? <ArrowUpRight size={12} aria-hidden="true" /> : value.down ? <ArrowDownRight size={12} aria-hidden="true" /> : null}
    {(value.value > 0 ? "+" : "") + value.value.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} vs. período anterior
  </p>;
}

function Kpis({ sum, prior, onOccurrences }: { sum: Totals; prior: Totals | null; onOccurrences: (type: OccurrenceType) => void }) {
  const problems = sum.naoChegou + sum.naoCompareceu + sum.recusado;
  const priorProblems = prior ? prior.naoChegou + prior.naoCompareceu + prior.recusado : null;
  const card = "min-w-0 border-b border-r border-[#344956] p-4 md:p-5 xl:border-b-0 last:border-r-0";
  const title = "flex items-center gap-1.5 text-xs font-medium text-slate-300";
  const value = "mt-3 block text-[34px] font-semibold leading-none tracking-tight tabular-nums text-white";
  const line = "flex items-center justify-between gap-2 text-xs text-slate-300";
  return <div className="grid grid-cols-1 rounded-md border border-[#344956] bg-[#192734] sm:grid-cols-2 xl:grid-cols-4" aria-label="Indicadores gerenciais">
    <section className={card}>
      <h3 className={title}><CalendarDays size={15} className="text-sky-300" aria-hidden="true" />Registros no período<HelpTip title="Registros no período" /></h3>
      <strong className={value}>{numberBR(sum.total)}</strong>
      <p className="mt-1.5 text-xs text-slate-400">{numberBR(sum.agendas)} agendas · {numberBR(sum.abertas)} abertas</p>
      <div className="mt-3 space-y-1.5 border-t border-[#344956] pt-2">
        <p className={line}>Com agendamento <strong className="tabular-nums">{numberBR(sum.total - sum.semAgenda)}</strong></p>
        <p className={line}>Aguardando <strong className="tabular-nums text-violet-300">{numberBR(sum.aguardando)}</strong></p>
      </div>
      {prior && <DeltaTag delta={delta(sum.total, prior.total)} />}
    </section>
    <section className={card}>
      <h3 className={title}><CheckCircle2 size={15} className="text-emerald-300" aria-hidden="true" />Recebidos<HelpTip title="Recebidos" /></h3>
      <strong className={value}>{numberBR(sum.recebido)}</strong>
      <div className="mt-2 flex items-center justify-between gap-2 text-xs text-slate-300">
        <span>Taxa de recebimento<HelpTip title="Taxa de recebimento" /></span><strong className="text-sm tabular-nums text-emerald-300">{sum.total ? percentBR(rate(sum)) : "—"}</strong>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[#344956]"><div className="h-full rounded-full bg-emerald-400" style={{width: clampPercent(rate(sum)) + "%"}} /></div>
      {prior && sum.total > 0 && prior.total > 0 ? <p className="mt-2 text-xs text-slate-400">{(rate(sum)-rate(prior)>0?"+":"")+(rate(sum)-rate(prior)).toLocaleString("pt-BR",{maximumFractionDigits:1})} p.p. vs. período anterior</p> : <p className="mt-2 text-xs text-slate-500">Sem comparação disponível</p>}
    </section>
    <section className={card}>
      <h3 className={title}><XCircle size={15} className="text-rose-300" aria-hidden="true" />Ocorrências<HelpTip title="Ocorrências" /></h3>
      <strong className={value}>{numberBR(problems)}</strong>
      <div className="mt-2 space-y-0.5">
        {([{ key:"nao_recebido",label:"Não recebidos",count:sum.naoChegou,tone:"text-rose-300" },{key:"nao_compareceu",label:"Não compareceu",count:sum.naoCompareceu,tone:"text-amber-300"},{key:"recusado",label:"Recusados",count:sum.recusado,tone:"text-orange-300"}] as const).map(item=>
          <button key={item.key} type="button" onClick={()=>onOccurrences(item.key)} className={line+" w-full rounded px-1 py-1 text-left hover:bg-slate-700/40 focus-visible:outline-2 focus-visible:outline-sky-400"} title={"Detalhar "+item.label.toLowerCase()}>
            <span>{item.label}</span><strong className={item.tone+" tabular-nums"}>{numberBR(item.count)}</strong>
          </button>)}
      </div>
      {prior && <DeltaTag delta={delta(problems,priorProblems,"invert")} />}
    </section>
    <section className={card}>
      <h3 className={title}><CalendarDays size={15} className="text-amber-300" aria-hidden="true" />Sem agenda<HelpTip title="Sem agenda" /></h3>
      <strong className={value}>{numberBR(sum.semAgenda)}</strong>
      <p className="mt-1.5 text-xs text-slate-400">{sum.total ? percentBR(sum.semAgenda / sum.total * 100) : "—"} dos registros</p>
      <div className="mt-3 space-y-1.5 border-t border-[#344956] pt-2">
        <p className={line}>Recebidos <strong className="tabular-nums text-emerald-300">{numberBR(sum.semAgendaRecebidos)}</strong></p>
        <p className={line}>Demais situações <strong className="tabular-nums">{numberBR(sum.semAgenda - sum.semAgendaRecebidos)}</strong></p>
      </div>
      {prior && <DeltaTag delta={delta(sum.semAgenda,prior.semAgenda)} />}
    </section>
  </div>;
}

// Evolução diária com o mesmo denominador e classificações do consolidado.
// Datas sem registros aparecem como lacunas, não como taxa de 0%.
function DailyTrend({ days, start, end }: { days: Grouped[]; start: string; end: string }) {
  if (!days.some(day=>day.total>0)) return <Empty text="Nenhum registro para apresentar a evolução diária." />;
  const byDate = new Map(days.map(day=>[day.key,day]));
  const dateKeys: string[]=[];
  for(let time=Date.parse(start+"T12:00:00Z"),last=Date.parse(end+"T12:00:00Z");time<=last&&dateKeys.length<93;time+=86400000)dateKeys.push(new Date(time).toISOString().slice(0,10));
  const peak=Math.max(1,...days.map(day=>day.total));
  const step=Math.max(1,Math.ceil(peak/3));
  const max=step*3;
  return <div>
    <div className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-slate-300">{STATUS.map(status=><span key={status.key} className="flex items-center gap-1.5"><i className="size-2 rounded-sm" style={{background:status.color}}/>{status.label}</span>)}</div>
    <div className="flex gap-2">
      <div className="flex h-36 shrink-0 flex-col justify-between py-0.5 text-right text-[10px] tabular-nums text-slate-400" aria-hidden="true">{[max,step*2,step,0].map(n=><span key={n}>{numberBR(n)}</span>)}</div>
      <div className="min-w-0 flex-1 overflow-x-auto pb-1" aria-label="Evolução diária por situação">
        <div className="relative flex gap-1.5" style={{minWidth:Math.max(0,dateKeys.length*27)+"px"}}>
          <div className="pointer-events-none absolute inset-x-0 top-0 flex h-36 flex-col justify-between" aria-hidden="true">{[0,1,2,3].map(n=><div key={n} className="border-t border-slate-700/70"/>)}</div>
          {dateKeys.map(date=>{
            const day=byDate.get(date);
            const description=formatDay(date)+(day&&day.total>0?": "+numberBR(day.total)+" registros, "+STATUS.map(status=>status.label+" "+numberBR(day[status.key])).join(", "):": sem registros");
            return <div key={date} className="relative flex min-w-0 flex-1 flex-col items-center gap-1" title={description}>
              <div className="flex h-36 w-full items-end justify-center">
                {day&&day.total>0&&<div tabIndex={0} role="img" aria-label={description} className="flex w-full max-w-7 flex-col-reverse overflow-hidden rounded-t-sm focus-visible:outline-2 focus-visible:outline-[#90c8df]" style={{height:(day.total/max*100)+"%"}}>
                  {STATUS.filter(status=>day[status.key]>0).map(status=><div key={status.key} style={{height:(day[status.key]/day.total*100)+"%",background:status.color}}/>)}
                </div>}
              </div><span className="whitespace-nowrap text-[10px] tabular-nums text-slate-400">{shortDate(date)}</span>
            </div>;
          })}
        </div>
      </div>
    </div>
    <p className="mt-1 text-[10px] text-slate-400">Volume por data da agenda · dias sem registros ficam em branco.</p>
  </div>;
}

function Donut({ sum }: { sum: Totals }) {
  if (!sum.total) return <Empty text="Nenhum agendamento no período." />;
  // Situações com valor no período: categorias zeradas não ocupam a legenda.
  const shown = STATUS.filter(status => sum[status.key] > 0);
  let used = 0;
  const stops = shown.map(status => {
    const current = used;
    used += sum[status.key] / sum.total * 100;
    return status.color + " " + current.toFixed(3) + "% " + Math.min(100, used).toFixed(3) + "%";
  }).join(", ");
  return <div className="flex flex-wrap items-center gap-5">
    <div className="relative size-32 shrink-0 rounded-full" style={{ background: "conic-gradient(" + stops + ")" }}
      role="img" aria-label={"Distribuição dos " + numberBR(sum.total) + " registros por situação."}>
      <div data-testid="donut-center" className="absolute inset-[20%] flex flex-col items-center justify-center rounded-full bg-[#192734]">
        <strong className="text-xl font-bold leading-none tabular-nums text-white">{numberBR(sum.total)}</strong>
        <small data-testid="donut-center-label" className="mt-0.5 whitespace-nowrap text-[9px] leading-none text-slate-400">registros</small>
      </div>
    </div>
    <ul className="min-w-0 flex-1 space-y-1.5">{STATUS.map(status => <li key={status.key} className="flex items-center justify-between gap-2 text-xs">
      <span className="flex min-w-0 items-center gap-2 text-slate-300"><i className="size-2 shrink-0 rounded-sm" style={{ background: status.color }} />{status.label}</span>
      <strong className="shrink-0 text-slate-100">{numberBR(sum[status.key])} <span className="font-normal text-slate-400">({percentBR(sum[status.key] / sum.total * 100)})</span></strong>
    </li>)}</ul>
  </div>;
}

function Meter({ title, strong, width, footnote, tone = "#3f9cff" }: { title: string; strong: string; width: number; footnote?: string; tone?: string }) {
  return <div className="space-y-1.5">
    <div className="flex items-baseline justify-between gap-3 text-xs">
      <span className="min-w-0 truncate text-slate-200" title={title}>{title}</span>
      <strong className="shrink-0 text-slate-100">{strong}</strong>
    </div>
    <div className="h-2 overflow-hidden rounded-full bg-[#344956]"><div className="h-full rounded-full" style={{ width: clampPercent(width) + "%", background: tone }} /></div>
    {footnote && <p className="text-[10px] text-slate-400">{footnote}</p>}
  </div>;
}

function StoreTop({ stores, onOpenAll }: { stores: Grouped[]; onOpenAll: () => void }) {
  const ranking = stores.filter(store => store.total > 0)
    .sort((a, b) => rate(a) - rate(b) || a.key.localeCompare(b.key, "pt-BR", { numeric: true }))
    .slice(0, 5);
  if (!ranking.length) return <Empty text="Sem resultados por loja no período." />;
  return <div className="space-y-3">
    <p className="text-xs text-slate-400">Menores taxas primeiro · até 5 lojas</p>
    {ranking.map(store => <Meter key={store.key} title={store.label} strong={percentBR(rate(store))} width={rate(store)}
      footnote={numberBR(store.recebido) + " / " + numberBR(store.total)} />)}
    <Button variant="ghost" size="sm" className="text-sky-300" onClick={onOpenAll}>Ver todas as lojas <ArrowRight size={13} aria-hidden="true" /></Button>
  </div>;
}

function OccurrenceBadge({ type }: { type: string }) {
  const automatic = type === "nao_compareceu";
  return <span className={"shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold " + (automatic ? "bg-amber-400/15 text-amber-300" : type === "recusado" ? "bg-orange-400/15 text-orange-300" : "bg-rose-400/15 text-rose-300")}>
    {automatic ? "Não compareceu" : type === "recusado" ? "Recusado" : "Não recebido"}
  </span>;
}

function OccurrenceItems({ rows }: { rows: Occurrences["rows"] }) {
  if (!rows.length) return <Empty text="Nenhuma ocorrência no período." />;
  return <div role="list" aria-label="Ocorrências recentes" className="space-y-2.5">
    {rows.map((row, index) => {
      const automatic = row.occurrenceType === "nao_compareceu";
      const reason = automatic ? "Classificação no fechamento" : row.observation || "Motivo não informado";
      return <div key={row.protocol + index} role="listitem" className="space-y-1 border-b border-[#344956] pb-2.5 last:border-0 last:pb-0">
        <div className="flex min-w-0 items-center gap-2 text-xs">
          <span className="shrink-0 text-slate-400">{shortDate(row.date)}</span>
          <span className="shrink-0 font-semibold text-slate-200">{row.storeCode}</span>
          <span className="min-w-0 flex-1 truncate text-slate-300" title={row.supplier}>{row.supplier}</span>
          <OccurrenceBadge type={row.occurrenceType} />
        </div>
        <div className="flex flex-wrap items-center gap-x-3 text-[10px] text-slate-400">
          <span className="min-w-0 truncate" title={"Motivo: " + reason}>Motivo: {reason}</span>
          <span>Origem: {automatic ? "Sistema" : "Conferente"}</span>
        </div>
      </div>;
    })}
  </div>;
}

// Ranking de fornecedores por não recebidos: barra proporcional ao líder
// (não ao total) + taxa de recebimento de cada um no rodapé. Com `limit`,
// mostra só os N primeiros e um atalho para o diálogo com a lista completa.
function SupplierRanking({ suppliers, limit, onOpenAll }: { suppliers: Supplier[]; limit?: number; onOpenAll?: () => void }) {
  if (!suppliers.length) return <Empty text="Sem ocorrências." />;
  const highest = Math.max(1, ...suppliers.map(occurrenceCount));
  const shown = limit ? suppliers.slice(0, limit) : suppliers;
  return <div className="space-y-3">
    {shown.map((supplier, index) => <Meter key={supplier.supplier}
      title={(index + 1) + ". " + supplier.supplier} strong={numberBR(occurrenceCount(supplier))}
      width={occurrenceCount(supplier) / highest * 100} tone="#f0525f"
      footnote={[supplier.naoChegou ? numberBR(supplier.naoChegou)+" não recebidos" : "", supplier.naoCompareceu ? numberBR(supplier.naoCompareceu)+" não comparecimentos" : "", supplier.recusado ? numberBR(supplier.recusado)+" recusados" : ""].filter(Boolean).join(" · ") + " | " + percentBR(rate(supplier)) + " recebidos"} />)}
    {onOpenAll && suppliers.length > 0 && <Button variant="ghost" size="sm" className="text-sky-300" onClick={onOpenAll}>Ver ranking de fornecedores <ArrowRight size={13} aria-hidden="true" /></Button>}
  </div>;
}

// Ranking de fornecedores que entregam sem agenda: barra proporcional ao
// líder, "N vez(es)" em destaque e a última ocorrência no rodapé. O card
// mostra o top 5; a lista completa fica no diálogo de detalhamento.
function SupplierWithoutAgenda({ suppliers, total, received, supplierCount, onOpenAll }: { suppliers: SemAgendaSupplier[]; total: number; received: number; supplierCount?: number; onOpenAll: () => void }) {
  if (!suppliers.length) return <Empty text="Nenhum registro sem agenda no período." />;
  const highest = Math.max(...suppliers.map(supplier => supplier.vezes));
  return <div className="space-y-4">
    <p className="text-xs text-slate-400">{numberBR(total)} registro(s) sem agenda · {numberBR(received)} recebido(s){supplierCount !== undefined && " · " + numberBR(supplierCount) + " fornecedor(es)"}.</p>
    {suppliers.slice(0, 5).map((supplier, index) => <Meter key={supplier.supplier} title={(index + 1) + ". " + supplier.supplier}
      strong={numberBR(supplier.vezes) + (supplier.vezes === 1 ? " vez" : " vezes")}
      width={supplier.vezes / highest * 100} tone="#ffbf40"
      footnote={numberBR(supplier.recebidos) + " recebidos · Último registro: " + formatDay(supplier.ultima)} />)}
    {suppliers.length > 0 && <Button variant="ghost" size="sm" className="text-sky-300" onClick={onOpenAll}>Ver ranking de fornecedores <ArrowRight size={13} aria-hidden="true" /></Button>}
  </div>;
}

function Pager({ offset, total, onChange }: { offset: number; total: number; onChange: (value: number) => void }) {
  return <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-[#344956] pt-3 text-xs text-slate-400">
    <span>{numberBR(total)} registro(s) · {total ? numberBR(offset + 1) : 0}–{numberBR(Math.min(offset + 50, total))}</span>
    <div className="flex gap-2">
      <Button variant="secondary" size="sm" disabled={offset === 0} onClick={() => onChange(Math.max(0, offset - 50))}>Anterior</Button>
      <Button variant="secondary" size="sm" disabled={offset + 50 >= total} onClick={() => onChange(offset + 50)}>Próxima</Button>
    </div>
  </div>;
}

function ReportTable({ headings, children, label }: { headings: string[]; children: ReactNode; label: string }) {
  return <div className="w-full min-w-0 max-w-full overflow-x-auto rounded-lg border border-[#344956]">
    <table aria-label={label} className="w-full min-w-[820px] border-collapse">
      <thead className="bg-[#223443]"><tr>{headings.map(heading => <th key={heading} scope="col" className={heads}>{heading}</th>)}</tr></thead>
      <tbody className="divide-y divide-[#344956]">{children}</tbody>
    </table>
  </div>;
}

// Persistência dos filtros do relatório, no mesmo contrato da UI em produção.
const FILTERS_STORAGE_KEY = "agenda-prado-report-filters";

function restoreFilters(): ReportFilters | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(FILTERS_STORAGE_KEY);
    if (!raw) return null;
    const saved = JSON.parse(raw) as Partial<ReportFilters> | null;
    if (!saved || !validRange(String(saved.start), String(saved.end))) return null;
    const stores = Array.isArray(saved.stores)
      ? [...new Set(saved.stores.filter(code => typeof code === "string" && code.trim().length > 0 && code.length <= 20))]
      : [];
    return { start: String(saved.start), end: String(saved.end), stores, compare: !!saved.compare };
  } catch {
    // Armazenamento corrompido ou bloqueado: usa os filtros padrão.
    return null;
  }
}

function persistFilters(filters: ReportFilters) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(FILTERS_STORAGE_KEY, JSON.stringify({
      start: filters.start, end: filters.end, stores: filters.stores, compare: filters.compare,
    }));
  } catch {
    // A preferência vale apenas até o recarregamento quando o armazenamento está bloqueado.
  }
}

type DialogName = "stores" | "occurrences" | "withoutAgenda" | "suppliers";

export function ReportsPage() {
  const queryClient = useQueryClient();
  const [base] = useState(() => restoreFilters() ?? initialFilters());
  const [draft, setDraft] = useState<ReportFilters>(base);
  const [applied, setApplied] = useState<ReportFilters>(base);
  const [filterError, setFilterError] = useState("");
  const [occurrenceInput, setOccurrenceInput] = useState("");
  const [occurrenceQuery, setOccurrenceQuery] = useState("");
  const [occurrenceOffset, setOccurrenceOffset] = useState(0);
  const [occurrenceType, setOccurrenceType] = useState<OccurrenceType>("todos");
  const [dialog, setDialog] = useState<DialogName | null>(null);
  const filterRef = useRef<HTMLDetailsElement>(null);
  const stores = useQuery({ queryKey: ["manager-report", "stores"], queryFn: getStores, staleTime: 60_000 });
  const report = useQuery({ queryKey: ["manager-report", "rows", applied], queryFn: ({ signal }) => getReport(applied, signal) });
  const previous = previousRange(applied);
  const previousReport = useQuery({
    queryKey: ["manager-report", "previous", applied], queryFn: ({ signal }) => getReport({ ...previous, stores: applied.stores }, signal),
    enabled: applied.compare,
  });
  const recent = useQuery({ queryKey: ["manager-report", "recent", applied], queryFn: ({ signal }) => getOccurrences(applied, 0, "", "todos", signal) });
  const occurrences = useQuery({
    queryKey: ["manager-report", "occurrences", applied, occurrenceOffset, occurrenceQuery, occurrenceType],
    queryFn: ({ signal }) => getOccurrences(applied, occurrenceOffset, occurrenceQuery, occurrenceType, signal),
    enabled: dialog === "occurrences",
  });
  const summary = useMemo(() => totals(report.data?.rows ?? []), [report.data]);
  const priorSummary = useMemo(() => applied.compare && previousReport.data ? totals(previousReport.data.rows) : null, [applied.compare, previousReport.data]);
  const units = useMemo(() => group(report.data?.rows ?? [], "store"), [report.data]);
  const days = useMemo(() => group(report.data?.rows ?? [], "date"), [report.data]);
  const comparable = priorSummary && priorSummary.total > 0 ? priorSummary : null;
  const openOccurrences = (type: OccurrenceType = "todos") => {
    setOccurrenceType(type); setOccurrenceOffset(0); setOccurrenceInput(""); setOccurrenceQuery(""); setDialog("occurrences");
  };
  const working = report.isFetching || recent.isFetching || occurrences.isFetching;
  const apply = (event: FormEvent) => {
    event.preventDefault();
    if (!validRange(draft.start, draft.end)) {
      setFilterError("Selecione um intervalo válido de até 93 dias.");
      return;
    }
    setFilterError("");
    const next: ReportFilters = { ...draft, stores: [...draft.stores].sort() };
    setApplied(next);
    persistFilters(next);
    setOccurrenceOffset(0);
    if (filterRef.current) filterRef.current.open = false;
  };
  const storeLabel = (codes: string[]) => {
    if (!codes.length) return "Todas as lojas";
    if (codes.length === 1) {
      const single = codes[0] ?? "";
      const store = stores.data?.find(item => item.codigo === single);
      return store ? store.codigo + " · " + store.nome : single;
    }
    return numberBR(codes.length) + " lojas selecionadas";
  };
  const applyPreset = (key: "7" | "30" | "90" | "month") => {
    const range = presetRange(key);
    if (!validRange(range.start, range.end)) return;
    setFilterError("");
    const next: ReportFilters = { ...applied, ...range };
    setDraft(next);
    setApplied(next);
    persistFilters(next);
    setOccurrenceOffset(0);
    if (filterRef.current) filterRef.current.open = false;
  };
  // Descarta códigos de loja salvos que não existem mais, como a main faz após carregar as lojas.
  useEffect(() => {
    const known = stores.data?.map(store => store.codigo);
    if (!known) return;
    const valid = new Set(known);
    if (applied.stores.every(code => valid.has(code))) return;
    const remaining = applied.stores.filter(code => valid.has(code));
    // Uma seleção explícita totalmente inválida não deve virar consulta global.
    if (!remaining.length) {
      setFilterError("As lojas selecionadas não estão mais disponíveis. Revise o filtro.");
      return;
    }
    const next: ReportFilters = { ...applied, stores: remaining };
    setApplied(next);
    setDraft(next);
    setOccurrenceOffset(0);
    persistFilters(next);
  }, [stores.data, applied]);
  useEffect(() => {
    const details = filterRef.current;
    if (!details) return;
    const dismiss = (event: MouseEvent) => { if (details.open && !details.contains(event.target as Node)) details.open = false; };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || !details.open) return;
      details.open = false;
      details.querySelector<HTMLElement>("summary")?.focus();
    };
    document.addEventListener("click", dismiss);
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("click", dismiss); document.removeEventListener("keydown", escape); };
  }, []);
  return <section className="mx-auto w-full min-w-0 max-w-[1530px] space-y-5" aria-label="Relatório Gerencial">
    <PageHeader eyebrow="Inteligência operacional" title="Relatório Gerencial"
      description="Panorama dos recebimentos, desempenho das lojas e ocorrências registradas."
      actions={<div className="flex items-center gap-2">
        <Button variant="secondary" size="sm" disabled={working} onClick={() => void queryClient.invalidateQueries({ queryKey: ["manager-report"] })}>
          <RefreshCw size={14} aria-hidden="true" />{working ? "Atualizando…" : "Atualizar"}
        </Button>
      </div>} />
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="min-w-0"><h2 className="text-base font-semibold text-slate-100">Visão do período</h2><p className="text-xs text-slate-400">Indicadores consolidados das unidades selecionadas.</p></div>
      <details ref={filterRef} className="group relative">
        <summary aria-label="Editar período e lojas"
          className="flex min-h-10 w-max max-w-full cursor-pointer list-none items-center justify-between gap-2.5 rounded-lg border border-[#344956] bg-[#192734] px-2.5 text-xs font-medium text-white transition-colors hover:border-sky-400 group-open:border-sky-400 group-open:bg-[#223443] [&::-webkit-details-marker]:hidden">
          <span className="min-w-0 max-w-[min(420px,60vw)] truncate text-slate-200">
            {formatDay(applied.start)} a {formatDay(applied.end)} · {storeLabel(applied.stores)}
          </span>
          <ChevronDown size={15} aria-hidden="true" className="shrink-0 text-sky-400 transition-transform duration-150 group-open:rotate-180" />
        </summary>
        <form onSubmit={apply} aria-label="Filtros do relatório"
          className="absolute right-0 top-full z-40 mt-1.5 grid w-[min(525px,calc(100vw-36px))] grid-cols-2 gap-3 rounded-md border border-[#526777] bg-[#192734] p-4 shadow-2xl">
          <div role="group" aria-label="Períodos rápidos" className="col-span-2 flex flex-wrap gap-1.5">
            {([["7", "Últimos 7 dias"], ["30", "Últimos 30 dias"], ["90", "Últimos 90 dias"], ["month", "Mês atual"]] as const).map(([key, text]) =>
              <Button key={key} size="sm" variant="secondary" aria-pressed={applied.start === presetRange(key).start && applied.end === presetRange(key).end}
                onClick={() => applyPreset(key)}>{text}</Button>)}
          </div>
          <label className="grid min-w-0 gap-1.5 text-xs font-semibold text-slate-300">De
            <input className={input} type="date" value={draft.start} onChange={event => setDraft(value => ({ ...value, start: event.target.value }))} />
          </label>
          <label className="grid min-w-0 gap-1.5 text-xs font-semibold text-slate-300">Até
            <input className={input} type="date" value={draft.end} onChange={event => setDraft(value => ({ ...value, end: event.target.value }))} />
          </label>
          <div className="col-span-2 grid min-w-0 gap-1.5 text-xs font-semibold text-slate-300"><span>Lojas</span>
          <details className="relative min-w-0 rounded-md border border-[#526777] bg-[#223443] text-xs text-white">
          <summary className="flex min-h-9 cursor-pointer items-center px-3" aria-label="Selecionar lojas">
            {draft.stores.length ? draft.stores.length + " loja(s) selecionada(s)" : "Todas as lojas"}
          </summary>
          <div className="absolute left-0 top-full z-20 mt-1 max-h-56 w-full min-w-[190px] overflow-auto rounded-md border border-[#526777] bg-[#223443] p-2 shadow-xl">
            <label className="flex cursor-pointer items-center gap-2 p-2"><input type="checkbox" checked={!draft.stores.length}
              onChange={() => setDraft(value => ({ ...value, stores: [] }))} />Todas as lojas</label>
            {stores.isPending && <Loading label="Carregando lojas…" className="p-2 text-slate-400" />}
            {stores.isError && <p role="alert" className="p-2 text-rose-300">Não foi possível listar as lojas.</p>}
            {stores.data?.filter(store => store.ativo).sort((a, b) => a.codigo.localeCompare(b.codigo, "pt-BR", { numeric: true })).map(store =>
              <label key={store.id} className="flex cursor-pointer items-center gap-2 p-2">
                <input type="checkbox" value={store.codigo} checked={draft.stores.includes(store.codigo)}
                  onChange={event => setDraft(value => ({
                    ...value, stores: event.target.checked ? [...value.stores, store.codigo] : value.stores.filter(code => code !== store.codigo),
                  }))} />
                <span>{store.codigo} · {store.nome}</span>
              </label>)}
          </div>
          </details>
          </div>
          <label className="flex items-center gap-2 self-center text-xs text-slate-300">
            <input type="checkbox" checked={draft.compare} onChange={event => setDraft(value => ({ ...value, compare: event.target.checked }))} />
            Comparar período anterior
          </label>
          <Button type="submit" className="self-end">Aplicar filtros</Button>
          {filterError && <p role="alert" className="col-span-2 text-xs text-rose-300">{filterError}</p>}
        </form>
      </details>
    </div>
    {report.isPending && <Loading label="Carregando relatório…" className={panel} />}
    {report.isError && <Failure retry={() => void report.refetch()} text="Não foi possível carregar os indicadores gerenciais." />}
    {report.data && <>
      <Kpis sum={summary} prior={comparable} onOccurrences={openOccurrences} />
      {applied.compare && previousReport.isError && <Failure retry={() => void previousReport.refetch()} text="Comparação indisponível. Os indicadores atuais continuam disponíveis." />}
      {summary.abertas > 0 && <p role="status" className="text-xs text-amber-300">{numberBR(summary.abertas)} agenda(s) em aberto: os indicadores podem mudar até o fechamento.</p>}
      <div className="space-y-5" aria-label="Visão gerencial de recebimentos">
        <h2 className="text-base font-semibold text-slate-100">Evolução e composição</h2>
        <div className="grid grid-cols-1 gap-3 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <Card title="Evolução diária"><DailyTrend days={days} start={applied.start} end={applied.end}/></Card>
          <Card title="Distribuição das situações"><Donut sum={summary}/><p className="mt-3 text-xs text-slate-400">Taxa de recebimento: {summary.total ? percentBR(rate(summary)) : "—"}</p></Card>
        </div>
        {/* Fileira dos rankings: lojas e os dois de fornecedores, com medidores
            e alturas equivalentes. */}
        <h2 className="text-base font-semibold text-slate-100">Desempenho e pontos de atenção</h2>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <Card title="Desempenho por loja"><StoreTop stores={units} onOpenAll={() => setDialog("stores")} /></Card>
          <Card title="Fornecedores com ocorrências">
            <SupplierRanking suppliers={report.data.suppliers} limit={5} onOpenAll={() => setDialog("suppliers")} />
          </Card>
          <Card title="Fornecedores sem agenda">
            <SupplierWithoutAgenda suppliers={report.data.semAgendaSuppliers} total={summary.semAgenda} received={summary.semAgendaRecebidos} supplierCount={report.data.manualSupplierCount} onOpenAll={() => setDialog("withoutAgenda")} />
          </Card>
        </div>
        {/* Lista completa de ocorrências fica no diálogo; o card resume os 5
            registros mais recentes. */}
        <div className="grid grid-cols-1 gap-4">
          <Card title="Ocorrências recentes"
            action={<Button variant="ghost" size="sm" className="text-sky-300" onClick={() => openOccurrences()}>Ver todas as ocorrências <ArrowRight size={13} aria-hidden="true" /></Button>}>
            {recent.isPending ? <Empty text="Carregando ocorrências…" /> : recent.isError
              ? <Empty text="Ocorrências indisponíveis." /> : <OccurrenceItems rows={recent.data?.rows.slice(0, 5) ?? []} />}
          </Card>
        </div>
      </div>
      <p className="text-xs text-slate-500"><Activity size={12} className="mr-1 inline-block" aria-hidden="true" />Indicadores calculados sobre os registros do Agenda Prado. A consulta não altera dados.</p>
    </>}
    {dialog === "stores" && <ReportDialog title="Todas as lojas" description="Indicadores consolidados das unidades no período selecionado." onClose={() => setDialog(null)}>
      <Panel title="Por loja" hint="Indicadores consolidados">
        <ReportTable label="Consolidado por loja" headings={["Loja", "Agendamentos", "Recebidos", "Não recebidos", "Não compareceu", "Aguardando", "Recusados", "Sem agenda", "Taxa"]}>
          {units.map(unit => <tr key={unit.key}>
            <td className={cells}>{unit.label}</td>
            {(["total", "recebido", "naoChegou", "naoCompareceu", "aguardando", "recusado", "semAgenda"] as const).map(metric =>
              <td key={metric} className={cells + " tabular-nums"}>{numberBR(unit[metric])}</td>)}
            <td className={cells + " font-semibold text-sky-200"}>{percentBR(rate(unit))}</td>
          </tr>)}
          {!units.length && <tr><td colSpan={9} className={cells}>Nenhum registro no período.</td></tr>}
        </ReportTable>
      </Panel>
    </ReportDialog>}
    {dialog === "occurrences" && <ReportDialog title="Todas as ocorrências" description="Registros, motivos e origem da classificação." onClose={() => setDialog(null)}>
      <Panel title="Ocorrências e observações" hint="Não recebidos, não comparecimentos e recusas">
        <form className="mb-4 flex flex-wrap gap-2" onSubmit={event => { event.preventDefault(); setOccurrenceQuery(occurrenceInput.trim()); setOccurrenceOffset(0); }}>
          <input type="search" aria-label="Buscar ocorrência por fornecedor ou protocolo" maxLength={80} value={occurrenceInput}
            onChange={event => setOccurrenceInput(event.target.value)} className={input + " max-w-sm"} placeholder="Fornecedor ou protocolo" />
          <select aria-label="Tipo de ocorrência" className={input + " max-w-[190px]"} value={occurrenceType} onChange={event => { setOccurrenceType(event.target.value as OccurrenceType); setOccurrenceOffset(0); }}>
            <option value="todos">Todas as situações</option><option value="nao_recebido">Não recebido</option><option value="nao_compareceu">Não compareceu</option><option value="recusado">Recusado</option>
          </select>
          <Button type="submit" size="sm">Buscar</Button>
          {occurrenceQuery && <Button size="sm" variant="secondary" onClick={() => { setOccurrenceInput(""); setOccurrenceQuery(""); setOccurrenceOffset(0); }}>Limpar</Button>}
        </form>
        {occurrences.isPending && <Loading label="Carregando ocorrências…" className="text-sm text-slate-300" />}
        {occurrences.isError && <Failure retry={() => void occurrences.refetch()} text="Não foi possível consultar as ocorrências." />}
        {occurrences.data && <>
          <ReportTable label="Ocorrências e observações" headings={["Data", "Loja", "Fornecedor", "Protocolo", "Situação", "Motivo", "Origem"]}>
            {occurrences.data.rows.map((row, index) => <tr key={row.date + row.protocol + index}>
              <td className={cells}>{formatDay(row.date)}</td><td className={cells}>{row.storeCode} · {row.storeName}</td>
              <td className={cells}>{row.supplier}</td><td className={cells}>{row.protocol}</td>
              <td className={cells}><OccurrenceBadge type={row.occurrenceType} /></td>
              <td className={cells}>{row.occurrenceType === "nao_compareceu" ? "Não compareceu" : row.observation || "Motivo não registrado"}</td>
              <td className={cells}>{originNames[row.classificationOrigin] || "Sistema"}</td>
            </tr>)}
            {!occurrences.data.rows.length && <tr><td colSpan={7} className={cells}>Nenhuma ocorrência encontrada.</td></tr>}
          </ReportTable>
          <Pager offset={occurrenceOffset} total={occurrences.data.total} onChange={setOccurrenceOffset} />
        </>}
      </Panel>
    </ReportDialog>}
    {dialog === "withoutAgenda" && <ReportDialog title="Fornecedores sem agenda" description="Até 12 fornecedores com mais registros manuais, conforme os filtros." onClose={() => setDialog(null)}>
      <Panel title="Entregas sem agenda" hint="Registros sem agenda, recebidos e data do último registro.">
        <ReportTable label="Fornecedores sem agenda" headings={["#", "Fornecedor", "Vezes sem agenda", "Recebidos", "Última ocorrência"]}>
          {(report.data?.semAgendaSuppliers ?? []).map((supplier, index) => <tr key={supplier.supplier}>
            <td className={cells + " tabular-nums text-slate-400"}>{index + 1}</td>
            <td className={cells}>{supplier.supplier}</td>
            <td className={cells + " font-semibold tabular-nums text-amber-300"}>{numberBR(supplier.vezes)}</td>
            <td className={cells + " tabular-nums"}>{numberBR(supplier.recebidos)}</td>
            <td className={cells + " tabular-nums"}>{formatDay(supplier.ultima)}</td>
          </tr>)}
          {!(report.data?.semAgendaSuppliers ?? []).length && <tr><td colSpan={4} className={cells}>Nenhuma entrega sem agenda no período.</td></tr>}
        </ReportTable>
      </Panel>
    </ReportDialog>}
    {dialog === "suppliers" && <ReportDialog title="Fornecedores com ocorrências" description="Até 12 fornecedores com mais ocorrências no período, com a taxa de recebimento de cada um." onClose={() => setDialog(null)}>
      <Panel title="Ocorrências por fornecedor" hint="Não recebidos, não comparecimentos e recusas; ordenado pela soma.">
        <ReportTable label="Fornecedores com ocorrências" headings={["#", "Fornecedor", "Ocorrências", "Não recebidos", "Não compareceu", "Recusados", "Agendamentos", "Recebidos", "Taxa de recebimento"]}>
          {(report.data?.suppliers ?? []).map((supplier, index) => <tr key={supplier.supplier}>
            <td className={cells + " tabular-nums text-slate-400"}>{index + 1}</td>
            <td className={cells}>{supplier.supplier}</td>
            <td className={cells + " font-semibold tabular-nums text-rose-300"}>{numberBR(occurrenceCount(supplier))}</td>
            <td className={cells}>{numberBR(supplier.naoChegou)}</td><td className={cells}>{numberBR(supplier.naoCompareceu)}</td><td className={cells}>{numberBR(supplier.recusado)}</td>
            <td className={cells + " tabular-nums"}>{numberBR(supplier.total)}</td>
            <td className={cells + " tabular-nums"}>{numberBR(supplier.recebido)}</td>
            <td className={cells + " font-semibold text-sky-200"}>{percentBR(supplier.total ? supplier.recebido / supplier.total * 100 : 0)}</td>
          </tr>)}
          {!(report.data?.suppliers ?? []).length && <tr><td colSpan={9} className={cells}>Nenhum fornecedor com ocorrências no período.</td></tr>}
        </ReportTable>
      </Panel>
    </ReportDialog>}
  </section>;
}
