// api/ficha-capa.js — proxy de IA do gabinete ArquitectosRT (Nível 2 do PEX).
//
// Recebe o TEXTO da capa das peças desenhadas (extraído na app, determinista)
// e devolve os campos da ficha da obra, estruturados pelo Claude. A chave da
// API vive só aqui, no servidor, protegida pela senha de equipa.
//
// Sem dependências: usa o fetch nativo do Node 18+ da Vercel.
//
// Variáveis de ambiente (definidas na Vercel, NUNCA no código):
//   ANTHROPIC_API_KEY  — a chave nova da conta Anthropic (gabinete-pex)
//   APP_PASSWORD       — senha de equipa (cabeçalho x-app-password)
//   ANTHROPIC_MODEL    — opcional; por omissão claude-opus-5.
//                        Para esta extração simples recomenda-se
//                        claude-haiku-4-5 (muito mais barato, chega e sobra).

// Esquema da ficha — a saída estruturada obriga o modelo a devolver EXACTAMENTE
// estes campos. Valores em falta ficam "[a confirmar]" (regra do molde).
const FICHA_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    processo: { type: "string", description: "Código do processo NNN-AAAA (ex.: 203-2025)." },
    nome_projecto: { type: "string", description: "Nome curto do projecto/casa (ex.: CASA SP)." },
    designacao_obra: { type: "string", description: "Descrição da obra (ex.: CONSTRUÇÃO DE MORADIA UNIFAMILIAR E MURO)." },
    requerente: { type: "string", description: "Requerente/dono de obra (nome das pessoas)." },
    dono_obra: { type: "string", description: "Dono de obra, se distinto do requerente; senão igual." },
    local_obra: { type: "string", description: "Morada/local da obra." },
    freguesia_concelho: { type: "string", description: "Freguesia e concelho (ex.: Cepães, Fafe)." },
    data: { type: "string", description: "Data que consta do carimbo (ex.: JULHO 2026)." },
    rev: { type: "string", description: "Revisão REV+letra, se constar (ex.: REVA)." },
    processo_camarario: { type: "string", description: "NUNCA está no carimbo — devolver sempre \"[a confirmar]\"." },
  },
  required: [
    "processo", "nome_projecto", "designacao_obra", "requerente", "dono_obra",
    "local_obra", "freguesia_concelho", "data", "rev", "processo_camarario",
  ],
};

const SISTEMA = `És um assistente do gabinete de arquitectura ArquitectosRT (Fafe, Portugal). Recebes o TEXTO BARALHADO do carimbo/rótulo da capa das peças desenhadas de um projecto de execução e organizas-lo nos campos da ficha da obra.

Regras invioláveis:
- Ortografia pré-AO90 (projecto, execução, arquitectura, direcção…). Converte na saída se o texto vier noutra grafia.
- NÃO inventes. Qualquer campo que não conste do texto fica exactamente "[a confirmar]".
- O processo camarário NUNCA está no carimbo — devolve sempre "[a confirmar]" em processo_camarario.
- O carimbo espelha o texto (cada valor costuma aparecer a dobrar) — usa cada valor uma só vez.
- processo é o código no formato NNN-AAAA (ex.: 203-2025).
- Distingue com cuidado: nome_projecto é o nome curto da casa; designacao_obra é a descrição da intervenção; requerente/dono_obra são as pessoas; local_obra é a morada.`;

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Só aceita POST." });
  }
  if ((req.headers["x-app-password"] || "") !== process.env.APP_PASSWORD) {
    return res.status(401).json({ error: "Palavra-passe da equipa inválida." });
  }
  const texto = (req.body && req.body.texto_capa) || "";
  if (!String(texto).trim()) {
    return res.status(400).json({ error: "Falta o texto da capa (texto_capa)." });
  }

  const modelo = process.env.ANTHROPIC_MODEL || "claude-opus-5";
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
        max_tokens: 2048,
        system: SISTEMA,
        messages: [
          { role: "user", content: `Texto do carimbo da capa:\n"""\n${texto}\n"""` },
        ],
        // Saída estruturada: o primeiro bloco de texto vem em JSON válido
        // conforme o esquema — sem parsing por adivinha.
        output_config: { format: { type: "json_schema", schema: FICHA_SCHEMA } },
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
      return res.status(502).json({ error: "Resposta do modelo sem texto." });
    }
    const ficha = JSON.parse(bloco.text);
    return res.status(200).json({ ficha, modelo });
  } catch (e) {
    return res.status(502).json({ error: "Falha ao extrair a ficha: " + (e && e.message ? e.message : String(e)) });
  }
}
