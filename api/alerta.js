// api/alerta.js — canal de ALERTA de arranque não autorizado.
//
// COPIAR este ficheiro para o repositório do proxy (..\Proxy_IA_PEX\api\) e
// fazer redeploy na Vercel. NÃO precisa de nenhuma chave nem variável nova.
//
// É um canal SÓ DE ESCRITA: recebe avisos de postos que tentaram arrancar sem
// licença válida. Nunca devolve dados (responde sempre 204), para não dar
// pistas a quem estiver a testar uma cópia. Sem senha de equipa — o endereço
// está cravado na aplicação e o que aqui chega é, por definição, de uma cópia
// que ainda não tem configuração nenhuma.

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

export default async function handler(req, res) {
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
    utilizador_windows: campo(c.utilizador_windows),
    versao: campo(c.versao),
    quando: campo(c.quando),
    ip,
  };

  if (!demasiado(ip)) {
    // Fica nos registos da Vercel (Project > Logs). É aqui que o gabinete vê
    // que uma cópia tentou arrancar fora, de onde e quando.
    console.log(JSON.stringify(alerta));

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
