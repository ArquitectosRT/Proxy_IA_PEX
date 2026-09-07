// api/rever-regra.js — o afinador das REGRAS DAS PEÇAS.
//
// O arquitecto escreve a regra em bruto, como lhe sai («os alçados precisam
// da legenda dos materiais»); este canal devolve-a na forma VERIFICÁVEL — uma
// frase que outro arquitecto (ou o modelo, numa avaliação) consegue conferir
// sem adivinhar. NÃO inventa exigências novas: reescreve o que lá está, e
// diz o que ficou por decidir.
//
// Duas fases, como manda a casa: o modelo PROPÕE, o arquitecto aprova, e só
// então a regra entra na memória do gabinete.

import { autorizar, corpoAceitavel, dentroDaTaxa, escolherModelo, lerJsonDoModelo } from "./_comum.js";

const ESQUEMA = {
  type: "object",
  additionalProperties: false,
  required: ["texto", "porque", "duvidas"],
  properties: {
    texto: {
      type: "string",
      description: "A regra reescrita: uma frase afirmativa, concreta e verificável, em português europeu pré-AO90.",
    },
    porque: {
      type: "string",
      description: "Numa linha, o que se mudou face ao rascunho (e porquê).",
    },
    duvidas: {
      type: "array",
      description: "O que o rascunho não decide e o arquitecto tem de decidir (vazio se não houver).",
      items: { type: "string" },
    },
  },
};

const SISTEMA = `És um arquitecto sénior português do gabinete ArquitectosRT (Fafe) a
ajudar a escrever as REGRAS DAS PEÇAS da casa — o que TEM de estar nas peças
desenhadas de cada fase de projecto. Escreves em português europeu, ortografia
pré-1990 (projecto, execução, direcção — nunca «projeto»).

Recebes um RASCUNHO escrito pelo arquitecto e devolve-lo na forma verificável.

O que faz uma boa regra:
- afirmativa e concreta: diz o que TEM de estar (ou o que não pode estar),
  não «deve-se ter cuidado com»;
- verificável por quem olha para a folha: outra pessoa consegue dizer
  «cumpre» ou «não cumpre» sem interpretar intenções;
- com o objecto nomeado: que elemento, que informação, em que peça;
- uma regra por frase — se o rascunho traz duas exigências, escolhe a
  principal e põe a outra nas dúvidas;
- curta: uma ou duas frases, sem preâmbulo.

LIMITES (obrigatórios):
- NÃO acrescentes exigências que o rascunho não tem. Nada de números,
  escalas, normas ou materiais que o arquitecto não escreveu — se achas que
  falta precisão, isso é uma DÚVIDA, não uma invenção.
- Mantém o vocabulário da casa (folha, alçado, corte, implantação, mapa de
  vãos, cores convencionais, toscos, acabamentos).
- Não repitas a fase nem o nome da folha dentro do texto se já vierem
  indicados — a regra já é guardada com essa informação.
- Se o rascunho já estiver bom, devolve-o quase igual e di-lo em «porque».`;

export default async function handler(req, res) {
  if (!autorizar(req, res)) return;
  if (!dentroDaTaxa(res, "rever-regra", 20)) return;
  if (!corpoAceitavel(req, res, 64 * 1024)) return;

  const { rascunho, fase, folhas, gravidade } = req.body || {};
  const bruto = typeof rascunho === "string" ? rascunho.trim() : "";
  if (!bruto) {
    return res.status(400).json({ error: "Sem rascunho para afinar." });
  }
  if (bruto.length > 4000) {
    return res.status(413).json({ error: "O rascunho é demasiado longo." });
  }

  const contexto = [
    `FASE: ${typeof fase === "string" && fase ? fase : "(não indicada)"}`,
    `FOLHAS: ${Array.isArray(folhas) && folhas.length
      ? folhas.slice(0, 20).join(", ")
      : "(nenhuma — a regra é transversal a todas as folhas da fase)"}`,
    `GRAVIDADE: ${typeof gravidade === "string" && gravidade ? gravidade : "IMPORTANTE"}`,
    "",
    "RASCUNHO DO ARQUITECTO:",
    bruto,
  ].join("\n");

  const modelo = escolherModelo("ANTHROPIC_MODEL_REGRAS", "claude-haiku-4-5");
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
        max_tokens: 2000,
        system: SISTEMA,
        messages: [{ role: "user", content: contexto }],
        output_config: { format: { type: "json_schema", schema: ESQUEMA } },
      }),
    });

    const dados = await resposta.json();
    if (!resposta.ok) {
      const msg = (dados && dados.error && dados.error.message) || "Erro na API da Anthropic.";
      return res.status(resposta.status).json({ error: msg });
    }
    const proposta = lerJsonDoModelo(dados, res, "a regra revista");
    if (!proposta) return;
    return res.status(200).json({ modelo, ...proposta });
  } catch (e) {
    return res.status(500).json({ error: "Falha a contactar a Anthropic: " + e.message });
  }
}
