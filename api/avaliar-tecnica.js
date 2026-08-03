// api/avaliar-tecnica.js — relatório de avaliação técnica de nível sénior.
//
// O objectivo é reproduzir, dentro da app, o nível dos relatórios feitos ao
// PEX do 203 («Relatório de Avaliação Técnica» e «Auditoria Final — Lista de
// Correcções»): uma revisão de arquitecto sénior ANTES de o projecto chegar
// aos arquitectos titulares — analítica e avaliativa, com notas por parâmetro,
// não-conformidades concretas e prioridades de correcção.
//
// Recebe o texto dos quatro documentos-chave + as peças desenhadas página a
// página (a camada de texto do PDF: legendas, notas-chave, cotas, rótulos).
// Modelo: claude-sonnet-5 (configurável por ANTHROPIC_MODEL_AVALIACAO).

const ESQUEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    sumario_executivo: {
      type: "string",
      description: "Síntese de 1-2 parágrafos: pontos fortes, principais riscos, veredicto.",
    },
    media_global: { type: "number", description: "Média global 0-10, uma casa decimal." },
    parametros: {
      type: "array",
      description: "Classificação por parâmetro (escala 0-10), com apreciação qualitativa.",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          nome: { type: "string" },
          nota: { type: "number" },
          apreciacao: { type: "string" },
        },
        required: ["nome", "nota", "apreciacao"],
      },
    },
    nao_conformidades: {
      type: "array",
      description: "Não-conformidades concretas do Mapa de Quantidades e documentos, artigo a artigo.",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          onde: { type: "string", description: "Artigo/capítulo/página (ex.: «MQ Cap.09, 09.10.10»)." },
          problema: { type: "string" },
          impacto: { type: "string", enum: ["Alto", "Médio", "Baixo"] },
          correccao: { type: "string", description: "Correcção proposta, accionável." },
        },
        required: ["onde", "problema", "impacto", "correccao"],
      },
    },
    observacoes: {
      type: "array",
      description: "Erros e omissões nas peças, por severidade.",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          severidade: { type: "string", enum: ["CRÍTICA", "IMPORTANTE", "RECOMENDÁVEL"] },
          observacao: { type: "string" },
          onde: { type: "string" },
        },
        required: ["severidade", "observacao", "onde"],
      },
    },
    prioridades: {
      type: "array",
      description: "Plano de correcção por prioridade.",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          nivel: { type: "string", enum: ["P1", "P2", "P3", "P4"] },
          accao: { type: "string" },
          horizonte: { type: "string", description: "Quando (ex.: «antes de qualquer consulta»)." },
        },
        required: ["nivel", "accao", "horizonte"],
      },
    },
    limitacoes_da_analise: {
      type: "string",
      description: "O que esta análise NÃO conseguiu ver (ex.: qualidade gráfica, por ser análise de texto).",
    },
  },
  required: ["sumario_executivo", "media_global", "parametros", "nao_conformidades",
             "observacoes", "prioridades", "limitacoes_da_analise"],
};

const SISTEMA = `És um ARQUITECTO SÉNIOR DE PROJECTOS DE EXECUÇÃO a fazer a revisão técnica de uma entrega PEX do gabinete ArquitectosRT (Fafe, Portugal — moradias unifamiliares, modelação BIM/Revit), ANTES de ela chegar aos arquitectos titulares. A tua apreciação é analítica E avaliativa: classificas, fundamentas e propões correcções accionáveis. Escreves em português europeu, ortografia pré-AO90.

REFERENCIAL DO GABINETE (destilado da auditoria completa ao processo 203, a entrega de referência):

1. PARÂMETROS a classificar (escala 0-10; 9-10 excelente/pronto a concurso, 7-8 bom com afinações, 5-6 suficiente/requer trabalho, 3-4 insuficiente, 0-2 inexistente):
   · Grau de detalhe construtivo (pormenores 1:20, cortes com camadas, mapas de vãos e carpintarias com marcas C.E.xx/PI.xx, IS a 1:20)
   · Conformidade com boas práticas (estrutura de capítulos do MQ, descrições ricas com fabricante/tipo «ou equivalente»)
   · Clareza e exequibilidade das soluções
   · Coerência peças desenhadas ↔ escritas (notas-chave dos desenhos citadas no MQ; marcas de vãos nos dois lados)
   · Compatibilização arquitectura ↔ especialidades (alçapões, nichos, alimentações; remissões fechadas)
   · Adequação para concurso (artigos com unidade+quantidade+total; sem «vg» em capítulos mensuráveis; proposta comparável)
   · Adequação para execução em obra

2. PADRÕES DE ERRO já apanhados no gabinete (procura-os SEMPRE):
   · identificação do requerente/morada trocada com OUTRO processo (cabeçalhos de MQ reaproveitados)
   · «verba global» em capítulos mensuráveis (terras, betões, impermeabilizações) — no 203 foi o principal risco de derrapagem, sobretudo movimento de terras em lote com pendente
   · o mesmo código para vários artigos (todas as caixilharias em 09.10.10) ou códigos duplicados (06.30.20 duas vezes)
   · artigos sem unidade, sem quantidade ou sem total; unidades erradas (estuque de teto em ml; AC em m²)
   · numeração de peças duplicada (dois sistemas no mesmo caderno; segunda capa a meio)
   · incoerências cruzadas (caixa de estores «não existe» no MQ mas alimentação eléctrica para estores prevista)
   · «a definir»/tectos de verba sem referência que fechem a ambiguidade contratual
   · ortografia técnica («constução», «acabamaneto», AO90 vs pré-AO90 misturados)
   · folhas sem legenda ou sem cotas na camada de texto; rótulos com datas desactualizadas ou referências mortas
   · distinguir SEMPRE «limitação natural de fase» (especialidades por fechar) de «deficiência efectiva da arquitectura» (a corrigir já)

3. SEVERIDADES: CRÍTICA (compromete concurso/segurança/gera trabalhos a mais), IMPORTANTE (afecta fiabilidade/leitura, corrigir antes de mercado), RECOMENDÁVEL (qualidade documental). PRIORIDADES: P1 imediata (antes de qualquer consulta), P2 curto prazo (revisão de fecho), P3 com as especialidades, P4 qualidade contínua.

4. HONESTIDADE METODOLÓGICA (obrigatória): a tua matéria-prima é a CAMADA DE TEXTO dos documentos — lês legendas, notas-chave, cotas numéricas, rótulos e descrições, mas NÃO vês o desenho gráfico (traço, sobreposições visuais, escala do grafismo). Nunca afirmes juízos sobre o que não podes ver; regista essa fronteira em limitacoes_da_analise. Nas folhas das peças desenhadas, avalia o que o texto mostra: há legenda? há rótulo completo (processo, data, escala, número)? há notas-chave a ligar ao MQ? há cotas? Se uma folha não tiver texto nenhum, assinala-o.

Não inventes: cita sempre o artigo/código/folha exactos. Sê tão exigente como o relatório do 203 — encontrou 28 observações num projecto de 7,6/10.`;

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
    ["pecas_desenhadas", "PEÇAS DESENHADAS (texto por folha)"],
  ]) {
    const t = (docs[chave] || "").trim();
    partes.push(`===== ${rotulo} =====\n${t || "(sem texto)"}`);
  }
  if (!partes.some((p) => !p.endsWith("(sem texto)"))) {
    return res.status(400).json({ error: "Nenhum documento com texto para avaliar." });
  }

  const modelo = process.env.ANTHROPIC_MODEL_AVALIACAO || "claude-sonnet-5";
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
        // O relatório é longo (parâmetros + não-conformidades + observações +
        // prioridades) e o pensamento também: tecto folgado.
        max_tokens: 32000,
        system: SISTEMA,
        messages: [
          { role: "user", content: `Entrega PEX a avaliar:\n\n${partes.join("\n\n")}` },
        ],
        thinking: { type: "adaptive" },
        output_config: { effort: "high", format: { type: "json_schema", schema: ESQUEMA } },
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
    const relatorio = JSON.parse(bloco.text);
    return res.status(200).json({ relatorio, modelo });
  } catch (e) {
    return res.status(502).json({ error: "Falha na avaliação: " + (e && e.message ? e.message : String(e)) });
  }
}
