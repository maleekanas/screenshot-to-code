import { useCallback, useEffect, useState } from "react";
import toast from "react-hot-toast";
import {
  defaultDesignSystemsClient,
  DesignSystemsClient,
  DesignSystemPayload,
} from "../lib/design-systems";
import { DesignSystem } from "../types";

const INITIAL_LOAD_RETRY_DELAYS_MS = [500, 1000, 2000, 3000, 5000, 8000];

export function useDesignSystems(
  client: DesignSystemsClient = defaultDesignSystemsClient
) {
  const [designSystems, setDesignSystems] = useState<DesignSystem[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const loadDesignSystems = useCallback(
    async (retryDelaysMs: number[], isCancelled: () => boolean = () => false) => {
      setIsLoading(true);
      for (let attempt = 0; ; attempt++) {
        try {
          const result = await client.fetchDesignSystems();
          if (!isCancelled()) setDesignSystems(result);
          break;
        } catch (error) {
          if (isCancelled()) break;
          const delay = retryDelaysMs[attempt];
          if (delay === undefined) {
            console.error("Failed to load design systems", error);
            toast.error("Could not load design systems from the backend.");
            break;
          }
          await new Promise((resolve) => setTimeout(resolve, delay));
          if (isCancelled()) break;
        }
      }
      if (!isCancelled()) setIsLoading(false);
    },
    [client]
  );

  const refreshDesignSystems = useCallback(
    () => loadDesignSystems([]),
    [loadDesignSystems]
  );

  useEffect(() => {
    let cancelled = false;
    // The backend can take several seconds to boot after the dev server
    // (re)starts, so retry the initial load before reporting a failure.
    loadDesignSystems(INITIAL_LOAD_RETRY_DELAYS_MS, () => cancelled);
    return () => {
      cancelled = true;
    };
  }, [loadDesignSystems]);

  const create = useCallback(
    async (payload: DesignSystemPayload) => {
      const created = await client.createDesignSystem(payload);
      setDesignSystems((current) => [...current, created]);
      return created;
    },
    [client]
  );

  const update = useCallback(
    async (id: string, payload: Partial<DesignSystemPayload>) => {
      const updated = await client.updateDesignSystem(id, payload);
      setDesignSystems((current) =>
        current.map((designSystem) =>
          designSystem.id === updated.id ? updated : designSystem
        )
      );
      return updated;
    },
    [client]
  );

  const remove = useCallback(
    async (id: string) => {
      await client.deleteDesignSystem(id);
      setDesignSystems((current) =>
        current.filter((designSystem) => designSystem.id !== id)
      );
    },
    [client]
  );

  return {
    designSystems,
    isLoading,
    createDesignSystem: create,
    updateDesignSystem: update,
    deleteDesignSystem: remove,
    refreshDesignSystems,
  };
}
