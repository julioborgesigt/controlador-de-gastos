# Controlador de Gastos (Mobile-First + Cloudflare Workers)

Aplicação web voltada para **acesso pelo celular** para controle prático de gastos mensais, pronta para publicação no **Cloudflare Workers**.

## Funcionalidades Principais

- **Indicadores Diretos (Sem Gráficos):** Foco total no controle numérico rápido:
  - **Indicador de Gastos Fixos (Casa):** Soma todos os gastos fixos da casa e destaca quanto já foi lançado no cartão de crédito versus quanto sai via Pix/Boleto.
  - **Indicador do Cartão de Crédito (Fatura):** Soma as compras parceladas/à vista do cartão + gastos fixos marcados como cartão + gastos extras passados no cartão.
  - **Indicador de Gastos Extras:** Soma todos os gastos extras e separa quanto foi pago via **Pix** e quanto foi para o **Cartão**.
  - **Total Geral do Mês (Sem Duplicidade):** Garante que gastos fixos marcados como "No Cartão" não sejam somados duas vezes no total geral do mês.
- **Gastos Fixos com Marcação "No Cartão":**
  - Ao marcar um gasto fixo de casa como **"No Cartão"**, ele **não some** do indicador nem da lista de Gastos Fixos, exibe o selo **"Já contabilizado no Cartão de Crédito (mantido no indicador fixo)"** e passa a integrar automaticamente a fatura do cartão.
- **Gastos Extras Nomeados (Pix ou Cartão):**
  - Formulário rápido para adicionar qualquer gasto extra com nome personalizado, valor e seleção direta entre **Via Pix** ou **Foi p/ o Cartão** (com botão de 1 toque para alternar).
- **Importação e Exportação de Planilha (`.xlsx`, `.csv` ou Google Sheets):**
  - Importe sua planilha Excel/CSV ou link do Google Sheets pelo botão **Importar** no topo do app, ou exporte o fechamento do mês em `.xlsx`.

## Rodando Localmente

```bash
npm install
npm run dev
```

## Testes e Build

```bash
npm test
npm run build
```

## Publicando no Cloudflare

O projeto já está configurado com `wrangler.jsonc` (Cloudflare Workers + Static Assets):

```bash
npx wrangler login
npm run deploy
```

Ou conecte o repositório diretamente no painel da Cloudflare (**Workers & Pages > Create > Connect to Git**):
- **Build command:** `npm run build`
- **Deploy command:** `npx wrangler deploy`
