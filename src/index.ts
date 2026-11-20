import { Hono } from "hono";
import { ensureReady } from "./db.ts";
import { logError, requestIdOf, setApiSecurityHeaders, type AppEnv } from "./http.ts";
import { registerHealthRoutes } from "./routes/health.ts";
import { registerAuthRoutes } from "./routes/auth.ts";
import { registerShareRoutes } from "./routes/shares.ts";
import { registerMonthRoutes } from "./routes/months.ts";
import { registerCardRoutes } from "./routes/cards.ts";
import { registerExpenseRoutes } from "./routes/expenses.ts";
import { registerExpensePaymentRoutes } from "./routes/expense-payments.ts";
import { registerExportRoutes } from "./routes/export.ts";
import { registerImportRoutes } from "./routes/import.ts";
import { registerAssetRoutes } from "./routes/assets.ts";

const app = new Hono<AppEnv>();

app.onError((error, c) => {
  const requestId = logError(c, "unhandled_error", error);
  setApiSecurityHeaders(c);
  if (c.req.path.startsWith("/api/")) {
    return c.json({ error: "Não foi possível concluir a solicitação. Tente novamente.", requestId }, 500);
  }
  return c.text("Não foi possível carregar a página.", 500);
});

registerHealthRoutes(app);

app.use("/api/*", async (c, next) => {
  requestIdOf(c);
  setApiSecurityHeaders(c);
  if (!["GET", "HEAD"].includes(c.req.method)) {
    const origin = c.req.header("origin");
    if (origin && origin !== new URL(c.req.url).origin) {
      return c.json({ error: "Origem recusada." }, 403);
    }
    const fetchSite = c.req.header("sec-fetch-site");
    if (!origin && fetchSite && fetchSite !== "same-origin" && fetchSite !== "none") {
      return c.json({ error: "Origem recusada." }, 403);
    }
    const length = Number(c.req.header("content-length") || 0);
    const maxBytes = c.req.path.startsWith("/api/import/") ? 512_000 : 20_000;
    if (length > maxBytes) return c.json({ error: "Pedido grande demais." }, 413);
  }
  try {
    await ensureReady(c.env.DB);
  } catch (error) {
    const requestId = logError(c, "database_init_failed", error);
    return c.json({ error: "Não foi possível abrir o banco de gastos.", requestId }, 500);
  }
  await next();
  setApiSecurityHeaders(c);
});

registerAuthRoutes(app);
registerShareRoutes(app);
registerMonthRoutes(app);
registerCardRoutes(app);
registerExpenseRoutes(app);
registerExpensePaymentRoutes(app);
registerExportRoutes(app);
registerImportRoutes(app);
registerAssetRoutes(app);

export default {
  fetch: (request, env, ctx) => app.fetch(request, env, ctx),
} satisfies ExportedHandler<Env>;
