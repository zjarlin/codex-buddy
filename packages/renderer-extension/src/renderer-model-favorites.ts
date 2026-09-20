const STORAGE_KEY = "codexhost.model-favorites.v1";
export const MODEL_FAVORITES_CHANGED = "codexhost:model-favorites-changed";

export interface ModelFavoritesStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function rendererStorage(): ModelFavoritesStorage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

// Each Harness owns its opaque model refs; never infer identity from display labels.
export function readModelFavorites(
  harnessId: string,
  storage: ModelFavoritesStorage | null = rendererStorage(),
): Set<string> {
  try {
    const value: unknown = JSON.parse(storage?.getItem(`${STORAGE_KEY}:${harnessId}`) ?? "[]");
    return new Set(
      Array.isArray(value)
        ? value.filter((id): id is string => typeof id === "string" && id.length > 0)
        : [],
    );
  } catch {
    return new Set();
  }
}

export function writeModelFavorites(
  harnessId: string,
  favorites: ReadonlySet<string>,
  storage: ModelFavoritesStorage | null = rendererStorage(),
): void {
  try {
    storage?.setItem(`${STORAGE_KEY}:${harnessId}`, JSON.stringify([...favorites]));
    if (typeof window !== "undefined") window.dispatchEvent(new Event(MODEL_FAVORITES_CHANGED));
  } catch {
    // A storage failure must not interrupt model selection.
  }
}
