export const DEVELOPMENT_RELOAD_KEY = "tf3-planner.development-reload.v1";
type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;
export type ReloadEvent = Event & { navigationType: string; userInitiated: boolean; signal?: AbortSignal };
type NavigationLike = { addEventListener: (type: "navigate", listener: (event: ReloadEvent) => void) => void };

function sameShape(value: unknown, initial: unknown): boolean {
  if (Array.isArray(initial)) return Array.isArray(value) && value.every(item => !initial.length || sameShape(item, initial[0]));
  if (typeof initial === "object" && initial !== null) return typeof value === "object" && value !== null && !Array.isArray(value) &&
    Object.entries(initial).every(([key, entry]) => sameShape((value as Record<string, unknown>)[key], entry));
  return typeof value === typeof initial && (typeof value !== "number" || Number.isFinite(value));
}

/** One store per document. sessionStorage is used only for a script-driven reload. */
export function createDevelopmentStore(storage?: StorageLike, navigation?: NavigationLike, path = "/", now = Date.now) {
  let values: Record<string, unknown> = {};
  const listeners = new Map<string, Set<() => void>>();
  try {
    const raw = storage?.getItem(DEVELOPMENT_RELOAD_KEY);
    storage?.removeItem(DEVELOPMENT_RELOAD_KEY); // Consume once; never restore a stale snapshot later.
    if (raw) {
      const saved = JSON.parse(raw);
      if (saved?.version === 1 && saved.path === path && Number.isFinite(saved.at) && now() - saved.at >= 0 && now() - saved.at < 60_000 &&
        saved.values && typeof saved.values === "object" && !Array.isArray(saved.values)) values = saved.values;
    }
  } catch { /* Memory preservation still works when session storage is unavailable. */ }

  navigation?.addEventListener("navigate", event => {
    try {
      // Browser Refresh/F5/Ctrl+R is user initiated; Next's location.reload() is not.
      // Observe the Navigation API without intercepting or changing navigation.
      if (event.navigationType === "reload" && !event.userInitiated) {
        storage?.setItem(DEVELOPMENT_RELOAD_KEY, JSON.stringify({ version: 1, path, at: now(), values }));
        event.signal?.addEventListener("abort", () => { try { storage?.removeItem(DEVELOPMENT_RELOAD_KEY); } catch {} }, { once: true });
      } else storage?.removeItem(DEVELOPMENT_RELOAD_KEY);
    } catch { /* Do not prevent a reload when storage is blocked. */ }
  });

  function get<T>(key: string, initial: T): T {
    if (!Object.hasOwn(values, key) || !sameShape(values[key], initial)) values[key] = initial;
    return values[key] as T;
  }
  return {
    get,
    set<T>(key: string, initial: T, update: T | ((previous: T) => T)) {
      const previous = get(key, initial);
      const next = typeof update === "function" ? (update as (previous: T) => T)(previous) : update;
      if (Object.is(previous, next)) return;
      values[key] = next;
      listeners.get(key)?.forEach(listener => listener());
    },
    subscribe(key: string, listener: () => void) {
      if (!listeners.has(key)) listeners.set(key, new Set());
      listeners.get(key)!.add(listener);
      return () => { listeners.get(key)?.delete(listener); };
    },
  };
}

export type DevelopmentStore = ReturnType<typeof createDevelopmentStore>;
