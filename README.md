# gestao-cells

Painel do agente de gestão da Cells. Lê e escreve no schema `jarvis` do Postgres —
a camada de estado que sobrevive ao fechar as sessões do Claude.

**No ar:** https://gestao.sinteseia.com.br

## O que a tela faz

- **Ação sua** — as tarefas do Gabriel, com check que grava na hora
- **Esperando resposta** — quem falou com a Cells e não foi respondido
- **As frentes** — as 11, com o que destrava, tarefas, comentários e as evidências

## A tabela que importa: `jarvis.evidencia`

Guarda **como** cada coisa foi verificada (fonte + método + confiança), não só a conclusão.
Existe porque em 08/08 duas sessões convergiram numa causa errada em dois turnos —
uma conclusão gravada sem procedência vira fato permanente que ninguém revisa.

## Rodar local

```bash
npm install
DATABASE_URL='postgresql://...' SENHA=teste PORT=3311 node server.js
```

## Deploy

```bash
bash deploy.sh
```

Se o Easypanel devolver 403, é o FortiGate da rede filtrando `*.sinteseia.com.br` —
troque de rede (4G do celular resolve) ou use o GitHub Actions.

⚠️ **HTTP 401 não prova que subiu** — o container antigo responde igual.
Procure na página um trecho que só exista no código novo.
