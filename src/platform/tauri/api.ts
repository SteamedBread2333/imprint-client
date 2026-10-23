import * as nativeApi from "../../api";
import type { DeskRequest, Snapshot } from "../../api";

export * from "../../api";

type E2eFixture = {
  snapshot?: Snapshot;
  deskResult?: unknown;
  deskError?: unknown;
};

declare global {
  interface Window {
    __IMPRINT_E2E__?: E2eFixture;
  }
}

function fixture(): E2eFixture | undefined {
  return import.meta.env.VITE_WDIO === "true" ? window.__IMPRINT_E2E__ : undefined;
}

export async function getSnapshot(): Promise<Snapshot> {
  return fixture()?.snapshot ?? nativeApi.getSnapshot();
}

export async function deskRequest<T = unknown>(request: DeskRequest): Promise<T> {
  const e2e = fixture();
  if (e2e?.deskError !== undefined) throw e2e.deskError;
  if (e2e?.deskResult !== undefined) return e2e.deskResult as T;
  return nativeApi.deskRequest<T>(request);
}
