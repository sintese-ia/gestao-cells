// SQL do painel de gestão. Tudo lê do schema `jarvis` — a camada de estado.
// Regra da casa: a tela nunca calcula regra de negócio, só mostra o que a query devolveu.

module.exports = {

  // As frentes, já ordenadas como o painel mostra: crítico primeiro, depois a ordem do Gabriel.
  frentes: `
    SELECT f.id, f.slug, f.ordem, f.nome, f.dono, f.estado, f.resumo,
           f.o_que_destrava, f.parada_desde,
           CASE WHEN f.parada_desde IS NOT NULL
                THEN (CURRENT_DATE - f.parada_desde) END AS dias_parada,
           to_char(f.atualizado_em AT TIME ZONE 'America/Sao_Paulo','DD/MM HH24:MI') AS atualizado
      FROM jarvis.frente f
     ORDER BY (f.estado='critico') DESC, f.ordem`,

  // Tarefas abertas e as fechadas recentemente — o painel precisa das duas
  // para conseguir DESMARCAR um check dado por engano.
  tasks: `
    SELECT t.id, t.frente_id, t.titulo, t.detalhe, t.dono, t.estado, t.prazo, t.origem,
           to_char(t.feita_em AT TIME ZONE 'America/Sao_Paulo','DD/MM') AS feita
      FROM jarvis.task t
     WHERE t.estado IN ('aberta','fazendo','bloqueada')
        OR t.feita_em > now() - interval '7 days'
     ORDER BY (t.dono='gabriel') DESC, t.id`,

  // Evidências: o que se sabe E como se sabe. É o que impede uma conclusão
  // errada de virar fato permanente só porque foi escrita uma vez.
  evidencias: `
    SELECT e.id, e.frente_id, e.afirmacao, e.valor, e.fonte, e.metodo,
           e.confianca, e.verificado_por,
           to_char(e.verificado_em AT TIME ZONE 'America/Sao_Paulo','DD/MM') AS quando
      FROM jarvis.evidencia e
     ORDER BY array_position(ARRAY['refutado','hipotese','provavel','confirmado'], e.confianca),
              e.verificado_em DESC`,

  comentarios: `
    SELECT c.id, c.frente_id, c.task_id, c.autor, c.texto,
           to_char(c.criado_em AT TIME ZONE 'America/Sao_Paulo','DD/MM HH24:MI') AS quando
      FROM jarvis.comentario c
     ORDER BY c.criado_em`,

  // Quem está esperando resposta. Ordena por quem espera há mais tempo.
  contatos: `
    SELECT c.id, c.quem, c.handle, c.canal, c.respondido, c.frente_id,
           c.ultima_msg_resumo, c.proximo_toque,
           to_char(c.ultima_msg_em AT TIME ZONE 'America/Sao_Paulo','DD/MM') AS ultima,
           CASE WHEN c.ultima_msg_em IS NOT NULL
                THEN (CURRENT_DATE - c.ultima_msg_em::date) END AS dias
      FROM jarvis.contato c
     ORDER BY c.respondido, c.ultima_msg_em NULLS LAST`,

  // Escritas -------------------------------------------------------------
  // feita_em só é preenchido quando o estado É 'feita'. Desmarcar limpa a data:
  // sem isso, uma task desmarcada continuaria contando como concluída no relatório.
  setTask: `
    UPDATE jarvis.task
       SET estado = $2,
           feita_em = CASE WHEN $2 = 'feita' THEN now() ELSE NULL END
     WHERE id = $1
    RETURNING id, estado`,

  addComentario: `
    INSERT INTO jarvis.comentario (frente_id, task_id, autor, texto)
    VALUES ($1, $2, $3, $4)
    RETURNING id`,

  setRespondido: `
    UPDATE jarvis.contato SET respondido = $2 WHERE id = $1 RETURNING id, respondido`,
};
