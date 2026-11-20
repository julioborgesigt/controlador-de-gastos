import { logError, requestIdOf, setApiSecurityHeaders, type App } from "../http.ts";

export function registerHealthRoutes(app: App): void {
  app.get("/api/health", async (c) => {
    const requestId = requestIdOf(c);
    setApiSecurityHeaders(c);
    try {
      const probe = await c.env.DB.prepare(
        "SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = 'expenses' LIMIT 1",
      ).first<{ ok: number }>();
      if (!probe || probe.ok !== 1) {
        logError(c, "healthcheck_schema_missing", new Error("Tabela expenses ausente no D1"));
        return c.json({ ok: false, db: "schema_missing", requestId }, 503);
      }
      return c.json({ ok: true, db: "ok", requestId }, 200);
    } catch (error) {
      logError(c, "healthcheck_failed", error);
      return c.json({ ok: false, db: "error", requestId }, 503);
    }
  });
}
