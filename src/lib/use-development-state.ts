"use client";

import { useCallback, useState, useSyncExternalStore, type Dispatch, type SetStateAction } from "react";
import { createDevelopmentStore, type DevelopmentStore, type ReloadEvent } from "./development-state";

type DevelopmentWindow = Window & {
  __tf3DevelopmentState?: DevelopmentStore;
  navigation?: { addEventListener: (type: "navigate", listener: (event: ReloadEvent) => void) => void };
};

function documentStore() {
  if (process.env.NODE_ENV !== "development" || typeof window === "undefined") return null;
  const browser = window as DevelopmentWindow;
  if (!browser.__tf3DevelopmentState) {
    let storage: Storage | undefined;
    try { storage = browser.sessionStorage; } catch {}
    browser.__tf3DevelopmentState = createDevelopmentStore(storage, browser.navigation, browser.location.pathname);
  }
  return browser.__tf3DevelopmentState;
}

// Kept on window so editing this module or remounting a component retains state.
// A manual refresh creates a new document/store; production uses normal React state.
const store = documentStore();

export function useDevelopmentState<T>(key: string, initial: T): [T, Dispatch<SetStateAction<T>>] {
  const [local, setLocal] = useState(initial);
  const subscribe = useCallback((listener: () => void) => store?.subscribe(key, listener) ?? (() => {}), [key]);
  const snapshot = useCallback(() => store ? store.get(key, initial) : local, [key, initial, local]);
  const serverSnapshot = useCallback(() => initial, [initial]);
  const value = useSyncExternalStore(subscribe, snapshot, serverSnapshot);
  const setValue = useCallback<Dispatch<SetStateAction<T>>>(update => {
    if (store) store.set(key, initial, update);
    else setLocal(update);
  }, [key, initial]);
  return [value, setValue];
}
