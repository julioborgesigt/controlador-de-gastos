import { DatabaseSync, type SQLInputValue } from "node:sqlite";

type BoundStatement = D1PreparedStatement & {
  _sql: string;
  _params: SQLInputValue[];
};

function toSqlValue(value: unknown): SQLInputValue {
  if (value === undefined || value === null) return null;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (typeof value === "string" || typeof value === "number" || typeof value === "bigint") return value;
  if (value instanceof Uint8Array) return value;
  return String(value);
}

function defaultMeta(changes = 0, lastRowId = 0): D1Meta & Record<string, unknown> {
  return {
    duration: 0,
    size_after: 0,
    rows_read: 0,
    rows_written: changes,
    last_row_id: lastRowId,
    changed_db: changes > 0,
    changes,
  };
}

function isQueryStatement(sql: string): boolean {
  const head = sql.trimStart().slice(0, 12).toUpperCase();
  return head.startsWith("SELECT") || head.startsWith("PRAGMA") || head.startsWith("WITH");
}

function cloneRow(row: Record<string, unknown>): Record<string, unknown> {
  return Object.assign({}, row);
}

export function createMemoryD1(): D1Database {
  const sqlite = new DatabaseSync(":memory:");
  let inTx = false;

  const assertD1Params = (params: SQLInputValue[]) => {
    if (params.length > 100) {
      throw new Error(`D1_ERROR: too many SQL variables (got ${params.length}, max 100)`);
    }
  };

  const execOne = (sql: string, params: SQLInputValue[]) => {
    assertD1Params(params);
    const stmt = sqlite.prepare(sql);
    if (isQueryStatement(sql)) {
      const rows = (stmt.all(...params) as Record<string, unknown>[]).map(cloneRow);
      return {
        results: rows,
        success: true as const,
        meta: defaultMeta(0, 0),
      };
    }
    const result = stmt.run(...params);
    return {
      results: [] as Record<string, unknown>[],
      success: true as const,
      meta: defaultMeta(Number(result.changes ?? 0), Number(result.lastInsertRowid ?? 0)),
    };
  };

  const makeStatement = (sql: string, params: SQLInputValue[] = []): BoundStatement => {
    const prepared: BoundStatement = {
      _sql: sql,
      _params: params,
      bind(...values: unknown[]) {
        return makeStatement(sql, values.map(toSqlValue));
      },
      async first<T = Record<string, unknown>>(colName?: string): Promise<T | null> {
        assertD1Params(params);
        const stmt = sqlite.prepare(sql);
        const row = stmt.get(...params) as Record<string, unknown> | undefined;
        if (!row) return null;
        if (colName !== undefined) return (row[colName] ?? null) as T | null;
        return cloneRow(row) as T;
      },
      async run<T = Record<string, unknown>>(): Promise<D1Result<T>> {
        return execOne(sql, params) as unknown as D1Result<T>;
      },
      async all<T = Record<string, unknown>>(): Promise<D1Result<T>> {
        return execOne(sql, params) as unknown as D1Result<T>;
      },
      raw: (async (options?: { columnNames?: boolean }) => {
        assertD1Params(params);
        const stmt = sqlite.prepare(sql);
        const rows = stmt.all(...params) as Record<string, unknown>[];
        if (options?.columnNames) {
          const cols = rows.length ? Object.keys(rows[0]!) : [];
          return [cols, ...rows.map((row) => Object.values(row))];
        }
        return rows.map((row) => Object.values(row));
      }) as D1PreparedStatement["raw"],
    };
    return prepared;
  };

  const db = {
    prepare(query: string): D1PreparedStatement {
      return makeStatement(query);
    },
    async batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]> {
      if (!statements.length) return [];
      const started = !inTx;
      if (started) {
        sqlite.exec("BEGIN");
        inTx = true;
      }
      try {
        const results: D1Result<T>[] = [];
        for (const item of statements) {
          const bound = item as BoundStatement;
          results.push(execOne(bound._sql, bound._params) as unknown as D1Result<T>);
        }
        if (started) {
          sqlite.exec("COMMIT");
          inTx = false;
        }
        return results;
      } catch (error) {
        if (started && inTx) {
          sqlite.exec("ROLLBACK");
          inTx = false;
        }
        throw error;
      }
    },
    async exec(query: string): Promise<D1ExecResult> {
      sqlite.exec(query);
      return { count: 1, duration: 0 };
    },
    withSession(): D1DatabaseSession {
      throw new Error("withSession not implemented in memory D1");
    },
    dump(): Promise<ArrayBuffer> {
      throw new Error("dump not implemented in memory D1");
    },
  };

  return db as unknown as D1Database;
}

export function createMockAssets(): Fetcher {
  const fetch = async (input: RequestInfo | URL): Promise<Response> => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url);
    const body = url.pathname.endsWith(".js")
      ? "console.log('ok');"
      : url.pathname.endsWith(".css")
        ? "body{}"
        : "<!doctype html><html></html>";
    const type = url.pathname.endsWith(".js")
      ? "application/javascript"
      : url.pathname.endsWith(".css")
        ? "text/css"
        : "text/html";
    return new Response(body, {
      status: 200,
      headers: {
        "Content-Type": type,
        ETag: '"test-etag"',
      },
    });
  };
  return { fetch } as unknown as Fetcher;
}

export function createTestEnv(): Env {
  return {
    DB: createMemoryD1(),
    ASSETS: createMockAssets(),
  };
}
