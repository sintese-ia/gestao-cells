// Coleta automática. Roda DENTRO do app, não no n8n.
//
// Mesmo raciocínio do painel de creators: este serviço já vive no Easypanel com o token da Meta
// em env var e o Postgres na rede interna. Pôr isso no n8n significaria duplicar a credencial e
// criar workflow novo no meio dos 44 existentes — 13 deles enviando mensagem, com regra dura de
// não encostar. Aqui é uma função e um setInterval.
//
// Cada job é idempotente e registra o resultado em jarvis.job_log.

const https = require('https');

const GRAPH = process.env.GRAPH_VERSION || 'v21.0';
const PAGE_ID = process.env.PAGE_ID || '532960806564969';   // Cells Energy
const EU = (process.env.IG_HANDLE || 'cellsoficial').toLowerCase();

function req(url) {
  return new Promise((ok, err) => {
    const r = https.get(url, res => {
      const b = [];
      res.on('data', c => b.push(c));
      res.on('end', () => {
        try { ok(JSON.parse(Buffer.concat(b).toString('utf8'))); }
        catch { err(new Error('resposta não-JSON')); }
      });
    });
    r.on('error', err);
    r.setTimeout(45000, () => r.destroy(new Error('timeout')));
  });
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

// MEDIDO EM 09/08, testando limit 1/2/3/5 em sequência: SÓ limit=1 responde.
// 2 e 3 devolvem -2 (timeout), 5 devolve 1 ("reduce the amount of data"). Não é permissão,
// é a Meta engasgando neste endpoint. Por isso a coleta anda de uma conversa por vez,
// com espera entre elas. É lento e é o único jeito que funciona.
async function graph(path, params, tent = 4) {
  const qs = new URLSearchParams(params).toString();
  for (let i = 0; i < tent; i++) {
    const r = await req(`https://graph.facebook.com/${GRAPH}/${path}?${qs}`);
    if (!r.error) return r;
    // 1 = volume · 2 e -2 = falha transitória/timeout do lado da Meta. Todos passam com espera.
    if ([1, 2, -2].includes(r.error.code) && i < tent - 1) { await sleep(2500 * (i + 1)); continue; }
    throw new Error(`graph ${r.error.code}: ${r.error.message}`);
  }
}

// O Page token é derivado do System User token a cada rodada, de propósito: token de página
// rotaciona, e guardá-lo em env criaria uma credencial a mais para esquecer de renovar.
async function pageToken(sysToken) {
  const r = await graph('me/accounts', { access_token: sysToken, fields: 'id,access_token' });
  const p = (r.data || []).find(x => x.id === PAGE_ID) || (r.data || [])[0];
  if (!p) throw new Error('nenhuma página acessível com este token');
  return p.access_token;
}

// ---------------------------------------------------------------- DM do Instagram
// Grava em jarvis.contato. `respondido` = a última mensagem foi NOSSA.
// Se a última é deles, alguém está esperando — e é isso que a tela mostra.
async function syncDM(pool, sysToken, limite = 40, orcamentoMs = 240000) {
  const ate = Date.now() + orcamentoMs;
  const tok = await pageToken(sysToken);
  let url = `https://graph.facebook.com/${GRAPH}/${PAGE_ID}/conversations?` +
    new URLSearchParams({ access_token: tok, platform: 'instagram', fields: 'id', limit: 1 });
  let gravados = 0, lidas = 0, parouPor = 'fim da lista';
  // MEDIDO EM 09/08: quando a paginação falha, a mesma página volta e a conversa seria
  // contada de novo — a rodada dizia "11 gravados" com 1 linha no banco. O Set corta isso.
  const vistos = new Set();

  // Grava CADA conversa assim que o id aparece, em vez de juntar tudo antes.
  // MEDIDO EM 09/08: a versão que paginava primeiro e gravava depois terminava com zero
  // no banco sempre que a paginação engasgava no meio — e ela engasga com frequência.
  while (url && gravados < limite) {
    if (Date.now() > ate) { parouPor = 'orçamento de tempo'; break; }

    let pagina = null;
    for (let i = 0; i < 3 && !pagina; i++) {
      const x = await req(url).catch(() => ({ error: { code: -2, message: 'rede' } }));
      if (!x.error) pagina = x; else await sleep(2000 * (i + 1));
    }
    if (!pagina) { parouPor = 'a Meta parou de responder'; break; }

    for (const cv of (pagina.data || [])) {
      if (vistos.has(cv.id)) { parouPor = 'a paginação parou de avançar'; url = null; break; }
      vistos.add(cv.id);
      lidas++;
      if (Date.now() > ate) break;
      await sleep(400);
      let d;
      try {
        d = await graph(cv.id, { access_token: tok,
          fields: 'messages.limit(1){created_time,from,message}' });
      } catch { continue; }              // uma conversa ruim não derruba a coleta

      const m = ((d.messages || {}).data || [])[0];
      if (!m) continue;
      const quem = (m.from || {}).username || (m.from || {}).id || 'desconhecido';
      const meu  = quem.toLowerCase() === EU;
      const txt  = (m.message || '').replace(/\s+/g, ' ').trim().slice(0, 180);

      // ON CONFLICT pela chave da conversa: rodar duas vezes não duplica ninguém.
      // Só mexe em `respondido` quando a última mensagem MUDOU — assim a marcação
      // que o Gabriel fez na tela não é desfeita pela próxima rodada.
      await pool.query(`
        INSERT INTO jarvis.contato (chave, quem, handle, canal, ultima_msg_em, ultima_msg_resumo, respondido)
        VALUES ($1,$2,$3,'instagram_dm',$4,$5,$6)
        ON CONFLICT (chave) DO UPDATE SET
          ultima_msg_em     = EXCLUDED.ultima_msg_em,
          ultima_msg_resumo = EXCLUDED.ultima_msg_resumo,
          respondido        = CASE
            WHEN jarvis.contato.ultima_msg_em IS DISTINCT FROM EXCLUDED.ultima_msg_em
            THEN EXCLUDED.respondido ELSE jarvis.contato.respondido END`,
        [cv.id, meu ? 'Cells (última foi nossa)' : quem, meu ? null : quem,
         m.created_time || null, txt || '(mídia ou reação)', meu]);
      gravados++;
    }

    url = (pagina.paging && pagina.paging.next) || null;
    if (url) await sleep(900);
  }
  return { itens: gravados, detalhe: `${lidas} conversas lidas · parou por: ${parouPor}` };
}

// ---------------------------------------------------------------- frentes paradas
// Marca `parada_desde` em quem não teve tarefa concluída nem comentário há mais de 7 dias.
// Só marca; nunca desmarca sozinho — desmarcar é decisão do Gabriel na tela.
async function marcarParadas(pool) {
  const r = await pool.query(`
    UPDATE jarvis.frente f SET parada_desde = CURRENT_DATE - 7
     WHERE f.estado <> 'pronto'
       AND f.parada_desde IS NULL
       -- MEDIDO EM 09/08: sem este piso, o job marcou as 11 frentes como paradas no
       -- primeiro dia. Frente sem histórico não está parada; está começando.
       AND f.criado_em < now() - interval '7 days'
       AND f.atualizado_em < now() - interval '7 days'
       AND NOT EXISTS (SELECT 1 FROM jarvis.task t
                        WHERE t.frente_id=f.id AND t.feita_em > now() - interval '7 days')
       AND NOT EXISTS (SELECT 1 FROM jarvis.comentario c
                        WHERE c.frente_id=f.id AND c.criado_em > now() - interval '7 days')
    RETURNING f.slug`);
  return { itens: r.rowCount, detalhe: r.rows.map(x => x.slug).join(', ') || 'nenhuma' };
}

// ---------------------------------------------------------------- agendador
async function roda(pool, nome, fn) {
  try {
    const r = await fn();
    await pool.query('INSERT INTO jarvis.job_log (job,ok,detalhe,itens) VALUES ($1,true,$2,$3)',
      [nome, r.detalhe || null, r.itens || 0]);
    console.log(`[job ${nome}] ok · ${r.itens} · ${r.detalhe || ''}`);
  } catch (e) {
    await pool.query('INSERT INTO jarvis.job_log (job,ok,detalhe,itens) VALUES ($1,false,$2,0)',
      [nome, String(e.message).slice(0, 300)]).catch(() => {});
    console.error(`[job ${nome}] FALHOU · ${e.message}`);
  }
}

// Roda uma vez por dia, na primeira checagem depois das 06:40 de São Paulo.
// Checa a cada 10 min em vez de calcular o delay até amanhã: se o container reiniciar
// às 06:39, um setTimeout de 24h perderia a janela do dia inteiro.
function agendar(pool, env) {
  const HORA_ALVO = 6, MIN_ALVO = 40;
  let ultimoDia = null;

  const tick = async () => {
    const agora = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
    const dia = agora.toISOString().slice(0, 10);
    const passou = agora.getHours() > HORA_ALVO ||
      (agora.getHours() === HORA_ALVO && agora.getMinutes() >= MIN_ALVO);
    if (dia === ultimoDia || !passou) return;
    ultimoDia = dia;
    if (env.META_TOKEN) await roda(pool, 'dm-instagram', () => syncDM(pool, env.META_TOKEN));
    await roda(pool, 'frentes-paradas', () => marcarParadas(pool));
  };

  setInterval(tick, 10 * 60 * 1000).unref();
  setTimeout(tick, 30 * 1000).unref();   // e uma vez logo após subir
  console.log('agendador ligado · alvo 06:40 America/Sao_Paulo');
}

module.exports = { agendar, syncDM, marcarParadas, roda };
