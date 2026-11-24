@echo off
setlocal EnableExtensions DisableDelayedExpansion
title Agendas Prado - Preview local
pushd "%~dp0" || goto :erro

echo.
echo ========================================
echo    AGENDAS PRADO - PREVIEW LOCAL
echo    Dados ficticios - sem banco remoto
echo ========================================
echo.

rem A segunda chamada executa o BAT atualizado, sem repetir o pull.
if /i "%~1"=="--apos-pull" goto :preparar
where.exe git.exe >nul 2>&1
if errorlevel 1 goto :semgit
set "BRANCH="
for /f "delims=" %%B in ('git.exe branch --show-current 2^>nul') do set "BRANCH=%%B"
if not "%BRANCH%"=="preview" goto :branch
git.exe diff --quiet --
if errorlevel 1 goto :alteracoes
git.exe diff --cached --quiet --
if errorlevel 1 goto :alteracoes

echo [1/3] Atualizando a branch preview...
rem O bloco inteiro e lido antes do pull, inclusive se o BAT for atualizado.
(
    git.exe pull --ff-only origin preview
    if errorlevel 1 (
        echo Nao foi possivel atualizar a preview. Verifique a conexao e o repositorio.
        pause
        popd
        exit /b 1
    )
    call "%~f0" --apos-pull
    if errorlevel 1 (
        popd
        exit /b 1
    )
    popd
    exit /b 0
)

:preparar
where.exe node.exe >nul 2>&1
if errorlevel 1 goto :semnode
where.exe npm.cmd >nul 2>&1
if errorlevel 1 goto :semnode
node.exe -e "const [m,n]=process.versions.node.split('.').map(Number); if(m<22||(m===22&&n<18))process.exit(1)"
if errorlevel 1 goto :versao
if not exist "scripts\dev-mock.mjs" goto :incompleto
if not exist "wrangler.local.jsonc" goto :incompleto

echo [2/3] Instalando dependencias. Pode demorar na primeira vez...
call npm.cmd ci --legacy-peer-deps
if errorlevel 1 goto :erro

echo.
echo [3/3] Preparando SQLite local e iniciando o servidor Node...
echo A senha de teste aparecera nesta janela.
echo Mantenha a janela aberta enquanto estiver usando o sistema.
echo.
call npm.cmd run dev:mock -- --open-browser
if errorlevel 1 goto :erro
popd
exit /b 0

:semgit
echo Git nao encontrado. Instale o Git para Windows e abra novamente.
goto :erro
:branch
echo A pasta precisa estar na branch preview. Nenhuma branch foi alterada.
goto :erro
:alteracoes
echo Existem alteracoes locais nos arquivos rastreados. Salve ou revise as alteracoes antes de atualizar.
goto :erro
:semnode
echo Node.js ou npm nao encontrado. Instale o Node.js atual (26 ou posterior) e abra novamente.
goto :erro
:versao
echo Node.js 22.18 ou superior necessario; Node 26 e aceito.
goto :erro
:incompleto
echo Arquivos do ambiente mock ausentes. Baixe a branch completa do repositorio.
goto :erro
:erro
echo.
echo Nao foi possivel iniciar. Confira as mensagens acima.
pause
popd
exit /b 1
