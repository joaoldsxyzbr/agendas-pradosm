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

where.exe node.exe >nul 2>&1
if errorlevel 1 goto :semnode
where.exe npm.cmd >nul 2>&1
if errorlevel 1 goto :semnode
node.exe -e "const [m,n]=process.versions.node.split('.').map(Number); if(m<22||(m===22&&n<18))process.exit(1)"
if errorlevel 1 goto :versao
if not exist "scripts\dev-mock.mjs" goto :incompleto
if not exist "wrangler.local.jsonc" goto :incompleto

echo [1/2] Instalando dependencias. Pode demorar na primeira vez...
call npm.cmd ci --legacy-peer-deps
if errorlevel 1 goto :erro

echo.
echo [2/2] Preparando o banco local e iniciando o servidor...
echo A senha de teste aparecera nesta janela.
echo Mantenha a janela aberta enquanto estiver usando o sistema.
echo.
call npm.cmd run dev:mock -- --open-browser
if errorlevel 1 goto :erro
popd
exit /b 0

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
