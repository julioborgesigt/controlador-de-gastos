# Controle de gastos

Um único app de celular para o orçamento de novembro de 2026 a outubro de 2027. Os números da planilha já vêm carregados. O que você lançar fica no banco da Cloudflare. A entrada é por CPF e senha; na criação da conta também pedimos o e-mail, guardado para códigos e avisos futuros.

- A casa continua no total de gastos fixos mesmo quando o gasto foi para o cartão. O app avisa que aquele valor já está na fatura e não soma de novo.
- Dá para nomear um gasto extra e dizer se foi Pix, débito, dinheiro ou cartão.
- Na aba Cartões dá para cadastrar um cartão e lançar **+ Gasto Cartão**. Esse gasto só entra no cartão escolhido, sem Pix, débito ou dinheiro. O detalhe de cada cartão deixa editar ou excluir cada item.
- Uma compra parcelada, no formato `3/10`, pode ser trazida para o mês seguinte. A parcela avança sozinha e para quando chega na última.
- O botão **Trazer lançamentos do mês anterior** repete os gastos fixos que você criou e as parcelas que ainda não acabaram. As linhas da planilha não são copiadas, porque cada mês já tem o seu valor.
- Ao lançar um gasto no cartão, informe quantas parcelas são, quantas já foram pagas e se o valor é da parcela ou da compra inteira. As parcelas que faltam entram neste mês e nos seguintes.
- Em **Receita** dá para definir uma receita base, replicar nos meses e ajustar um mês específico. Imposto de renda, décimo terceiro, férias e outros extras entram só no mês previsto.

## Publicar

O GitHub publica a branch `main` no Worker `controlador-de-gastos` quando estes segredos existem no repositório:

- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_API_TOKEN`

O token precisa da permissão **Edit Cloudflare Workers** e de **Account → D1 → Edit**. Na primeira publicação a Cloudflare cria o banco. O endereço fica `https://controlador-de-gastos.<seu-subdominio>.workers.dev`.

Para ver neste computador:

```bash
npm install
npm test
npm run dev
```
