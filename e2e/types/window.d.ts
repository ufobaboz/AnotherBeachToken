export {};

interface AuthCallResult {
  status: number;
  latency_ms: number;
  body: unknown;
}

declare global {
  interface Window {
    Auth: {
      callEdgeFunction(name: string, body: unknown): Promise<AuthCallResult>;
      callAuthPing(opts: { stamp: boolean }): Promise<AuthCallResult>;
      client: {
        auth: {
          getSession(): Promise<{ data: { session: { user: { id: string } } | null } }>;
        };
        from(table: string): {
          select(cols: string): {
            eq(col: string, val: string): {
              maybeSingle(): Promise<{ data: Record<string, unknown> | null; error: unknown }>;
              single(): Promise<{ data: Record<string, unknown> | null; error: unknown }>;
            };
          };
        };
      };
    };
  }
}
