// api/ler-documento-obra.js — o procurement do gabinete: LER um documento de
// obra (cotação de fornecedor, aprovação do cliente, factura, comprovativo de
// pagamento, confirmação de encomenda) e devolvê-lo ESTRUTURADO para a app.
//
// PROPÕE, nunca decide (princípio 5 da casa): a app liga cada linha a um artigo
// pelo código e pelo fornecedor, a pessoa revê linha a linha, e só então se
// grava. Por isso aqui nada se inventa — o que não se lê fica vazio e vai em
// `por_ler`.
//
// Recebe texto (quando o PDF tem camada de texto) e/ou imagens das páginas
// (documentos digitalizados, rasterizados na app com o pdf.js). Metade das
// cotações do 137-2022 são digitalizadas (medido a 16/09/2026: 23 de 49).

import { autorizar, corpoAceitavel, dentroDaTaxa, escolherModelo, lerJsonDoModelo } from "./_comum.js";

const NUM = { type: ["number", "null"] };

const ESQUEMA = {
  type: "object",
  additionalProperties: false,
  required: ["tipo_detectado", "fornecedor", "numero", "data", "validade", "sinal_pct",
    "condicoes", "referencia_ne", "total_sem_iva", "total_com_iva", "valor_pago",
    "linhas", "observacoes", "por_ler"],
  properties: {
    tipo_detectado: {
      type: "string",
      enum: ["cotacao", "aprovacao", "factura_cliente", "factura_fornecedor", "pagamento",
        "confirmacao_encomenda", "outro"],
    },
    fornecedor: { type: "string", description: "Empresa que emite (cotação, factura do fornecedor, confirmação). Vazio se não se aplica." },
    numero: { type: "string", description: "Número do documento (orçamento, factura, NE). Vazio se não houver." },
    data: { type: "string", description: "Data do documento, AAAA-MM-DD. Vazio se não se lê." },
    validade: { type: "string", description: "Validade da cotação, AAAA-MM-DD. Vazio se não diz." },
    sinal_pct: { ...NUM, description: "Sinal/adiantamento exigido, em percentagem (40 = 40%)." },
    condicoes: { type: "string", description: "Condições de pagamento, entrega, transporte, montagem — resumo curto." },
    referencia_ne: { type: "string", description: "Nota de encomenda referida (ex.: NE-137-2022-003). Vazio se não há." },
    total_sem_iva: NUM,
    total_com_iva: NUM,
    valor_pago: { ...NUM, description: "Em comprovativos de pagamento: o valor transferido." },
    linhas: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["codigo", "referencia", "descricao", "qtd", "unidade", "preco", "portes",
          "prazo", "taxa_iva", "decisao", "nota"],
        properties: {
          codigo: { type: "string", description: "Código do gabinete se aparecer (ex.: 137-ADI-031). Vazio se não." },
          referencia: { type: "string", description: "Referência do fornecedor/catálogo." },
          descricao: { type: "string" },
          qtd: NUM,
          unidade: { type: "string", description: "un, m, m², ml… Vazio se não diz." },
          preco: { ...NUM, description: "Preço UNITÁRIO SEM IVA. Se o documento só tiver o total da linha, divide pela quantidade e diz-o na nota." },
          portes: NUM,
          prazo: { type: "string", description: "Prazo de produção/entrega desta linha, como escrito." },
          taxa_iva: { ...NUM, description: "Taxa de IVA da linha (23, 13, 6, 0)." },
          decisao: {
            type: "string", enum: ["", "aprovado", "revisao", "anulado"],
            description: "Só em aprovações do cliente: aprovado, pede revisão/alternativa, ou desiste.",
          },
          nota: { type: "string", description: "O que o documento diz sobre esta linha que importa (pedido do cliente, variante, dúvida)." },
        },
      },
    },
    observacoes: { type: "string" },
    por_ler: { type: "array", items: { type: "string" }, description: "O que existe no documento e não se conseguiu ler com segurança." },
  },
};

const SISTEMA = `Trabalhas para o gabinete ArquitectosRT (Fafe), no procurement de interiores e
obra: o gabinete pede cotações a fornecedores, apresenta propostas ao cliente,
regista as aprovações, encomenda e factura. Escreves em português europeu,
ortografia pré-1990 (projecto, direcção, adjudicação — nunca «projeto»).

Recebes UM documento (texto e/ou imagens das páginas) e devolves os dados
estruturados no esquema. O tipo esperado vem indicado, mas diz o tipo que o
documento É (tipo_detectado).

Por tipo:
- COTAÇÃO do fornecedor: cada linha com referência, descrição, quantidade,
  unidade, PREÇO UNITÁRIO SEM IVA, portes e prazo; a validade, o sinal exigido
  e as condições. Os artigos do gabinete têm códigos como «137-ADI-031» — se
  aparecerem, copia-os para «codigo».
- APROVAÇÃO do cliente (normalmente um email): uma linha por artigo referido,
  com a decisão — «aprovado», «revisao» (pede alteração, outra opção, amostra)
  ou «anulado» (desiste) — e o que o cliente disse em «nota». Artigo não
  referido não entra.
- FACTURA ao cliente (emitida pelo gabinete) ou do fornecedor: número, data,
  linhas com valor sem IVA e taxa de IVA, totais.
- PAGAMENTO (comprovativo, transferência): data, valor pago, a quem, e a
  referência da factura ou NE se aparecer.
- CONFIRMAÇÃO DE ENCOMENDA: número da NE, data, prazo de entrega, e as linhas
  com preço se o fornecedor os confirmar ou alterar.

Regras que não se quebram:
- NADA POR ADIVINHA. Um valor que não se lê com segurança fica null (ou vazio)
  e vai descrito em «por_ler». Nunca completes um preço a partir de outro.
- Preços SEM IVA. Se o documento só mostra valores com IVA, põe-nos no total
  com IVA e explica em observações; não os converte.
- Datas em AAAA-MM-DD.
- Não aprovas nem avalias: só lês.`;

export default async function handler(req, res) {
  if (!autorizar(req, res)) return;
  if (!dentroDaTaxa(res, "ler-documento-obra", 20)) return;
  if (!corpoAceitavel(req, res, 6 * 1024 * 1024)) return;

  const { tipo, texto, imagens } = req.body || {};
  const textoLimpo = typeof texto === "string" ? texto.slice(0, 60000) : "";
  const lista = Array.isArray(imagens) ? imagens : [];
  if (!textoLimpo.trim() && lista.length === 0) {
    return res.status(400).json({ error: "O documento chegou vazio (sem texto nem imagens)." });
  }
  if (lista.length > 6) {
    return res.status(400).json({ error: "Demasiadas páginas (máximo 6 imagens por documento)." });
  }
  const TIPOS_OK = new Set(["image/jpeg", "image/png", "image/webp"]);
  let bytes = 0;
  for (const im of lista) {
    if (im.mediaType && !TIPOS_OK.has(im.mediaType)) {
      return res.status(400).json({ error: `Tipo de imagem não aceite: ${im.mediaType}.` });
    }
    bytes += im.imagem ? String(im.imagem).length : 0;
  }
  if (bytes > 6 * 1024 * 1024) {
    return res.status(413).json({ error: "As páginas são demasiado grandes; envie menos páginas." });
  }

  const conteudo = [{ type: "text", text: `Tipo esperado: ${String(tipo || "outro")}.` }];
  if (textoLimpo.trim()) {
    conteudo.push({ type: "text", text: "TEXTO DO DOCUMENTO:\n" + textoLimpo });
  }
  lista.forEach((im, i) => {
    conteudo.push({ type: "text", text: `PÁGINA ${i + 1}:` });
    conteudo.push({
      type: "image",
      source: { type: "base64", media_type: im.mediaType || "image/jpeg", data: im.imagem },
    });
  });
  conteudo.push({ type: "text", text: "Lê o documento e devolve os dados no esquema." });

  const modelo = escolherModelo("ANTHROPIC_MODEL_LER_DOCUMENTO_OBRA", "claude-sonnet-5");
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
        output_config: { effort: "low", format: { type: "json_schema", schema: ESQUEMA } },
      }),
    });
    const dados = await resposta.json();
    if (!resposta.ok) {
      const msg = (dados && dados.error && dados.error.message) || "Erro na API da Anthropic.";
      return res.status(resposta.status).json({ error: msg });
    }
    const lido = lerJsonDoModelo(dados, res, "a leitura do documento");
    if (!lido) return;
    return res.status(200).json({ modelo, ...lido });
  } catch (e) {
    return res.status(500).json({ error: "Falha a contactar a Anthropic: " + e.message });
  }
}
