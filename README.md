# gestao-cells

Painel do agente de gestão da Cells. Lê e escreve no schema `jarvis` do Postgres —
a camada de estado que sobrevive ao fechar as sessões do Claude.

**No ar:** https://jarvis.sinteseia.com.br  ·  servico `gestao` no projeto `sintese` do Easypanel
(o repo se chama `gestao-cells`, o servico NAO — errar isso faz o deploy.sh falhar em silencio)

## O que a tela faz

Três visões da mesma lista, alternadas pelas abas no topo:

- **Prioridades** — as tarefas em faixas P1 a P4, com check que grava na hora e setas
  para mudar a prioridade. A ordem da semana é do Gabriel, não minha: por isso é editável na tela.
- **Mapa** — organograma chaveado: frente → ramo por tipo de trabalho → tarefa.
  A cor diz a **natureza** do trabalho (clique, decisão, pessoas, papelada, campo,
  produção, pesquisa, construção), não o assunto. Clicar numa folha leva à tarefa na lista.
- **Frentes** — cada frente com o que destrava, tarefas, comentários e as evidências.

### Fechar comentando

Marcar uma tarefa abre, na hora, um campo: **"o que você fez — e o que eu devo conferir depois"**.
O comentário fica preso na **tarefa** (`jarvis.comentario.task_id`), não solto na frente.

A fila de conferência é a view `jarvis.vw_para_conferir`: entram as tarefas fechadas
com comentário do Gabriel que ainda não receberam resposta minha, ordenadas por quem
espera há mais tempo. Ela se esvazia sozinha quando eu comento de volta — sem flag
para alguém lembrar de marcar.

O filtro **"só o que depende de mim"** vem ligado: o painel é do Gabriel, e a pergunta
que ele faz ao abrir não é "o que existe", é "o que trava em mim".

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
