// api/pdm-resumo.js — proxy de IA do gabinete ArquitectosRT.
//
// Redige o RASCUNHO do enquadramento urbanístico (semente do capítulo de
// conformidade da memória descritiva) a partir de material FACTUAL já apurado:
//   - a classe de solo e o texto dos artigos aplicáveis do RPDM;
//   - os números do projecto (áreas, índices);
//   - os ACHADOS DETERMINISTAS do motor (verificar_pdm.py) — a régua já foi
//     aplicada em Python; aqui a IA só ESCREVE, não volta a julgar.
//
// Princípios do gabinete respeitados:
//   - A app ASSINALA, NUNCA APROVA: o rascunho não declara conformidade; usa
//     a situação de cada parâmetro tal como o motor a apurou.
//   - Nada por adivinha: o que estiver por confirmar fica "[a confirmar]".
//   - Duas fases: isto é uma PROPOSTA; o arquitecto revê antes de usar.
//
// Sem dependências (fetch nativo). Variáveis de ambiente na Vercel:
//   ANTHROPIC_API_KEY · APP_PASSWORD · ANTHROPIC_MODEL (opcional).

// Saída estruturada: obriga o modelo a devolver exactamente estes campos.
import { autorizar, corpoAceitavel, dentroDaTaxa, escolherModelo } from "./_comum.js";

const RESUMO_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    titulo: { type: "string", description: "Título do capítulo, ex.: «Enquadramento no PDM de Fafe»." },
    parametros: {
      type: "array",
      description: "Um item por parâmetro apurado pelo motor. NÃO acrescentar nem reavaliar.",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          parametro: { type: "string", description: "Ex.: Índice de utilização (IU)." },
          valor_projecto: { type: "string", description: "Valor do projecto, ex.: 0,45. «[a confirmar]» se em falta." },
          limite: { type: "string", description: "Limite do regulamento, ex.: máximo 1,50. «[a confirmar]» se não fixado." },
          artigo: { type: "string", description: "Artigo citado, ex.: Art. 54.º n.º 3 b)." },
          situacao: { type: "string", enum: ["dentro do limite", "acima do limite", "por confirmar"], description: "Copiar a situação apurada pelo motor; nunca inventar." },
        },
        required: ["parametro", "valor_projecto", "limite", "artigo", "situacao"],
      },
    },
    por_confirmar: {
      type: "array", items: { type: "string" },
      description: "Pendências: dados em falta na ficha e parâmetros do dossier ainda por validar.",
    },
    texto_memoria: {
      type: "string",
      description: "Rascunho em prosa corrida (pré-AO90) do capítulo de enquadramento urbanístico, para a memória descritiva. Descritivo e factual, citando os artigos; termina com a ressalva de que é uma verificação instrumental que não dispensa a apreciação do projectista. NUNCA escrever que o projecto «cumpre» ou «está conforme» como conclusão.",
    },
    aviso: { type: "string", description: "Ressalva curta: rascunho instrumental, a rever pelo arquitecto; não declara conformidade." },
  },
  required: ["titulo", "parametros", "por_confirmar", "texto_memoria", "aviso"],
};

const SISTEMA = `És assistente de licenciamento do gabinete de arquitectura ArquitectosRT (Fafe, Portugal). Rediges o RASCUNHO do capítulo de enquadramento urbanístico de uma memória descritiva, a partir de material factual que te é dado.

Recebes: a classe de solo, o texto dos artigos aplicáveis do Regulamento do PDM, os números do projecto e os ACHADOS de uma verificação determinista já feita (o cálculo dos índices e a comparação com os limites JÁ ESTÁ FEITO).

Regras invioláveis:
- ORTOGRAFIA PRÉ-AO90 (projecto, execução, arquitectura, direcção, correcção…).
- NÃO voltes a julgar nem a calcular. Usa a «situação» de cada parâmetro exactamente como vem nos achados (dentro do limite / acima do limite / por confirmar).
- A app ASSINALA, NUNCA APROVA. NUNCA escrevas que o projecto «cumpre», «está conforme» ou «respeita o PDM» como conclusão. Descreve os factos (valor do projecto face ao limite do artigo) e deixa a conclusão ao projectista.
- NADA POR ADIVINHA. O que não te for dado fica "[a confirmar]". Não inventes valores, artigos nem parâmetros.
- Cita sempre o artigo ao referir um limite.
- O texto_memoria é um RASCUNHO para o arquitecto rever e completar — di-lo na ressalva final.`;

export default async function handler(req, res) {
  if (!autorizar(req, res)) return;
  if (!dentroDaTaxa(res, "pdm-resumo", 12)) return;
  if (!corpoAceitavel(req, res, 512 * 1024)) return;

  const corpo = req.body || {};
  const { municipio, classe_nome, artigos_texto, numeros, achados } = corpo;
  if (!classe_nome || !Array.isArray(achados)) {
    return res.status(400).json({
      error: "Faltam dados: classe_nome, achados[] (do verificar_pdm.py) e, de preferência, artigos_texto e numeros.",
    });
  }

  // Montar o material factual para o modelo. Os achados são a VERDADE — a IA
  // não recalcula. Enviamos só o que é preciso (controlo de custo).
  const material = [
    `Município: ${municipio || "[a confirmar]"}`,
    `Classe de solo: ${classe_nome}`,
    `Números do projecto: ${JSON.stringify(numeros || {}, null, 2)}`,
    "",
    "Achados da verificação determinista (a régua já foi aplicada — não recalcular):",
    ...achados.map((a) => `- [${a.prioridade}] ${a.titulo}: ${a.descricao}`),
    "",
    "Texto dos artigos aplicáveis do Regulamento do PDM:",
    ...Object.entries(artigos_texto || {}).map(([k, v]) => `\n### ${k}\n${v}`),
  ].join("\n");

  const modelo = escolherModelo("ANTHROPIC_MODEL_PDM", "claude-sonnet-5");
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
        // 4096 era o tecto MAIS BAIXO de todos os canais longos (os outros vão
        // de 16.000 a 48.000), e o que aqui se pede não é pouco: UMA LINHA POR
        // PARÂMETRO APURADO — em Fafe são até 34, cada uma com valor, limite,
        // artigo e situação — MAIS um capítulo inteiro de prosa para a memória
        // descritiva. A 07/09/2026, no 203-2025, a resposta saiu cortada a meio
        // e a app mostrou «Unterminated string in JSON at position 3480».
        max_tokens: 16000,
        system: SISTEMA,
        messages: [{ role: "user", content: material }],
        output_config: { format: { type: "json_schema", schema: RESUMO_SCHEMA } },
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
        error: `Resposta do modelo sem texto (stop_reason: ${razao}).`,
      });
    }

    // O CORTE VERIFICA-SE ANTES DE LER O JSON, e verifica-se MESMO HAVENDO
    // TEXTO — é essa a diferença que faltava.
    //
    // Os outros canais (auditar, avaliar-tecnica) só olham para o
    // `stop_reason` quando NÃO vem texto nenhum. Mas o corte por limite não
    // deixa a resposta vazia: deixa-a INCOMPLETA. O texto vem, o
    // `JSON.parse` rebenta, e o arquitecto lê «Unterminated string in JSON at
    // position 3480» — uma frase de programador que não diz o que aconteceu
    // nem o que fazer. Foi o que ele viu a 07/09/2026, e é a segunda metade
    // deste defeito: subir o tecto sem isto deixava o próximo corte tão
    // incompreensível como este.
    if (dados.stop_reason === "max_tokens") {
      return res.status(502).json({
        error:
          "O modelo esgotou o limite de resposta e o rascunho ficou a meio — "
          + "nada foi escrito. Costuma acontecer quando a classe de solo traz "
          + "muitos parâmetros. Tente de novo; se repetir, é preciso subir o "
          + "max_tokens deste canal no proxy.",
      });
    }

    let resumo;
    try {
      resumo = JSON.parse(bloco.text);
    } catch (e) {
      // Rede de segurança: se o JSON vier estragado por outra razão que não o
      // corte, diz-se o que é em vez de deixar passar a mensagem do parser.
      return res.status(502).json({
        error:
          "O modelo devolveu uma resposta que não se consegue ler "
          + `(stop_reason: ${dados.stop_reason || "desconhecido"}). Tente de novo. `
          + `Pormenor técnico: ${e && e.message ? e.message : String(e)}`,
      });
    }
    return res.status(200).json({ resumo, modelo });
  } catch (e) {
    return res.status(502).json({ error: "Falha ao redigir o resumo: " + (e && e.message ? e.message : String(e)) });
  }
}
