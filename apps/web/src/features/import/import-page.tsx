import { useSession } from "@/app/session-query";
import { canUse } from "@/features/auth/session";
import { useState } from "react";
import { PageHeader } from "@/components/operations/page-header";
import { Button } from "@/components/ui/button";
import { FileSpreadsheet } from "lucide-react";
import { NexelloPreview } from "./nexello-preview";
import { ImportAgendaDialog } from "./import-agenda-dialog";

export function ImportPage() {
  const {data:user}=useSession();
  const [opened, setOpened] = useState(false);
  return <section className="mx-auto w-full min-w-0 max-w-[1530px] space-y-4" aria-label="Importação de Agendas">
    <PageHeader eyebrow="Administração" title="Importação de Agendas"
      description="Consulte a origem dos agendamentos e utilize a importação por arquivo como contingência." />
    {user?.papel === "admin" && user.acessoConfiguravel !== true && <NexelloPreview />}
    <div className="flex flex-col items-start gap-3 rounded-md border border-[#344956] bg-[#192734] p-6">
      <FileSpreadsheet className="text-sky-300" size={28} aria-hidden="true" />
      <h2 className="text-base font-bold">Importação por arquivo</h2>
      <p className="max-w-xl text-sm text-slate-300">Contingência CSV/PDF: selecione o arquivo, confira a prévia e confirme. O sistema distribui os registros para as respectivas lojas automaticamente, sem necessidade de importar novamente para o conferente.</p>
      <Button disabled={!canUse(user,"importacao.executar",true)} onClick={() => setOpened(true)}>Selecionar arquivo CSV/PDF</Button>
    </div>
    {opened && <ImportAgendaDialog onClose={() => setOpened(false)} />}
  </section>;
}
