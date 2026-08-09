// Gestão Cells — painel do agente de gestão.
//
// Uma fonte só: o schema `jarvis` no Postgres, lido pela rede interna do Easypanel.
// O que o Gabriel marca aqui é o que a próxima sessão do Claude vai ler — por isso
// toda escrita vai direto pro banco, sem estado intermediário no browser.
const http = require('http');
const fs   = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Pool } = require('pg');
const Q = require('./queries');

const PORT   = process.env.PORT || 3000;
const SENHA  = process.env.SENHA || 'cells';
const COOKIE = 'gc_sess';
const TOKEN  = crypto.createHash('sha256').update('gc|' + SENHA).digest('hex').slice(0, 32);
const DONOS  = ['gabriel', 'claude', 'ambos'];
// Os únicos estados que uma task pode ter. O servidor recusa qualquer outro:
// estado livre vira dialeto pessoal e quebra todo filtro depois.
const ESTADOS = ['aberta', 'fazendo', 'feita', 'descartada', 'bloqueada'];

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: false, max: 4, idleTimeoutMillis: 30000, statement_timeout: 30000,
});

const TPL = fs.readFileSync(path.join(__dirname, 'template.html'), 'utf8');

// pg devolve date como objeto e numeric como string; o template espera algo previsível
function normaliza(row) {
  const o = {};
  for (const [k, v] of Object.entries(row)) {
    o[k] = (v instanceof Date) ? v.toISOString().slice(0, 10) : v;
  }
  return o;
}

async function carrega() {
  const c = await pool.connect();
  try {
    const [fr, tk, ev, co, ct] = await Promise.all([
      c.query(Q.frentes), c.query(Q.tasks), c.query(Q.evidencias),
      c.query(Q.comentarios), c.query(Q.contatos),
    ]);
    const frentes = fr.rows.map(normaliza);
    const tasks   = tk.rows.map(normaliza);
    const contatos = ct.rows.map(normaliza);
    return {
      gerado: new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }),
      frentes, tasks,
      evidencias:  ev.rows.map(normaliza),
      comentarios: co.rows.map(normaliza),
      contatos,
      resumo: {
        frentes:   frentes.length,
        criticas:  frentes.filter(f => f.estado === 'critico').length,
        gabriel:   tasks.filter(t => t.dono === 'gabriel' && t.estado !== 'feita' && t.estado !== 'descartada').length,
        abertas:   tasks.filter(t => t.estado === 'aberta' || t.estado === 'fazendo').length,
        esperando: contatos.filter(c => !c.respondido).length,
      },
    };
  } finally { c.release(); }
}

function body(req) {
  return new Promise(r => { let b = ''; req.on('data', d => b += d); req.on('end', () => r(b)); });
}

const esc = s => String(s).replace(/[&<>"]/g, m => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[m]));

const login = err => `<!doctype html><meta charset="utf-8"><title>Gestão Cells</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>body{background:#080C11;color:#DFE7EE;font:15px/1.5 -apple-system,system-ui,sans-serif;
display:grid;place-items:center;min-height:100vh;margin:0}
form{background:#0F151C;border:1px solid #222E3A;border-radius:4px;padding:28px 30px;width:min(320px,90vw)}
h1{font:600 13px/1 ui-monospace,monospace;letter-spacing:.22em;color:#4ECBDD;margin:0 0 18px}
input{width:100%;padding:10px 12px;background:#080C11;border:1px solid #222E3A;border-radius:3px;
color:#DFE7EE;font-size:15px;margin-bottom:12px}
input:focus{outline:2px solid #4ECBDD;outline-offset:1px}
button{width:100%;padding:10px;background:#4ECBDD;color:#04121A;border:0;border-radius:3px;
font-weight:600;font-size:15px;cursor:pointer}
p{color:#F07A70;font-size:13px;margin:0 0 12px}</style>
<form method="POST"><h1>GESTÃO CELLS</h1>
${err ? '<p>Senha incorreta.</p>' : ''}
<input name="senha" type="password" required autofocus aria-label="Senha">
<button>Entrar</button></form>`;

http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  const json = (code, o) => {
    res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(o));
  };

  if (u.pathname === '/healthz') {
    res.writeHead(200, { 'content-type': 'text/plain' }); return res.end('ok');
  }

  // ---- parede de senha ----
  const autenticado = (req.headers.cookie || '').includes(`${COOKIE}=${TOKEN}`);

  if (req.method === 'POST' && u.pathname === '/') {
    const b = await body(req);
    if (new URLSearchParams(b).get('senha') === SENHA) {
      res.writeHead(302, { location: '/', 'set-cookie':
        `${COOKIE}=${TOKEN}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=2592000` });
      return res.end();
    }
    res.writeHead(401, { 'content-type': 'text/html; charset=utf-8' });
    return res.end(login(true));
  }

  if (!autenticado) {
    if (u.pathname.startsWith('/api/')) return json(401, { erro: 'não autenticado' });
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    return res.end(login(false));
  }

  try {
    // ---- dados ----
    if (u.pathname === '/api/dados') return json(200, await carrega());

    // ---- marcar / desmarcar tarefa ----
    if (u.pathname === '/api/task' && req.method === 'POST') {
      const p = JSON.parse(await body(req) || '{}');
      if (!p.id || !ESTADOS.includes(p.estado)) return json(400, { erro: 'id ou estado inválido' });
      const r = await pool.query(Q.setTask, [p.id, p.estado]);
      if (!r.rowCount) return json(404, { erro: 'task não encontrada' });
      return json(200, r.rows[0]);
    }

    // ---- comentar ----
    if (u.pathname === '/api/comentario' && req.method === 'POST') {
      const p = JSON.parse(await body(req) || '{}');
      const texto = (p.texto || '').trim();
      if (!texto) return json(400, { erro: 'texto vazio' });
      if (!p.frente_id && !p.task_id) return json(400, { erro: 'informe frente_id ou task_id' });
      const r = await pool.query(Q.addComentario,
        [p.frente_id || null, p.task_id || null, 'gabriel', texto]);
      return json(200, r.rows[0]);
    }

    // ---- marcar contato como respondido ----
    if (u.pathname === '/api/contato' && req.method === 'POST') {
      const p = JSON.parse(await body(req) || '{}');
      if (!p.id) return json(400, { erro: 'id ausente' });
      const r = await pool.query(Q.setRespondido, [p.id, !!p.respondido]);
      if (!r.rowCount) return json(404, { erro: 'contato não encontrado' });
      return json(200, r.rows[0]);
    }

    // ---- a tela ----
    if (u.pathname === '/') {
      const d = await carrega();
      // escapa < para o JSON não fechar a tag <script> antes da hora
      const html = TPL.replace('__DADOS__', JSON.stringify(d).replace(/</g, '\\u003c'));
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      return res.end(html);
    }

    res.writeHead(404, { 'content-type': 'text/plain' }); res.end('não encontrado');

  } catch (e) {
    console.error('erro:', e.message);
    if (u.pathname.startsWith('/api/')) return json(500, { erro: e.message });
    res.writeHead(500, { 'content-type': 'text/html; charset=utf-8' });
    res.end(`<meta charset="utf-8"><body style="background:#080C11;color:#F07A70;
      font:15px system-ui;padding:40px"><b>Erro no servidor</b><pre>${esc(e.message)}</pre>`);
  }
}).listen(PORT, () => console.log('gestao-cells na porta', PORT));
