// api/memoria-descritiva.js — rascunho das secções de SOLUÇÕES CONSTRUTIVAS da
// Memória Descritiva do PEX, redigidas A PARTIR do Mapa de Quantidades (nunca
// de raiz). O mesmo padrão das cláusulas do CE: o modelo propõe, o arquitecto
// revê no ecrã, e só então se grava na ficha — que depois gera a Memória.

const ESQUEMA = {
  type: "object",
  additionalProperties: false,
  required: ["seccoes"],
  properties: {
    seccoes: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["chave", "texto"],
        properties: {
          chave: { type: "string", description: "A chave SOL_* pedida" },
          texto: { type: "string", description: "O corpo da secção, pronto a rever" },
        },
      },
    },
  },
};

// o que cada secção da Memória descreve — para o modelo saber o que procurar no MQ
const AMBITO = {
  SOL_ESTRUTURA: "estrutura (fundações, betão armado, lajes — capítulos 02 e 03)",
  SOL_PAREDES_EXTERIORES: "paredes exteriores e o seu revestimento (capítulo 04)",
  SOL_COBERTURA: "cobertura, impermeabilizações e rufos (capítulo 05)",
  SOL_COMPARTIMENTACAO: "compartimentação interior: alvenarias, divisórias, forras (capítulo 06)",
  SOL_PAVIMENTOS: "pavimentos: toscos e revestimentos (capítulo 07)",
  SOL_TECTOS: "tectos interiores e exteriores (capítulos 04.40 e 08)",
  SOL_VAOS_EXTERIORES: "vãos exteriores: caixilharia, vidros, protecções (capítulo 09)",
  SOL_VAOS_INTERIORES: "vãos interiores e carpintarias (capítulo 10)",
  SOL_ZONAS_HUMIDAS: "zonas húmidas: instalações sanitárias e cozinha (revestimentos, louças)",
  SOL_COMUNICACOES_VERTICAIS: "escadas e guardas (capítulo 11)",
  SOL_ARRANJOS_EXTERIORES: "arranjos exteriores: pavimentos, muros, piscina (capítulo 17)",
};

const SISTEMA = `És um arquitecto sénior português do gabinete ArquitectosRT (Fafe) a redigir
as secções de SOLUÇÕES CONSTRUTIVAS da Memória Descritiva de um Projecto de
Execução de uma moradia. Português europeu, ortografia pré-1990 (projecto,
execução, direcção — nunca «projeto»).

REGRAS ABSOLUTAS:
- Redige A PARTIR dos artigos reais do Mapa de Quantidades fornecido — as
  soluções, materiais e marcas que lá estão. NUNCA inventes materiais nem
  soluções que o MQ não preveja.
- Prosa descritiva de memória (não estilo de cláusula): «A cobertura é plana,
  invertida, com isolamento em…», 1 a 3 parágrafos por secção.
- O que o MQ não disser e a secção precise: escreve «[a confirmar]» no lugar
  do dado em falta — visível, nunca adivinhado.
- Se o MQ não tiver NADA sobre a secção: devolve exactamente
  «[a confirmar — o Mapa de Quantidades não cobre esta matéria]».
- Sem juízos de valor nem marketing; linguagem técnica sóbria do gabinete.`;

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Só aceita POST." });
  }
  if ((req.headers["x-app-password"] || "") !== process.env.APP_PASSWORD) {
    return res.status(401).json({ error: "Palavra-passe inválida." });
  }

  const { contexto, chaves } = req.body || {};
  const mq = contexto && contexto.mapa_quantidades;
  if (!mq || !String(mq).trim()) {
    return res.status(400).json({ error: "Falta o conteúdo do Mapa de Quantidades." });
  }
  const pedidas = Array.isArray(chaves) && chaves.length
    ? chaves
    : Object.keys(AMBITO);

  const lista = pedidas
    .map((c) => `- ${c}: ${AMBITO[c] || "secção da memória"}`)
    .join("\n");

  const modelo = process.env.ANTHROPIC_MODEL_CLAUSULAS || "claude-sonnet-5";
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
        max_tokens: 24000,
        system: SISTEMA,
        messages: [{
          role: "user",
          content:
            `MAPA DE QUANTIDADES do projecto:\n\n${String(mq).slice(0, 120000)}\n\n`
            + (contexto.memoria ? `MEMÓRIA ACTUAL (se existir):\n${String(contexto.memoria).slice(0, 30000)}\n\n` : "")
            + `Redige as secções:\n${lista}`,
        }],
        thinking: { type: "adaptive" },
        output_config: { effort: "medium", format: { type: "json_schema", schema: ESQUEMA } },
      }),
    });

    const dados = await resposta.json();
    if (!resposta.ok) {
      const msg = (dados && dados.error && dados.error.message) || "Erro na API da Anthropic.";
      return res.status(resposta.status).json({ error: msg });
    }
    const bloco = (dados.content || []).find((c) => c.type === "text");
    if (!bloco || !bloco.text) {
      return res.status(502).json({ error: "A resposta veio vazia (" + (dados.stop_reason || "?") + ")." });
    }
    let saida;
    try {
      saida = JSON.parse(bloco.text);
    } catch (e) {
      return res.status(502).json({ error: "JSON inválido do modelo: " + e.message });
    }
    return res.status(200).json({ modelo, ...saida });
  } catch (e) {
    return res.status(500).json({ error: "Falha a contactar a Anthropic: " + e.message });
  }
}
