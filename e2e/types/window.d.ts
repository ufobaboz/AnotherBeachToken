// Type augmentation for window.Auth used in E2E page.evaluate calls.
// Lives in e2e/types/, NOT in repo/public/, since it's only relevant
// to the Playwright runtime. The actual implementation is in
// repo/public/assets/auth.js (vanilla JS IIFE).

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
      // Aggiungere altri metodi via via che servono nei test E2E.
    };
  }
}
