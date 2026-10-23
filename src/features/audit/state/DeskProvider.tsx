import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { deskClient } from "../api/desk-client";
import { getCachedGraph, putCachedGraph } from "../domain/cache";
import type { DeskHealth, GraphData, UnifiedGraph } from "../domain/contracts";

type DeskSession = {
  health: DeskHealth | null;
  graph: GraphData | null;
  unified: UnifiedGraph | null;
  loading: boolean;
  offline: boolean;
  error: string;
  refresh: () => Promise<void>;
};

const DeskContext = createContext<DeskSession | null>(null);

function errorMessage(error: unknown): string {
  if (typeof error === "object" && error && "message" in error) {
    return String((error as { message: unknown }).message);
  }
  return String(error);
}

export function DeskProvider({
  vaultKey,
  hostUp,
  children,
}: {
  vaultKey: string;
  hostUp: boolean;
  children: ReactNode;
}) {
  const [health, setHealth] = useState<DeskHealth | null>(null);
  const [graph, setGraph] = useState<GraphData | null>(null);
  const [unified, setUnified] = useState<UnifiedGraph | null>(null);
  const [loading, setLoading] = useState(true);
  const [offline, setOffline] = useState(false);
  const [error, setError] = useState("");
  const [generation, setGeneration] = useState(0);

  const refresh = useCallback(async () => {
    setGeneration((value) => value + 1);
  }, []);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    setOffline(false);
    setHealth(null);
    setUnified(null);

    const load = async () => {
      const cached = await getCachedGraph(vaultKey).catch(() => null);
      if (active && cached) setGraph(cached);
      if (!hostUp) {
        if (active) {
          setOffline(Boolean(cached));
          setLoading(false);
          setError(cached ? "" : "Host is stopped");
        }
        return;
      }
      try {
        const [nextHealth, nextGraph, nextUnified] = await Promise.all([
          deskClient.health(),
          deskClient.graph(),
          deskClient.unifiedGraph(),
        ]);
        if (!active) return;
        setHealth(nextHealth);
        setGraph((current) =>
          current?.generated_at === nextGraph.generated_at ? current : nextGraph,
        );
        setUnified((current) =>
          current?.generated_at === nextUnified.generated_at ? current : nextUnified,
        );
        setOffline(false);
        setError("");
        await putCachedGraph(vaultKey, nextGraph).catch(() => {});
      } catch (requestError) {
        if (!active) return;
        setOffline(Boolean(cached));
        setError(errorMessage(requestError));
      } finally {
        if (active) setLoading(false);
      }
    };

    void load();
    const timer = window.setInterval(load, 30_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [generation, hostUp, vaultKey]);

  const value = useMemo(
    () => ({ health, graph, unified, loading, offline, error, refresh }),
    [health, graph, unified, loading, offline, error, refresh],
  );
  return <DeskContext.Provider value={value}>{children}</DeskContext.Provider>;
}

export function useDeskSession(): DeskSession {
  const value = useContext(DeskContext);
  if (!value) throw new Error("useDeskSession must be used inside DeskProvider");
  return value;
}
