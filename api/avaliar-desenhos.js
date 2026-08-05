// api/avaliar-desenhos.js — Fase 2 do relatório de avaliação técnica: o juízo
// VISUAL das peças desenhadas. Recebe um LOTE de folhas rasterizadas (a app
// converte o PDF em imagens com o pdf.js e envia por lotes, porque a Vercel
// limita o corpo do pedido a ~4,5 MB) e devolve os achados de grafismo por
// folha. A síntese final é feita pela app, juntando os lotes.
//
// O modelo VÊ as folhas: composição, cotagens em falta, legendas vazias,
// sobreposições, esquadria. Limite honesto (dito no esquema): a resolução da
// rasterização não permite julgar espessuras de traço ao milímetro.

const ESQUEMA = {
  type: "object",
  additionalProperties: false,
  required: ["folhas"],
  properties: {
    folhas: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["folha", "titulo_lido", "nota_grafismo", "achados"],
        properties: {
          folha: { type: "integer", description: "Número da folha (o que foi enviado)" },
          titulo_lido: { type: "string", description: "Título/assunto lido na legenda da folha" },
          nota_grafismo: { type: "number", description: "0-10: qualidade gráfica e de informação da folha" },
          achados: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["severidade", "observacao"],
              properties: {
                severidade: { type: "string", enum: ["CRÍTICA", "IMPORTANTE", "RECOMENDÁVEL"] },
                observacao: { type: "string" },
              },
            },
          },
        },
      },
    },
  },
};

const SISTEMA = `És um arquitecto sénior português do gabinete ArquitectosRT (Fafe), a rever
VISUALMENTE as peças desenhadas de um Projecto de Execução de uma moradia,
antes de chegarem aos arquitectos titulares. Escreves em português europeu,
ortografia pré-1990 (projecto, execução, direcção — nunca «projeto»).

Recebes folhas rasterizadas do caderno de peças desenhadas. Para CADA folha,
avalia o que se VÊ:
- composição e aproveitamento da folha; esquadria e margens; legenda completa;
- cotagem: cadeias de cotas presentes onde são precisas (plantas, cortes,
  alçados); cotas de vãos; níveis; sem cotas sobrepostas ou ilegíveis;
- anotação: notas-chave onde fazem falta, textos que se sobrepõem ao desenho,
  rótulos trocados, «?» por resolver;
- representação: tramas coerentes, elementos cortados vs vista, portas com
  sentido de abertura, escadas com sentido de subida, norte nas plantas;
- coerência visual entre folhas do mesmo lote (mesma escala anunciada,
  mesmos estilos).

PADRÕES DO GABINETE — verifica SEMPRE, quando a folha for do tipo em causa
(vêm dos relatórios de referência do PEX 203 e das regras da casa):
1. Folhas de toscos, pavimentos/pisos, acabamentos de paredes e tectos: cada
   elemento-tipo tem de ter uma COR/TRAMA DIFERENTE, com legenda própria —
   dois tipos distintos com a mesma cor é não-conformidade.
2. Folhas de compartimentos: TODAS as vistas da folha à MESMA escala anunciada
   — planta a 1:20 com planta de tecto a 1:50 na mesma folha é não-conformidade.
3. A planta base envolvente (terreno em volta da casa, terraços, piscina) tem
   de ser o LEVANTAMENTO TOPOGRÁFICO A CINZA, igual em todas as folhas —
   variar de folha para folha é não-conformidade.
4. Cores convencionais: as tramas têm de distinguir os materiais de pavimento
   (soalho vs cerâmico) — cores chapadas que não deixam ler o material são
   não-conformidade.
5. Legendas e textos NUNCA por cima de elementos desenhados (ex.: louças
   sanitárias tapadas por legendas).
6. Cortes a 1:50 com paredes enterradas ou muros: verificar a presença de
   DRENOS PERIFÉRICOS — a ausência é achado CRÍTICO.
7. Piscina em corte: as camadas construtivas têm de estar corretas e legíveis
   (estrutura, impermeabilização, revestimento, drenagem) — ordem ou
   representação incoerente é CRÍTICA.
8. Tectos por compartimento: nas I.S. e cozinha o tecto tem de ser HIDRÓFUGO;
   em tectos exteriores, PLACA CIMENTÍCIA — se a legenda/trama mostrar tecto
   standard nesses locais, assinala como CRÍTICA.
9. A piscina merece folha própria no capítulo dos compartimentos — se só
   aparecer na implantação, assinala IMPORTANTE.

EXCEPÇÃO da casa: o gabinete NÃO usa escala gráfica — a sua ausência NÃO é
achado; não a menciones.

Regras:
- Aponta só o que se VÊ na imagem — nada por adivinha. Se a resolução não
  permitir afirmar, não afirmes.
- Nota 0-10 por folha, ao padrão exigente do gabinete (7 é bom; 9-10 é raro).
- Achados concretos e accionáveis, citando a zona da folha («no canto inferior
  esquerdo», «na cadeia de cotas exterior do alçado sul»).
- NUNCA aprovas: assinalas e propões. A decisão é dos arquitectos.`;

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Só aceita POST." });
  }
  if ((req.headers["x-app-password"] || "") !== process.env.APP_PASSWORD) {
    return res.status(401).json({ error: "Palavra-passe inválida." });
  }

  const { folhas } = req.body || {};
  if (!Array.isArray(folhas) || folhas.length === 0) {
    return res.status(400).json({ error: "Sem folhas para avaliar." });
  }
  if (folhas.length > 8) {
    return res.status(400).json({ error: "Lote demasiado grande (máximo 8 folhas)." });
  }

  // conteúdo multimodal: rótulo + imagem, folha a folha
  const conteudo = [];
  for (const f of folhas) {
    conteudo.push({ type: "text", text: `FOLHA ${f.numero} de ${f.total}:` });
    conteudo.push({
      type: "image",
      source: { type: "base64", media_type: f.mediaType || "image/png", data: f.imagem },
    });
  }
  conteudo.push({
    type: "text",
    text: "Avalia cada folha acima (usa o número indicado antes de cada imagem).",
  });

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
        max_tokens: 16000,
        system: SISTEMA,
        messages: [{ role: "user", content: conteudo }],
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
      const razao = dados.stop_reason || "sem texto";
      return res.status(502).json({
        error: "A resposta veio vazia (" + razao + ")."
          + (razao === "max_tokens" ? " Reduzir o tamanho do lote." : ""),
      });
    }
    let avaliacao;
    try {
      avaliacao = JSON.parse(bloco.text);
    } catch (e) {
      return res.status(502).json({ error: "JSON inválido do modelo: " + e.message });
    }
    return res.status(200).json({ modelo, ...avaliacao });
  } catch (e) {
    return res.status(500).json({ error: "Falha a contactar a Anthropic: " + e.message });
  }
}
