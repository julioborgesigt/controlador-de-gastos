export interface Env {
  ASSETS: Fetcher;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // Healthcheck da Worker no Cloudflare
    if (url.pathname === '/api/health') {
      return Response.json({
        status: 'ok',
        app: 'controlador-de-gastos',
        timestamp: new Date().toISOString()
      });
    }

    // Proxy seguro para importar planilhas públicas do Google Sheets sem bloqueio de CORS
    if (url.pathname === '/api/fetch-sheet' && request.method === 'GET') {
      const sheetUrl = url.searchParams.get('url');
      if (!sheetUrl || !sheetUrl.startsWith('https://docs.google.com/spreadsheets/')) {
        return Response.json(
          { error: 'URL inválida. Informe um link do Google Sheets.' },
          { status: 400 }
        );
      }

      try {
        const upstream = await fetch(sheetUrl, {
          headers: {
            'User-Agent': 'Cloudflare-Worker-Controlador-De-Gastos/1.0'
          }
        });
        if (!upstream.ok) {
          return Response.json(
            { error: 'Não foi possível acessar a planilha informada.' },
            { status: upstream.status }
          );
        }
        const body = await upstream.arrayBuffer();
        return new Response(body, {
          status: 200,
          headers: {
            'Content-Type': upstream.headers.get('Content-Type') ?? 'text/csv; charset=utf-8',
            'Cache-Control': 'no-store'
          }
        });
      } catch (err) {
        console.error(
          JSON.stringify({
            event: 'fetch_sheet_error',
            message: err instanceof Error ? err.message : String(err)
          })
        );
        return Response.json(
          { error: 'Erro ao buscar planilha remota.' },
          { status: 502 }
        );
      }
    }

    return env.ASSETS.fetch(request);
  }
};
