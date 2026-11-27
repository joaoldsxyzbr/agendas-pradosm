import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Navigate, useNavigate } from "react-router";
import { CalendarDays, ClipboardCheck, PackageCheck } from "lucide-react";
import { PradoMark } from "@/components/operations/prado-mark";
import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api";
import { homeForUser, login, isLocalMockOrigin, loadQuickAccounts, quickLogin } from "./session";
import { useSession } from "@/app/session-query";

export function LoginPage() {
  const { data: user, isPending, isError, refetch } = useSession();
  const navigate = useNavigate();
  const client = useQueryClient();
  const [loginValue, setLoginValue] = useState("");
  const [senha, setSenha] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const { data: quickAccounts = [] } = useQuery({
    queryKey: ["local-mock-accounts"],
    queryFn: loadQuickAccounts,
    enabled: isLocalMockOrigin() && !user && !isPending && !isError,
    retry: false,
  });
  const signin = useMutation({
    mutationFn: (account?: string) => account ? quickLogin(account) : login(loginValue.trim(), senha),
    onSuccess: (person) => {
      // Troca de conta não pode herdar o cache do usuário anterior: o sino
      // abriria com lidos e eventos de outra sessão (bug de 12/11/2026).
      client.clear();
      client.setQueryData(["session"], person);
      navigate(homeForUser(person), { replace: true });
    },
    onError: (error) => {
      setErrorMessage(error instanceof ApiError ? error.message : "Não foi possível entrar. Tente novamente.");
    },
  });
  if (isPending) return <main className="grid min-h-svh place-items-center text-slate-400">Verificando sessão…</main>;
  if (isError) return <main className="grid min-h-svh place-items-center gap-3 p-5">
    <p role="alert">Não foi possível verificar a sessão.</p>
    <Button onClick={() => void refetch()}>Tentar novamente</Button>
  </main>;
  if (user) return <Navigate to={homeForUser(user)} replace />;
  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setErrorMessage("");
    if (loginValue.trim() && senha) signin.mutate(undefined);
  };
  return <main className="prado-login grid min-h-svh lg:grid-cols-[minmax(0,1.08fr)_minmax(0,0.92fr)]">
    <section aria-label="Agenda Prado" className="prado-login-identity flex flex-col justify-between gap-12 border-b p-6 sm:p-10 lg:min-h-svh lg:border-b-0 lg:border-r lg:p-14">
      <div className="flex items-center gap-3"><PradoMark /><div><p className="text-lg font-semibold tracking-tight text-white">Agenda Prado</p><p className="text-sm text-slate-400">Gestão de recebimentos</p></div></div>
      <div className="max-w-xl">
        <h2 className="max-w-[17ch] text-3xl font-semibold leading-[1.15] tracking-tight text-slate-50 sm:text-5xl">Da agenda ao recebimento.</h2>
        <p className="mt-4 max-w-[46ch] text-sm leading-relaxed text-slate-300 sm:text-base">Acompanhe as entregas previstas, a conferência e a operação de cada unidade.</p>
        <div className="prado-flow mt-10" aria-label="Etapas da operação">
          {([{ label: "Agendas", Icon: CalendarDays }, { label: "Conferência", Icon: ClipboardCheck }, { label: "Recebimento", Icon: PackageCheck }]).map(({ label, Icon }) =>
            <div key={label} className="prado-flow-step"><Icon size={24} aria-hidden="true" className="mb-3 text-[#90c8df]" /><p className="text-xs font-medium text-slate-200 sm:text-sm">{label}</p></div>
          )}
        </div>
      </div>
      <p className="hidden text-xs text-slate-400 lg:block">Acesso interno da operação Prado</p>
    </section>
    <section aria-labelledby="login-title" className="mx-auto flex w-full max-w-[460px] flex-col justify-center px-6 py-10 sm:px-10 lg:py-14">
      <h1 id="login-title" className="text-3xl font-semibold tracking-tight text-white">Entrar</h1>
      <p className="mt-2 text-sm text-slate-400">Informe suas credenciais para acessar o sistema.</p>
      <form onSubmit={onSubmit} className="mt-6 grid gap-4">
        <label className="grid gap-1.5 text-xs font-semibold text-slate-200">Login
          <input name="login" autoComplete="username" required value={loginValue} onChange={(event) => setLoginValue(event.target.value)}
            className="prado-login-input text-sm" />
        </label>
        <label className="grid gap-1.5 text-xs font-semibold text-slate-200">Senha
          <input name="senha" type="password" autoComplete="current-password" required value={senha} onChange={(event) => setSenha(event.target.value)}
            className="prado-login-input text-sm" />
        </label>
        {errorMessage && <p role="alert" className="text-xs text-rose-300">{errorMessage}</p>}
        <Button type="submit" disabled={signin.isPending} className="mt-1 h-11 w-full">{signin.isPending ? "Entrando…" : "Entrar"}</Button>
      </form>
      {quickAccounts.length > 0 && <section aria-label="Acesso rápido local" className="mt-5 grid gap-2 border-t border-slate-700 pt-4">
        <h2 className="text-xs font-bold text-sky-300">Acesso rápido · ambiente local</h2>
        <p className="text-xs text-slate-400">Escolha uma conta fictícia para entrar sem digitar a senha.</p>
        {quickAccounts.map(account => <Button key={account.login} type="button" variant="secondary" disabled={signin.isPending}
          className="w-full justify-start"
          onClick={() => { setErrorMessage(""); signin.mutate(account.login); }}>
          {account.label}
        </Button>)}
      </section>}

    </section>
  </main>;
}
