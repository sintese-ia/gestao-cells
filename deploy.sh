#!/usr/bin/env bash
# Finaliza o deploy do gestao-cells no Easypanel.
#
# Serviço, env vars, domínio (com Let's Encrypt) e DNS JÁ ESTÃO CRIADOS.
# Falta só apontar a origem do código e mandar buildar — os 3 passos abaixo.
#
# Por que isto virou script: em 05/08 o FortiGate da rede começou a devolver 403 (Web Filter)
# para *.sinteseia.com.br no meio do deploy. Postgres:5432 e GitHub passam; HTTPS para o
# Easypanel, não. Rode de uma rede sem esse filtro (4G do celular resolve) ou espere liberar.
#
#   bash deploy.sh
#
set -euo pipefail

: "${EASYPANEL_API_TOKEN:?defina EASYPANEL_API_TOKEN (está no ~/.zshrc)}"
BASE="https://easypanel.sinteseia.com.br/api/trpc"
PROJ="sintese"
SVC="gestao"   # nome do servico no Easypanel. NAO e "gestao-cells" (o repo se chama assim, o servico nao)

ep() {
  curl -sS -X POST "$BASE/$1" \
    -H "Authorization: Bearer $EASYPANEL_API_TOKEN" \
    -H 'Content-Type: application/json' -d "$2"
  echo
}

echo "==> checando se o painel responde"
code=$(curl -k -s -o /dev/null -w '%{http_code}' -m 15 https://easypanel.sinteseia.com.br || true)
if [ "$code" != "200" ]; then
  echo "Easypanel devolveu HTTP $code."
  [ "$code" = "403" ] && echo "403 = FortiGate/Web Filter da rede, não é o servidor. Troque de rede."
  exit 1
fi

echo "==> 1/3 origem do código"
ep "services.app.updateSourceGit" \
  "{\"json\":{\"projectName\":\"$PROJ\",\"serviceName\":\"$SVC\",\"repo\":\"https://github.com/sintese-ia/gestao-cells.git\",\"ref\":\"main\",\"path\":\"/\"}}"

echo "==> 2/3 build por Dockerfile"
ep "services.app.updateBuild" \
  "{\"json\":{\"projectName\":\"$PROJ\",\"serviceName\":\"$SVC\",\"build\":{\"type\":\"dockerfile\",\"file\":\"Dockerfile\"}}}"

echo "==> 3/3 deploy"
ep "services.app.deployService" "{\"json\":{\"projectName\":\"$PROJ\",\"serviceName\":\"$SVC\"}}"

echo
# HTTP 200 NAO prova deploy: a tela de login do container antigo responde 200 igual.
# O /healthz devolve o hash do template servido — so isso prova que o codigo novo subiu.
ESPERADO=$(shasum -a 256 template.html | cut -c1-8)
echo "==> aguardando o hash $ESPERADO aparecer em /healthz (build leva ~1-2 min)"
for i in $(seq 1 40); do
  h=$(curl -k -s -m 10 https://jarvis.sinteseia.com.br/healthz || true)
  if [ "$h" = "ok $ESPERADO" ]; then
    echo "no ar e confirmado → https://jarvis.sinteseia.com.br"; exit 0; fi
  printf '  %02d) %s\n' "$i" "${h:-sem resposta}"
  sleep 15
done
echo "o hash nao bateu no tempo esperado — o container antigo pode continuar servindo."
echo "veja os logs do servico 'gestao' no Easypanel."
exit 1
