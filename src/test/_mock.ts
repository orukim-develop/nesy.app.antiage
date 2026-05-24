// Smoke test 공통 mock. ctx.data 를 in-memory Map 으로 시뮬레이션.
//
// 플랫폼 contract: data.list 는 value 포함 (N+1 차단).
// `listAllRows` 의 페이징 (startAfter) 도 지원.

import type { RunCtx } from '../types.ts';

export interface MockCtx extends RunCtx {
  _store: Map<string, any>;
}

export function makeCtx(initial: Record<string, any> = {}, args: any = {}, tool = 'test'): MockCtx {
  const store = new Map<string, any>(Object.entries(initial));
  return {
    _store: store,
    input: { tool, args },
    secrets: {},
    data: {
      get: async (k: string) => (store.has(k) ? store.get(k) : null),
      set: async (k: string, v: any) => { store.set(k, v); },
      delete: async (k: string) => store.delete(k),
      list: async (prefix?: string, _limit?: number, startAfter?: string) => {
        const out: { key: string; value: any; updated_at: string }[] = [];
        const keys = [...store.keys()].sort();
        for (const k of keys) {
          if (prefix && !k.startsWith(prefix)) continue;
          if (startAfter && k <= startAfter) continue;
          out.push({ key: k, value: store.get(k), updated_at: '' });
        }
        return out;
      },
    },
  };
}

// args 만 갈아끼고 같은 store 재사용.
export function withArgs<T extends MockCtx>(ctx: T, tool: string, args: any): T {
  ctx.input = { tool, args };
  return ctx;
}

export function assert(cond: any, msg: string): void {
  if (!cond) {
    console.error(`✗ FAIL: ${msg}`);
    process.exit(1);
  }
}

export function ok(msg: string): void {
  console.log(`  ✓ ${msg}`);
}
