"use client";

import { useEffect, useState, type FormEvent } from "react";
import data from "@/data/tf3-vehicles.json";
import type { Settings } from "@/lib/planner";
import { CONFIG_STORAGE_KEY, readSavedConfigs, type SavedConfig } from "@/lib/saved-configs";
import { useDevelopmentState } from "@/lib/use-development-state";

const cargoIds = data.cargos.map(c => c.id);

export default function SavedConfigs({ getSettings, onLoad }: {
  getSettings: () => Settings | null;
  onLoad: (settings: Settings) => void;
}) {
  const [configs, setConfigs] = useState<SavedConfig[]>([]);
  const [ready, setReady] = useState(false);
  const [selectedId, setSelectedId] = useDevelopmentState("configs.selectedId", "");
  const [name, setName] = useDevelopmentState("configs.name", "");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const selected = configs.find(c => c.id === selectedId);

  useEffect(() => {
    function read() {
      try {
        setConfigs(readSavedConfigs(localStorage.getItem(CONFIG_STORAGE_KEY), cargoIds));
        setError("");
      } catch { setError("Could not read saved configs from this browser."); }
      setReady(true);
    }
    // Read only after hydration; never write an empty initial list over saved data.
    queueMicrotask(read);
    function sync(event: StorageEvent) {
      if (event.key !== CONFIG_STORAGE_KEY && event.key !== null) return;
      read(); setSelectedId(""); setName(""); setMessage("");
    }
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, [setName, setSelectedId]);

  function persist(next: SavedConfig[], feedback: string) {
    try {
      localStorage.setItem(CONFIG_STORAGE_KEY, JSON.stringify({ version: 1, configs: next }));
      setConfigs(next); setMessage(feedback); setError("");
      return true;
    } catch {
      setMessage(""); setError("Could not save configs. Browser storage may be blocked or full.");
      return false;
    }
  }

  function save(update: boolean) {
    const trimmed = name.trim();
    setMessage("");
    if (!trimmed) { setError("Enter a configuration name."); return; }
    if (configs.some(c => c.name.toLowerCase() === trimmed.toLowerCase() && (!update || c.id !== selectedId))) {
      setError("That name is already saved. Choose another name or use Update."); return;
    }
    const settings = getSettings();
    if (!settings) return;
    const config: SavedConfig = { id: update && selected ? selected.id : crypto.randomUUID(), name: trimmed, settings: { ...settings, cargos: [...settings.cargos] } };
    const next = update ? configs.map(c => c.id === config.id ? config : c) : [...configs, config];
    if (persist(next, `${update ? "Updated" : "Saved"} “${trimmed}” locally.`)) { setSelectedId(config.id); setName(trimmed); }
  }

  function submit(event: FormEvent) { event.preventDefault(); save(false); }

  return <div className="saved-configs">
    <form className="config-controls" onSubmit={submit}>
      <label htmlFor="saved-config" title="Configurations are saved locally in this browser">Saved configs</label>
      <select id="saved-config" value={selected?.id ?? ""} disabled={!ready} title="Load a configuration and recalculate options" onChange={event => {
        const config = configs.find(c => c.id === event.target.value);
        setSelectedId(config?.id ?? ""); setName(config?.name ?? ""); setError("");
        setMessage(config ? `Loaded “${config.name}”.` : "");
        if (config) onLoad({ ...config.settings, cargos: [...config.settings.cargos] });
      }}>
        <option value="">{configs.length ? "Choose a config…" : "No saved configs"}</option>
        {configs.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
      </select>
      <input aria-label="Configuration name" placeholder="Configuration name" maxLength={100} value={name} onChange={event => { setName(event.target.value); setError(""); setMessage(""); }} />
      <button type="submit" disabled={!ready || !name.trim()} title="Save the current parameters under a new name">Save new</button>
      <button type="button" disabled={!ready || !selected || !name.trim()} onClick={() => save(true)} title="Replace the selected config with the current name and parameters">Update</button>
      <button type="button" disabled={!ready || !selected} onClick={() => {
        if (selected && persist(configs.filter(c => c.id !== selected.id), `Deleted “${selected.name}”.`)) { setSelectedId(""); setName(""); }
      }}>Delete</button>
    </form>
    {error && <p className="config-error" role="alert">{error}</p>}
    <p className="config-message" role="status">{message}</p>
  </div>;
}
