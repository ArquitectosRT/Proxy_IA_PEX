// api/clausulas.js — rascunho das cláusulas técnicas do CE (Parte II) do PEX.
//
// Recebe o conteúdo do Mapa de Quantidades e da Memória (a verdade do projecto)
// e uma lista de chaves ET_XX_YY, e devolve um RASCUNHO de cada cláusula,
// derivado dos artigos reais do MQ — nunca inventado. É uma proposta: o
// arquitecto revê e corrige antes de usar. Processa-se por lotes de chaves
// (o cliente divide) para o JSON caber sempre.
//
// Modelo: claude-sonnet-5 por omissão (ANTHROPIC_MODEL_CLAUSULAS para mudar).

const ESQUEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    clausulas: {
      type: "array",
      description: "Uma entrada por chave pedida, na mesma ordem.",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          chave: { type: "string" },
          texto: { type: "string", description: "Corpo da cláusula, em pré-AO90. «(não existe)» se o MQ não previr o subcapítulo." },
        },
        required: ["chave", "texto"],
      },
    },
  },
  required: ["clausulas"],
};

const SISTEMA = `És um arquitecto sénior do gabinete ArquitectosRT (Fafe) a redigir os corpos das cláusulas técnicas da Parte II do Caderno de Encargos (as variáveis {{ET_XX_YY}}) de um projecto de execução.

Cada chave ET_XX_YY corresponde ao subcapítulo XX.YY do Mapa de Quantidades (ex.: ET_04_30 = subcapítulo 04.30). Redige o corpo da cláusula A PARTIR dos artigos reais desse subcapítulo no MQ e da descrição na Memória.

Regras invioláveis do molde:
- NUNCA de raiz, NADA por adivinha. Baseia-te ESTRITAMENTE no Mapa de Quantidades (a fonte dos materiais e artigos reais) e na Memória. Não inventes materiais, marcas, espessuras ou quantidades que não constem desses documentos. O que não puderes fundamentar fica «[a confirmar]».
- Se o subcapítulo XX.YY não tiver artigos no MQ, o corpo é exactamente: «O Mapa de Quantidades não prevê este subcapítulo (não existe).»
- Formulações-tipo a usar: referência sistemática «(art. XX.YY.ZZ)» aos artigos do MQ; quantidades indicativas «(~NNN m²)»; especificação aberta «tipo [Marca] ou equivalente» (só marcas que constem do MQ); numeração árabe por parágrafo dentro da cláusula.
- Ortografia pré-AO90 SEMPRE (projecto, execução, protecção, direcção, eléctrico, betão, tecto).
- Cláusula técnica objectiva: material, características, execução/regras da arte, referência aos artigos do MQ. Sem preâmbulos jurídicos (esses estão na Parte I).

Devolve uma entrada por cada chave pedida.`;

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Só aceita POST." });
  }
  if ((req.headers["x-app-password"] || "") !== process.env.APP_PASSWORD) {
    return res.status(401).json({ error: "Palavra-passe da equipa inválida." });
  }
  const ctx = (req.body && req.body.contexto) || {};
  const chaves = (req.body && req.body.chaves) || [];
  if (!Array.isArray(chaves) || chaves.length === 0) {
    return res.status(400).json({ error: "Faltam as chaves das cláusulas." });
  }
  const mq = (ctx.mapa_quantidades || "").trim();
  const mem = (ctx.memoria || "").trim();
  if (!mq && !mem) {
    return res.status(400).json({ error: "Falta o conteúdo do projecto (MQ/Memória)." });
  }

  const modelo = process.env.ANTHROPIC_MODEL_CLAUSULAS || "claude-sonnet-5";
  const utilizador =
    `MAPA DE QUANTIDADES (fonte dos artigos):\n"""\n${mq}\n"""\n\n` +
    `MEMÓRIA DESCRITIVA:\n"""\n${mem}\n"""\n\n` +
    `Redige o corpo de cada uma destas cláusulas: ${chaves.join(", ")}`;

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
        messages: [{ role: "user", content: utilizador }],
        thinking: { type: "adaptive" },
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
      return res.status(502).json({ error: `Resposta sem texto (stop_reason: ${razao}).` });
    }
    const out = JSON.parse(bloco.text);
    return res.status(200).json({ clausulas: out.clausulas || [], modelo });
  } catch (e) {
    return res.status(502).json({ error: "Falha ao redigir as cláusulas: " + (e && e.message ? e.message : String(e)) });
  }
}
