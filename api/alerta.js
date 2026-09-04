// api/alerta.js — canal de ALERTA de arranque não autorizado.
//
// COPIAR este ficheiro para o repositório do proxy (..\Proxy_IA_PEX\api\) e
// fazer redeploy na Vercel. Usa o MESMO Blob store dos revogados (a variável
// BLOB_READ_WRITE_TOKEN já lá está) — não precisa de mais nada.
//
// É um canal de ESCRITA para as cópias: recebe avisos de postos que tentaram
// arrancar sem licença válida. Responde sempre 204, para não dar pistas a quem
// estiver a testar uma cópia. Sem senha de equipa — o endereço está cravado na
// aplicação e o que aqui chega é, por definição, de uma cópia que ainda não
// tem configuração nenhuma.
//
// OS ALERTAS FICAM GUARDADOS (auditoria de 03/09/2026, B4). Até aqui só iam
// para o `console.log` — os registos da Vercel guardam-se ~1 h no plano
// gratuito, e uma cópia extraviada que arrancasse ao sábado não deixava nada
// para segunda-feira. Agora cada alerta é acrescentado a `alertas.jsonl` no
// Blob store (as últimas 500 linhas). Para os ver: painel da Vercel > Storage >
// o Blob store > alertas.jsonl; ou GET /api/alerta com o cabeçalho
// x-app-password (a senha de equipa), que devolve o ficheiro.
//
// O QUE VAI NO ALERTA (auditoria de 03/09/2026, B3 — RGPD, minimização): o
// evento, o nome do posto, a impressão, a versão e a hora. O nome do
// utilizador do Windows DEIXOU de ir — a impressão e o posto bastam para o
// livro de postos fazer o casamento. O IP fica, para se saber DE ONDE
// arrancou a cópia; é apagado com a linha ao fim das 500. O ecrã de activação
// diz ao utilizador que este aviso é enviado.

import { put, list } from "@vercel/blob";

const NOME = "alertas.jsonl";
const MAX_LINHAS = 500;

// Limitador rudimentar em memória (por instância da função): trava enchentes.
const visto = new Map(); // ip -> [carimbos]
const JANELA_MS = 60_000;
const MAX_POR_JANELA = 10;

function demasiado(ip) {
  const agora = Date.now();
  const lista = (visto.get(ip) || []).filter((t) => agora - t < JANELA_MS);
  lista.push(agora);
  visto.set(ip, lista);
  return lista.length > MAX_POR_JANELA;
}

// Comparação da senha em tempo constante (não revela o comprimento por timing).
function senhaConfere(recebida) {
  const esperada = process.env.APP_PASSWORD || "";
  if (!recebida || recebida.length !== esperada.length) return false;
  let dif = 0;
  for (let i = 0; i < esperada.length; i++) {
    dif |= recebida.charCodeAt(i) ^ esperada.charCodeAt(i);
  }
  return dif === 0;
}

async function textoGuardado() {
  const { blobs } = await list({ prefix: NOME });
  const b = blobs.find((x) => x.pathname === NOME);
  if (!b) return "";
  const r = await fetch(b.url);
  return r.ok ? await r.text() : "";
}

/** Acrescenta uma linha ao ficheiro dos alertas. Melhor-esforço: se o Blob
 *  não estiver disponível, fica o `console.log` — como dantes. */
async function guardar(alerta) {
  try {
    const linhas = textoGuardado().then((t) => t.split("\n").filter(Boolean));
    const todas = await linhas;
    todas.push(JSON.stringify(alerta));
    const ultimas = todas.slice(-MAX_LINHAS);
    await put(NOME, ultimas.join("\n") + "\n", {
      access: "public",
      contentType: "text/plain; charset=utf-8",
      addRandomSuffix: false,
      allowOverwrite: true,
    });
  } catch (_) {
    /* melhor-esforço */
  }
}

export default async function handler(req, res) {
  if (req.method === "GET") {
    // Só o gabinete lê: com a senha de equipa. Sem ela responde-se como se o
    // canal não existisse.
    if (!senhaConfere(req.headers["x-app-password"])) {
      res.status(404).end();
      return;
    }
    try {
      res.setHeader("content-type", "text/plain; charset=utf-8");
      res.status(200).send(await textoGuardado());
    } catch (_) {
      res.status(500).json({ error: "Não consegui ler os alertas." });
    }
    return;
  }

  if (req.method !== "POST") {
    res.status(405).json({ error: "Só POST." });
    return;
  }
  const ip =
    (req.headers["x-forwarded-for"] || "").split(",")[0].trim() || "?";

  // Aceita só os campos previstos, cada um limitado a 200 caracteres.
  const c = req.body || {};
  const campo = (v) => (typeof v === "string" ? v.slice(0, 200) : "");
  const alerta = {
    tipo: "ALERTA_POSTO",
    evento: campo(c.evento),
    posto: campo(c.posto),
    impressao: campo(c.impressao),
    versao: campo(c.versao),
    quando: campo(c.quando),
    recebido: new Date().toISOString(),
    ip,
  };

  if (!demasiado(ip)) {
    // Fica nos registos da Vercel (Project > Logs) E no ficheiro dos alertas.
    console.log(JSON.stringify(alerta));
    await guardar(alerta);

    // OPCIONAL — aviso por e-mail. Descomentar e configurar RESEND_API_KEY nas
    // variáveis de ambiente da Vercel para receber os alertas em
    // geral@arquitectosrt.pt. Falha em silêncio (o alerta é melhor-esforço).
    //
    // try {
    //   if (process.env.RESEND_API_KEY) {
    //     await fetch("https://api.resend.com/emails", {
    //       method: "POST",
    //       headers: {
    //         "content-type": "application/json",
    //         authorization: `Bearer ${process.env.RESEND_API_KEY}`,
    //       },
    //       body: JSON.stringify({
    //         from: "alertas@arquitectosrt.pt",
    //         to: "geral@arquitectosrt.pt",
    //         subject: `Alerta de posto: ${alerta.evento}`,
    //         text: JSON.stringify(alerta, null, 2),
    //       }),
    //     });
    //   }
    // } catch (_) {
    //   /* melhor-esforço */
    // }
  }

  // Responde sempre igual, com ou sem gravação: não dar sinal ao atacante.
  res.status(204).end();
}
