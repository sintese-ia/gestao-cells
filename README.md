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

A fila de conferência é a view `jarvis.vw_para_conferir`: entram as tarefas com
comentário do Gabriel que ainda não receberam resposta minha, ordenadas por quem espera
há mais tempo. Ela se esvazia sozinha quando eu comento de volta — sem flag para alguém
lembrar de marcar.

⚠️ **Até 11/08 essa view filtrava por `estado = 'feita'`, e isso a deixava cega.**
Ele comentou em 4 tarefas; 3 eram **abertas** e nunca chegaram até mim — duas ficaram
um dia paradas. A tela nunca teve o defeito (ela sempre mostrou comentário em tarefa
aberta ou fechada); o furo era só na fila que **eu** consulto. O filtro de estado saiu.
A lição fica: quando eu escrevo a ferramenta que me diz o que olhar, o viés dela vira
meu ponto cego — e ninguém me avisa, porque para ele o comentário estava lá, na tela.

O filtro **"só o que depende de mim"** vem ligado: o painel é do Gabriel, e a pergunta
que ele faz ao abrir não é "o que existe", é "o que trava em mim".

## A tabela que importa: `jarvis.evidencia`

Guarda **como** cada coisa foi verificada (fonte + método + confiança), não só a conclusão.
Existe porque em 08/08 duas sessões convergiram numa causa errada em dois turnos —
uma conclusão gravada sem procedência vira fato permanente que ninguém revisa.

**Ela não vem no `/api/dados`** (mudou em 11/08). Vinham as 345 linhas em toda abertura
de página: 274 KB de um payload de 480 KB, para serem usadas num único lugar da tela.
E o volume cresce rápido — 94 evidências em 10/08, 197 em 11/08. Agora cada frente busca
a sua em `GET /api/evidencias?frente=N` quando é aberta, uma vez só. Payload: **211 KB**.

O `SELECT` tem teto de 80 linhas **e a tela avisa quando cortou** ("mostrando 80 de 95").
Teto silencioso faria a frente parecer completa — que é o defeito que a tabela existe para evitar.

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

⚠️ **HTTP 401 não prova que subiu** — o container antigo responde igual, e 401 é o que
qualquer rota `/api/` devolve antes mesmo de existir (a parede de senha roda primeiro,
então testar rota nova por status é inconclusivo).

**A prova é o hash:** `/healthz` devolve `ok <sha256(template.html)[0:8]>`. O `deploy.sh`
espera esse hash aparecer e só então diz que subiu — ele imprime o hash *errado* a cada
tentativa e não imprime nada quando acerta, então ver o hash velho na saída é o loop
funcionando, não falhando.
