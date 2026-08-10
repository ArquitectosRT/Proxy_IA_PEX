// api/_comum.js — utilitários partilhados dos proxies de IA do gabinete
// ArquitectosRT. Sem dependências externas (só o que o Node 18+ da Vercel traz).
//
// Ficheiro com prefixo "_": a Vercel NÃO o trata como rota; é apenas importado
// pelas funções api/*.js. Concentra aqui a autenticação, os tectos de tamanho,
// o travão de pedidos e a escolha de modelo, para as sete funções falarem a
// mesma língua e uma correcção se fazer num sítio só.

import crypto from "node:crypto";

// -------- autenticação (comparação resistente a timing) --------
// Compara a senha recebida com a do servidor em tempo constante. Se a
// APP_PASSWORD não estiver definida na Vercel, nega tudo (falha fechada).
function senhaValida(recebida) {
  const esperada = process.env.APP_PASSWORD;
  if (!esperada) return false;
  const a = Buffer.from(String(recebida == null ? "" : recebida), "utf8");
  const b = Buffer.from(String(esperada), "utf8");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

// Valida método e senha. Devolve false (e já respondeu) se não passar.
export function autorizar(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Só aceita POST." });
    return false;
  }
  if (!senhaValida(req.headers["x-app-password"])) {
    res.status(401).json({ error: "Palavra-passe da equipa inválida." });
    return false;
  }
  return true;
}

// -------- tecto de tamanho do corpo --------
// A Vercel já corta ~4,5 MB, mas convém recusar cedo, com mensagem clara, e
// travar corpos absurdos ANTES de gastar uma chamada de IA.
export function corpoAceitavel(req, res, maxBytes) {
  let bytes = Number(req.headers["content-length"] || 0);
  if (!bytes) {
    try { bytes = Buffer.byteLength(JSON.stringify(req.body || ""), "utf8"); }
    catch { bytes = 0; }
  }
  if (bytes > maxBytes) {
    res.status(413).json({
      error: `Pedido demasiado grande (${Math.round(bytes / 1024)} KB; máximo ${Math.round(maxBytes / 1024)} KB).`,
    });
    return false;
  }
  return true;
}

// -------- travão de pedidos BEST-EFFORT (em memória, por instância quente) --------
// NÃO é à prova de bala: a Vercel corre várias instâncias e arranca a frio, por
// isso este contador não é global. Serve para travar um CICLO ACIDENTAL de um
// posto dentro de uma instância quente. O tecto REAL de custo é o orçamento
// configurado na consola da Anthropic/FAL — ver o relatório de auditoria.
const _janelas = new Map(); // chave -> { inicio, contagem }
export function dentroDaTaxa(res, chave, maxPorMinuto) {
  const agora = Date.now();
  const j = _janelas.get(chave);
  if (!j || agora - j.inicio > 60000) {
    _janelas.set(chave, { inicio: agora, contagem: 1 });
    return true;
  }
  j.contagem += 1;
  if (j.contagem > maxPorMinuto) {
    res.status(429).json({ error: "Demasiados pedidos seguidos. Aguarde um minuto e tente de novo." });
    return false;
  }
  return true;
}

// -------- escolha de modelo (NUNCA cai no Opus por omissão) --------
// Lê a variável de ambiente indicada; se estiver vazia, usa o fallback (que é
// sempre o modelo barato/adequado, nunca o mais caro).
export function escolherModelo(envVar, fallback) {
  const v = process.env[envVar];
  return (v && String(v).trim()) || fallback;
}
