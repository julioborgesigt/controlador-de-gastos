# Controle de gastos

Aplicativo de celular para o orçamento familiar de novembro de 2026 a outubro de 2027. Os números iniciais vêm da planilha de projeção de faturas. Dá para lançar gastos extras, marcar Pix ou cartão e indicar quando um gasto fixo da casa já entrou na fatura.

O gasto marcado continua no total de gastos fixos. Ele deixa de ser somado outra vez no que falta pagar, porque já está dentro do cartão.

## Como usar

Na primeira abertura, crie um PIN de 4 a 8 dígitos. Ele protege a receita, as faturas e os lançamentos.

- **Resumo** mostra o que falta pagar, a receita e o saldo do mês.
- **Cartões** reúne a fatura prevista, os extras lançados no cartão e os gastos da casa que você marcou como já incluídos.
- **Casa** mantém o indicador de gastos fixos. O botão **Marcar na fatura** avisa que aquele valor já está no cartão.
- **Extras** serve para nomear um gasto que não estava na planilha e dizer se foi Pix ou cartão.

Para instalar na tela inicial do celular, abra o endereço publicado no navegador e use “Adicionar à tela de início”.

## Publicar no Cloudflare

O app é um Worker com [D1](https://developers.cloudflare.com/d1/) e arquivos estáticos. Na primeira visita ele cria as tabelas e carrega a planilha.

```bash
npm install
npx wrangler login
npm run db:create
```

Copie o `database_id` que o comando mostrar para `wrangler.jsonc`, no lugar de `00000000-0000-0000-0000-000000000000`. Depois:

```bash
npm run deploy
```

O endereço fica em `*.workers.dev`. Abra no celular e crie o PIN.

Para rodar neste computador:

```bash
npm run dev
```

Se esquecer o PIN, apague o segredo e as sessões e crie outro na próxima visita:

```bash
npx wrangler d1 execute controlador-de-gastos --remote --command "DELETE FROM settings WHERE key IN ('pin_hash','pin_salt','login_failures'); DELETE FROM sessions;"
```

O repositório está público e inclui os valores da planilha. Se esses números não devem ficar visíveis no GitHub, mude o repositório para privado.
