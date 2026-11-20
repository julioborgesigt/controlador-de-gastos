# Controle de gastos

Aplicação web mobile-first (com suporte a desktop) para controle de orçamento mensal em Cloudflare Workers + D1. A entrada é feita com CPF e senha (com suporte a biometria/Passkey via WebAuthn no aparelho), modo claro/escuro e compartilhamento multi-tenant com permissão de visualização ou edição.

## Funcionalidades principais

- **Resumo mensal**: painel consolidado com pagamentos do mês (fatura + Pix previsto), lançamentos para próximas faturas, despesa prevista do mês atual e do próximo mês, além dos totais por categoria e atalho para quitar/reabrir o mês.
- **Cartões de crédito**: cadastro e edição de cartões (dia de fechamento e vencimento), lançamento de gastos no crédito (à vista ou parcelados, com sugestão automática da fatura), raio-X da composição da fatura, quitação no Pix ou parcelamento da fatura.
- **À vista**: registro de pagamentos no Pix vinculados a um Custo de vida ou criando um gasto Planejado/Imprevisto, com histórico detalhado do mês.
- **Custo de vida**: orçamento das contas recorrentes (fixas ou variáveis, no Pix ou crédito, inclusive com opção de entrar na fatura do mês seguinte), suporte a pagamentos parciais e finalização mensal individual.
- **Outros gastos**: acompanhamento de gastos **Planejados** e **Imprevistos** destacando os valores do mês em visualização e exibindo o total lançado de forma acessória.
- **Receita mensal**: definição de receita base (com replicação nos meses livres ou em todos os meses), ajuste individual por mês e receitas extras (IR, 13º, férias e outros).
- **Período gerenciado**: configurável por conta (até 48 meses) e ajustável a qualquer momento no menu do perfil.

## Desenvolvimento local

```bash
npm install
npm test
npm run check
npm run dev
```

## Publicação (Cloudflare Workers + D1)

A branch `main` é publicada automaticamente pelo workflow `.github/workflows/deploy.yml` quando estes segredos estão configurados no repositório:

- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_API_TOKEN` (com permissões **Edit Cloudflare Workers** e **Account → D1 → Edit**)

Pull Requests abertos contra `main` passam automaticamente pela verificação em `.github/workflows/ci.yml` (`npm test` e `npm run check`).
