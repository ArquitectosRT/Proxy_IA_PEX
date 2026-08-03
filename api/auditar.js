// api/auditar.js — auditoria de coerência cruzada (Fluxo D) do PEX.
//
// Recebe o texto dos quatro documentos-chave de uma entrega (Memória, Caderno
// de Encargos, Mapa de Quantidades, Mapa de Acabamentos) e pede ao Claude para
// os CRUZAR elemento a elemento, devolvendo achados P1/P2 estruturados.
//
// Modelo: claude-sonnet-5 por omissão (cruzar conteúdo técnico exige mais do
// que o Haiku). Configurável por ANTHROPIC_MODEL_AUDITORIA.
//
// É uma proposta: o arquitecto lê e valida. A app não age sobre os achados.

const ESQUEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    pontuacao_global: { type: "integer", description: "Coerência global de 0 a 10." },
    resumo: { type: "string", description: "Síntese de 2-3 frases do estado de coerência." },
    achados: {
      type: "array",
      description: "Incoerências ou lacunas encontradas no cruzamento. Vazio se estiver coerente.",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          prioridade: { type: "string", enum: ["P1", "P2", "P3"] },
          titulo: { type: "string" },
          descricao: { type: "string", description: "O que está incoerente e porquê." },
          referencia: { type: "string", description: "Onde: os pontos cruzados (ex.: «Memória §5.3 desenha escada; MQ subcap. 11.10 diz Não Existe»)." },
        },
        required: ["prioridade", "titulo", "descricao", "referencia"],
      },
    },
  },
  required: ["pontuacao_global", "resumo", "achados"],
};

const SISTEMA = `És um arquitecto sénior do gabinete ArquitectosRT (Fafe) a fazer a AUDITORIA DE COERÊNCIA CRUZADA (Fluxo D) de uma entrega de projecto de execução (PEX). Recebes o texto de quatro documentos e cruza-los elemento a elemento.

Metodologia (inegociável):
- TESTA AUSÊNCIAS, não só validações. Cruzamento sistemático, nunca por amostragem. A lição do processo 203: uma escada helicoidal estava DESENHADA e descrita na Memória mas marcada «Não Existe» no Mapa de Quantidades — invisível a qualquer amostragem. É este tipo de desalinhamento que tens de caçar.
- Âncoras de cruzamento: Memória (§5.x, descrição das soluções) ↔ subcapítulos do Mapa de Quantidades ↔ artigos ET_XX_YY do Caderno de Encargos ↔ códigos PAV/ROD/PAR/TET do Mapa de Acabamentos.
- Procura: elementos descritos na Memória mas ausentes/«Não Existe» no MQ; artigos no MQ sem critério de medição no CE; acabamentos no MA sem artigo no MQ; materiais/soluções que divergem entre documentos; quantidades que não fecham.

Gravidade:
- P1: incoerência que impede a obra ou a consulta (elemento em falta no MQ, contradição material).
- P2: a resolver antes de fechar (critério em falta, divergência menor).
- P3: nota/pormenor.

Regras: ortografia pré-AO90; não inventes — se um documento não tiver texto suficiente, di-lo no resumo em vez de supor; sê concreto na referência (aponta os pontos exactos cruzados). Se o conteúdo vier truncado, considera-o e assinala que a leitura foi parcial.`;

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Só aceita POST." });
  }
  if ((req.headers["x-app-password"] || "") !== process.env.APP_PASSWORD) {
    return res.status(401).json({ error: "Palavra-passe da equipa inválida." });
  }
  const docs = (req.body && req.body.docs) || {};
  const partes = [];
  for (const [chave, rotulo] of [
    ["memoria", "MEMÓRIA DESCRITIVA"],
    ["caderno_encargos", "CADERNO DE ENCARGOS"],
    ["mapa_quantidades", "MAPA DE QUANTIDADES"],
    ["mapa_acabamentos", "MAPA DE ACABAMENTOS"],
  ]) {
    const t = (docs[chave] || "").trim();
    partes.push(`===== ${rotulo} =====\n${t || "(sem texto)"}`);
  }
  if (!partes.some((p) => !p.endsWith("(sem texto)"))) {
    return res.status(400).json({ error: "Nenhum documento com texto para auditar." });
  }

  const modelo = process.env.ANTHROPIC_MODEL_AUDITORIA || "claude-sonnet-5";
  try {
    const resposta = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: modelo,
        // Tecto de saída generoso: com os documentos completos, pensamento + o
        // JSON dos achados chegavam a passar dos 16000 e o JSON saía cortado.
        max_tokens: 24000,
        system: SISTEMA,
        messages: [
          { role: "user", content: `Documentos da entrega a auditar:\n\n${partes.join("\n\n")}` },
        ],
        thinking: { type: "adaptive" },
        // Esforço «médio» limita o pensamento (não corre desenfreado, custa e
        // demora menos) sem perder capacidade — deixa espaço para o JSON caber.
        output_config: { effort: "medium", format: { type: "json_schema", schema: ESQUEMA } },
      }),
    });

    const dados = await resposta.json();
    if (!resposta.ok) {
      const msg = (dados && dados.error && dados.error.message) || "Erro na API da Anthropic.";
      return res.status(resposta.status).json({ error: msg });
    }
    if (dados.stop_reason === "refusal") {
      return res.status(422).json({ error: "O modelo recusou o pedido por segurança." });
    }
    const bloco = (dados.content || []).find((b) => b.type === "text");
    if (!bloco) {
      const razao = dados.stop_reason || "desconhecido";
      return res.status(502).json({
        error: `Resposta do modelo sem texto (stop_reason: ${razao}). `
          + (razao === "max_tokens"
            ? "O pensamento esgotou o limite — aumentar max_tokens ou reduzir o conteúdo."
            : "Tente de novo."),
      });
    }
    const auditoria = JSON.parse(bloco.text);
    return res.status(200).json({ auditoria, modelo });
  } catch (e) {
    return res.status(502).json({ error: "Falha na auditoria: " + (e && e.message ? e.message : String(e)) });
  }
}
