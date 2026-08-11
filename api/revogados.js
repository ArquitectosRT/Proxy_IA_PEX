// api/revogados.js — lista de postos REVOGADos, assinada pelo dono.
//
// COPIAR este ficheiro para o repositório do proxy (..\Proxy_IA_PEX\api\) e
// fazer redeploy na Vercel. Precisa do armazenamento Vercel Blob (ver abaixo).
//
// COMO FUNCIONA:
//   GET  /api/revogados      → devolve a lista assinada { carga_b64, assinatura_b64 }
//                              (pública; a app verifica a assinatura com a chave
//                              embebida — o servidor NÃO precisa de saber o segredo)
//   POST /api/revogados      → substitui a lista. Exige o cabeçalho x-app-password
//                              (a mesma senha de equipa dos outros canais). O corpo
//                              é a lista JÁ ASSINADA que a app do dono gera.
//
// O servidor NUNCA valida a assinatura — quem a valida é cada posto. Por isso,
// mesmo que este servidor fosse comprometido, não consegue forjar uma lista:
// sem a chave privada do dono, qualquer lista falsa é recusada nos postos.
//
// ARMAZENAMENTO — Vercel Blob (recomendado):
//   1. No painel da Vercel: Storage > Create > Blob store, ligado a este projecto.
//      Isso injecta a variável BLOB_READ_WRITE_TOKEN automaticamente.
//   2. Instalar a dependência no repositório do proxy:  npm i @vercel/blob
//   3. Publicar a lista VAZIA uma vez (a app faz isto no ecrã Postos, botão
//      «Publicar lista vazia», na cerimónia inicial).
//
// Se preferir não usar Blob, dá para guardar num Edge Config ou num KV; o
// contrato (GET devolve o JSON assinado, POST substitui-o) mantém-se.

import { put, list } from "@vercel/blob";

const NOME = "revogados.json";

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

async function urlDaLista() {
  const { blobs } = await list({ prefix: NOME });
  const b = blobs.find((x) => x.pathname === NOME);
  return b ? b.url : null;
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
    if (typeof corpo.carga_b64 !== "string" || typeof corpo.assinatura_b64 !== "string") {
      res.status(400).json({ error: "Corpo tem de ser { carga_b64, assinatura_b64 }." });
      return;
    }
    try {
      await put(NOME, JSON.stringify(corpo), {
        access: "public",
        contentType: "application/json",
        addRandomSuffix: false,
        allowOverwrite: true,
      });
      res.status(200).json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: "Não consegui gravar a lista." });
    }
    return;
  }

  res.status(405).json({ error: "Só GET ou POST." });
}
