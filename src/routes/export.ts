import { exportOwnerSnapshot, formatExportCsv, ownerOverview } from "../db.ts";
import { AUTH_ERROR, isMonthId, requireScope, setApiSecurityHeaders, type App } from "../http.ts";

export function registerExportRoutes(app: App): void {
  app.get("/api/export", async (c) => {
    const scope = await requireScope(c);
    if (!scope) return c.json({ error: AUTH_ERROR }, 401);
    const format = c.req.query("format") === "csv" ? "csv" : "json";
    const monthParam = c.req.query("monthId") || "";
    if (monthParam && !isMonthId(monthParam)) {
      return c.json({ error: "Mês inválido para exportação." }, 400);
    }
    const snapshot = await exportOwnerSnapshot(c.env.DB, scope.ownerId, monthParam || undefined);
    const stamp = monthParam || new Date().toISOString().slice(0, 10);
    setApiSecurityHeaders(c);
    if (format === "csv") {
      const csv = formatExportCsv(snapshot);
      c.header("Content-Type", "text/csv; charset=utf-8");
      c.header("Content-Disposition", `attachment; filename="gastos-${stamp}.csv"`);
      return c.body(csv, 200);
    }
    c.header("Content-Type", "application/json; charset=utf-8");
    c.header("Content-Disposition", `attachment; filename="gastos-${stamp}.json"`);
    return c.body(JSON.stringify(snapshot, null, 2), 200);
  });

  app.get("/api/overview", async (c) => {
    const scope = await requireScope(c);
    if (!scope) return c.json({ error: AUTH_ERROR }, 401);
    const year = c.req.query("year") || "";
    const q = (c.req.query("q") || "").slice(0, 80);
    const card = (c.req.query("card") || "").slice(0, 40);
    const track = c.req.query("track") || "";
    const overview = await ownerOverview(c.env.DB, scope.ownerId, { year, q, card, track });
    return c.json(overview);
  });
}
