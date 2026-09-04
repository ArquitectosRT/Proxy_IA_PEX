// api/revogados.js — lista de postos REVOGADOS, assinada pelo dono.
//
// COPIAR este ficheiro para o repositório do proxy (..\Proxy_IA_PEX\api\) e
// fazer redeploy na Vercel. Precisa do armazenamento Vercel Blob (ver abaixo)
// e, desde 04/09/2026, da variável ARTRT_CHAVE_PUBLICA (ver abaixo).
//
// COMO FUNCIONA:
//   GET  /api/revogados      → devolve a lista assinada { carga_b64, assinatura_b64 }
//                              (pública; a app verifica a assinatura com a chave
//                              embebida — o servidor NÃO precisa de saber o segredo)
//   POST /api/revogados      → substitui a lista. Exige o cabeçalho x-app-password
//                              (a mesma senha de equipa dos outros canais) E uma
//                              assinatura válida do dono sobre a carga.
//
// A ASSINATURA É VERIFICADA AQUI TAMBÉM (auditoria de 03/09/2026, B1). Até
// aqui o servidor gravava o que viesse com a senha certa; e a senha, partilhada
// pelos cinco postos, chegava para APAGAR a lista — POST {carga_b64:"x",
// assinatura_b64:"x"} punha os portáteis em «não contactado» e bloqueava-os ao
// 8.º dia. Sem a chave privada não se forja uma lista; mas apagar não precisa
// de forjar nada. O servidor não precisa do segredo para isto — precisa da
// chave PÚBLICA, que é pública: a mesma de src-tauri/chave_publica.txt, em
// ARTRT_CHAVE_PUBLICA (64 hexadecimais). SEM ELA, O POST É RECUSADO — um erro
// de configuração fecha portas, nunca as abre.
//
// Mais três guardas: tecto de 64 KB no corpo (cada portátil descarrega a lista
// de 5 em 5 min), forma da carga (v, revogados = lista de impressões de 64
// hex, emitida_em), e MONOTONIA — uma lista com `emitida_em` mais antigo do que
// a publicada não a substitui (mata o replay de uma lista vazia antiga).
//
// ARMAZENAMENTO — Vercel Blob (recomendado):
//   1. No painel da Vercel: Storage > Create > Blob store, ligado a este projecto.
//      Isso injecta a variável BLOB_READ_WRITE_TOKEN automaticamente.
//   2. Instalar a dependência no repositório do proxy:  npm i @vercel/blob
//   3. Definir ARTRT_CHAVE_PUBLICA nas variáveis de ambiente (Settings >
//      Environment Variables) com o conteúdo de src-tauri/chave_publica.txt.
//   4. Publicar a lista VAZIA uma vez (a app faz isto no ecrã Postos, botão
//      «Publicar lista vazia», na cerimónia inicial).

import { put, list } from "@vercel/blob";
import { createPublicKey, verify as verificarAssinatura } from "node:crypto";

const NOME = "revogados.json";
const TECTO_CORPO = 64 * 1024;
// Prefixo DER (SubjectPublicKeyInfo) de uma chave pública Ed25519; a chave
// crua de 32 bytes vem a seguir.
const DER_ED25519 = "302a300506032b6570032100";

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

function chavePublica() {
  const hex = (process.env.ARTRT_CHAVE_PUBLICA || "").trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(hex)) return null;
  try {
    return createPublicKey({
      key: Buffer.from(DER_ED25519 + hex, "hex"),
      format: "der",
      type: "spki",
    });
  } catch (_) {
    return null;
  }
}

/** Confere assinatura e forma. Devolve { carga } ou { motivo }. */
function listaValida(corpo, chave) {
  if (typeof corpo.carga_b64 !== "string" || typeof corpo.assinatura_b64 !== "string") {
    return { motivo: "Corpo tem de ser { carga_b64, assinatura_b64 }." };
  }
  let cargaBytes, sig;
  try {
    cargaBytes = Buffer.from(corpo.carga_b64, "base64");
    sig = Buffer.from(corpo.assinatura_b64, "base64");
  } catch (_) {
    return { motivo: "A carga ou a assinatura não são base64." };
  }
  if (sig.length !== 64 || cargaBytes.length === 0) {
    return { motivo: "Assinatura com tamanho errado." };
  }
  let ok = false;
  try {
    ok = verificarAssinatura(null, cargaBytes, chave, sig);
  } catch (_) {
    ok = false;
  }
  if (!ok) return { motivo: "A assinatura não é do dono do gabinete." };
  let carga;
  try {
    carga = JSON.parse(cargaBytes.toString("utf8"));
  } catch (_) {
    return { motivo: "A carga assinada não é JSON." };
  }
  if (
    !carga || typeof carga !== "object" ||
    carga.v !== 1 ||
    (carga.tipo !== undefined && carga.tipo !== "revogados") ||
    !Array.isArray(carga.revogados) ||
    !carga.revogados.every((x) => typeof x === "string" && /^[0-9a-f]{64}$/.test(x)) ||
    typeof carga.emitida_em !== "string" || !carga.emitida_em
  ) {
    return { motivo: "A carga não tem a forma de uma lista de revogados." };
  }
  return { carga };
}

async function urlDaLista() {
  const { blobs } = await list({ prefix: NOME });
  const b = blobs.find((x) => x.pathname === NOME);
  return b ? b.url : null;
}

/** O `emitida_em` da lista publicada, ou "" se não houver. Só lê a carga —
 *  não precisa de a verificar: serve para a monotonia, e uma lista publicada
 *  já passou por aqui. */
async function emitidaEmPublicada() {
  try {
    const url = await urlDaLista();
    if (!url) return "";
    const r = await fetch(url);
    const j = await r.json();
    const carga = JSON.parse(Buffer.from(j.carga_b64 || "", "base64").toString("utf8"));
    return typeof carga.emitida_em === "string" ? carga.emitida_em : "";
  } catch (_) {
    return "";
  }
}

export default async function handler(req, res) {
  if (req.method === "GET") {
    try {
      const url = await urlDaLista();
      if (!url) {
        // Nunca publicada: lista vazia não assinada. Os postos tratam isto como
        // «não contactado» (a assinatura falha) — inofensivo até à cerimónia.
        res.status(200).json({ carga_b64: "", assinatura_b64: "" });
        return;
      }
      const r = await fetch(url);
      const texto = await r.text();
      res.setHeader("content-type", "application/json");
      res.status(200).send(texto);
    } catch (e) {
      res.status(500).json({ error: "Não consegui ler a lista." });
    }
    return;
  }

  if (req.method === "POST") {
    if (!senhaConfere(req.headers["x-app-password"])) {
      res.status(401).json({ error: "Senha inválida." });
      return;
    }
    const corpo = req.body || {};
    if (JSON.stringify(corpo).length > TECTO_CORPO) {
      res.status(413).json({ error: "Corpo demasiado grande." });
      return;
    }
    const chave = chavePublica();
    if (!chave) {
      // FECHA, não abre: sem a chave pública configurada não se publica nada.
      res.status(500).json({
        error: "ARTRT_CHAVE_PUBLICA não está configurada na Vercel — a lista não se publica sem ela.",
      });
      return;
    }
    const v = listaValida(corpo, chave);
    if (!v.carga) {
      res.status(400).json({ error: v.motivo });
      return;
    }
    const anterior = await emitidaEmPublicada();
    // Carimbos ISO comparam-se como texto: «2026-09-04T10:00:00Z» > «2026-08-…».
    if (anterior && v.carga.emitida_em < anterior) {
      res.status(409).json({
        error: `A lista enviada (${v.carga.emitida_em}) é mais antiga do que a publicada (${anterior}). Publique uma lista nova.`,
      });
      return;
    }
    try {
      await put(NOME, JSON.stringify({ carga_b64: corpo.carga_b64, assinatura_b64: corpo.assinatura_b64 }), {
        access: "public",
        contentType: "application/json",
        addRandomSuffix: false,
        allowOverwrite: true,
      });
      res.status(200).json({ ok: true, revogados: v.carga.revogados.length, emitida_em: v.carga.emitida_em });
    } catch (e) {
      res.status(500).json({ error: "Não consegui gravar a lista." });
    }
    return;
  }

  res.status(405).json({ error: "Só GET ou POST." });
}
