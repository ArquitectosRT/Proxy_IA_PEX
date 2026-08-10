# Proxy de IA — PEX (ArquitectosRT)

Proxy pequeno e **separado** que dá à app de secretária o canal de IA do Nível 2
do PEX. A chave da API vive só aqui (no servidor da Vercel), nunca na app.
Protegido por uma senha de equipa.

**Sem dependências** — usa o `fetch` nativo do Node da Vercel.

## Funções

Todas exigem o cabeçalho `x-app-password` e recusam sem ele (falha fechada).

- `POST /api/ficha-capa` — texto do carimbo da capa → ficha da obra (JSON).
- `POST /api/pdm-resumo` — achados do PDM → rascunho do enquadramento.
- `POST /api/auditar` — os 4 documentos → auditoria de coerência (P1/P2).
- `POST /api/clausulas` — MQ + Memória → rascunho das cláusulas ET_XX_YY do CE.
- `POST /api/memoria-descritiva` — MQ → secções SOL_* da Memória.
- `POST /api/avaliar-tecnica` — 4 documentos + peças → relatório de avaliação.
- `POST /api/avaliar-desenhos` — folhas rasterizadas → juízo visual do grafismo.

Protecções (2026-08-10): senha comparada em tempo constante, tecto de tamanho
do corpo por função, e um travão de pedidos *best-effort* por instância. **O
tecto REAL de custo é o orçamento na consola da Anthropic — configure-o.**

## Como publicar na Vercel (uma vez)

1. Crie um repositório novo no GitHub (ex.: `Proxy_IA_PEX`) e envie esta pasta.
2. Em `vercel.com` → **Add New… → Project** → importe esse repositório.
3. Em **Settings → Environment Variables**, defina **três** variáveis:

   | Nome | Valor |
   |---|---|
   | `ANTHROPIC_API_KEY` | a **chave** da conta Anthropic (a `gabinete-pex`) |
   | `APP_PASSWORD` | uma senha de equipa à sua escolha (a app usará a mesma) |

   As variáveis de **modelo** são **opcionais**: se não as definir, cada função
   usa por omissão o modelo certo (nunca o Opus). Defina-as só para mudar:

   | Variável (opcional) | Função | Omissão |
   |---|---|---|
   | `ANTHROPIC_MODEL_FICHA` | ficha-capa | `claude-haiku-4-5` |
   | `ANTHROPIC_MODEL_PDM` | pdm-resumo | `claude-sonnet-5` |
   | `ANTHROPIC_MODEL_AUDITORIA` | auditar | `claude-sonnet-5` |
   | `ANTHROPIC_MODEL_CLAUSULAS` | clausulas | `claude-sonnet-5` |
   | `ANTHROPIC_MODEL_MEMORIA` | memoria-descritiva | `claude-sonnet-5` |
   | `ANTHROPIC_MODEL_AVALIACAO` | avaliar-tecnica | `claude-sonnet-5` |
   | `ANTHROPIC_MODEL_AVALIACAO_DESENHOS` | avaliar-desenhos | `claude-sonnet-5` |

   > A antiga variável única `ANTHROPIC_MODEL` **já não é usada** — pode
   > removê-la. Antes, se ficasse por definir, a ficha-capa corria no Opus
   > (caro); agora cai sempre no Haiku.

4. **Deploy.** No fim, a Vercel dá-lhe um endereço tipo
   `https://proxy-ia-pex.vercel.app`.

## Sobre o modelo e o custo

Estruturar o texto de um carimbo é uma tarefa **simples**: o `claude-haiku-4-5`
chega e é o mais barato (cerca de **US$0,001 por extração**). É agora o valor
por omissão da ficha-capa — deixou de cair no Opus.

**Não há tecto de custo no código** que impeça uma factura grande num acidente
(um lote enorme, um ciclo). O travão de pedidos *best-effort* ajuda, mas **a
única barreira sólida é o orçamento configurado na consola da Anthropic** —
defina um limite de gasto mensal na conta `gabinete-pex`.

## Testar rapidamente (opcional)

```bash
curl -X POST https://SEU-ENDERECO.vercel.app/api/ficha-capa \
  -H "content-type: application/json" \
  -H "x-app-password: A_SUA_SENHA" \
  -d '{"texto_capa": "203-2025 CASA SP CONSTRUÇÃO DE MORADIA UNIFAMILIAR E MURO JOSÉ PEDRO N. DA MOTA E SOFIA C. FONSECA TRAVESSA DA LAGE- CEPÃES, FAFE JULHO 2026"}'
```

Deve devolver `{"ficha": { … }, "modelo": "claude-haiku-4-5"}`.
