import { Hono } from "hono";
import { ensureReady } from "./db.ts";
import { setApiSecurityHeaders } from "./http.ts";
import { registerAuthRoutes } from "./routes/auth.ts";
import { registerShareRoutes } from "./routes/shares.ts";
import { registerMonthRoutes } from "./routes/months.ts";
import { registerCardRoutes } from "./routes/cards.ts";
import { registerExpenseRoutes } from "./routes/expenses.ts";
import { registerExpensePaymentRoutes } from "./routes/expense-payments.ts";
import { registerAssetRoutes } from "./routes/assets.ts";

const app = new Hono<{ Bindings: Env }>();

app.onError((error, c) => {
  console.error(JSON.stringify({
    message: "unhandled_error",
    path: c.req.path,
    method: c.req.method,
    error: error instanceof Error ? error.message : "unknown",
  }));
  setApiSecurityHeaders(c);
  if (c.req.path.startsWith("/api/")) {
    return c.json({ error: "Não foi possível concluir a solicitação. Tente novamente." }, 500);
  }
  return c.text("Não foi possível carregar a página.", 500);
});

app.use("/api/*", async (c, next) => {
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
    if (length > 20_000) return c.json({ error: "Pedido grande demais." }, 413);
  }
  try {
    await ensureReady(c.env.DB);
  } catch (error) {
    console.error(JSON.stringify({ message: "database_init_failed", error: error instanceof Error ? error.message : "unknown" }));
    return c.json({ error: "Não foi possível abrir o banco de gastos." }, 500);
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
registerAssetRoutes(app);

export default {
  fetch: (request, env, ctx) => app.fetch(request, env, ctx),
} satisfies ExportedHandler<Env>;
