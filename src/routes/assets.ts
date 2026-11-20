import { ASSET_CSP, PERMISSIONS_POLICY, isHttpsRequest, type App } from "../http.ts";

export function registerAssetRoutes(app: App): void {
  app.all("*", async (c) => {
    if (c.req.path.startsWith("/api/")) return c.json({ error: "Caminho não encontrado." }, 404);
    const asset = await c.env.ASSETS.fetch(assetRequest(c.req.raw));
    const headers = new Headers(asset.headers);
    headers.set("X-Content-Type-Options", "nosniff");
    headers.set("Referrer-Policy", "no-referrer");
    headers.set("X-Frame-Options", "DENY");
    headers.set("Permissions-Policy", PERMISSIONS_POLICY);
    if (isHttpsRequest(c.req.url)) {
      headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
    }
    headers.set("Content-Security-Policy", ASSET_CSP);
    if (isRevalidatableAsset(c.req.path)) {
      headers.set("Cache-Control", "public, max-age=0, must-revalidate");
      headers.delete("CDN-Cache-Control");
    } else {
      headers.set("Cache-Control", "no-store");
      headers.set("CDN-Cache-Control", "no-store");
    }
    return new Response(asset.body, { status: asset.status, statusText: asset.statusText, headers });
  });
}

function isRevalidatableAsset(pathname: string): boolean {
  return /\.(?:js|css|svg|png|ico|webp|woff2?)$/i.test(pathname);
}

function assetRequest(request: Request): Request {
  try {
    const url = new URL(request.url);
    if (!url.search) return request;
    url.search = "";
    return new Request(url, { method: request.method, headers: request.headers });
  } catch {
    return request;
  }
}
