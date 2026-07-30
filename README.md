# Proxy de IA — PEX (ArquitectosRT)

Proxy pequeno e **separado** que dá à app de secretária o canal de IA do Nível 2
do PEX. A chave da API vive só aqui (no servidor da Vercel), nunca na app.
Protegido por uma senha de equipa.

**Sem dependências** — usa o `fetch` nativo do Node da Vercel.

## Funções

- `POST /api/ficha-capa` — recebe o texto do carimbo da capa das peças
  desenhadas e devolve a ficha da obra estruturada (JSON garantido).

## Como publicar na Vercel (uma vez)

1. Crie um repositório novo no GitHub (ex.: `Proxy_IA_PEX`) e envie esta pasta.
2. Em `vercel.com` → **Add New… → Project** → importe esse repositório.
3. Em **Settings → Environment Variables**, defina **três** variáveis:

   | Nome | Valor |
   |---|---|
   | `ANTHROPIC_API_KEY` | a **chave nova** da conta Anthropic (a `gabinete-pex`) |
   | `APP_PASSWORD` | uma senha de equipa à sua escolha (a app usará a mesma) |
   | `ANTHROPIC_MODEL` | **`claude-haiku-4-5`** (recomendado — barato e chega para esta tarefa) |

4. **Deploy.** No fim, a Vercel dá-lhe um endereço tipo
   `https://proxy-ia-pex.vercel.app`.

## Sobre o modelo e o custo

Estruturar o texto de um carimbo é uma tarefa **simples**. O
`claude-haiku-4-5` faz isto muito bem e é o mais barato (cerca de **US$0,001
por extração** — praticamente nada). Se não definir `ANTHROPIC_MODEL`, o
proxy usa `claude-opus-5` (mais caro, sem ganho nesta tarefa). Pode mudar o
modelo a qualquer momento na Vercel, sem tocar no código.

## Testar rapidamente (opcional)

```bash
curl -X POST https://SEU-ENDERECO.vercel.app/api/ficha-capa \
  -H "content-type: application/json" \
  -H "x-app-password: A_SUA_SENHA" \
  -d '{"texto_capa": "203-2025 CASA SP CONSTRUÇÃO DE MORADIA UNIFAMILIAR E MURO JOSÉ PEDRO N. DA MOTA E SOFIA C. FONSECA TRAVESSA DA LAGE- CEPÃES, FAFE JULHO 2026"}'
```

Deve devolver `{"ficha": { … }, "modelo": "claude-haiku-4-5"}`.
