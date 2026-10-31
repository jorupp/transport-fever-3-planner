"use client";

import Image from "next/image";
import { createPortal } from "react-dom";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import data from "@/data/tf3-vehicle-visuals.json";
import type { Option, Vehicle } from "@/lib/planner";

type Visual = { image: string; width: number; height: number; thumbnailOffsetY: number; color: string; representativePart: string | null };
const visuals: Record<string, Visual> = data.vehicles;

export function VehicleThumbnail({ vehicle }: { vehicle: Vehicle }) {
  const visual = visuals[vehicle.id];
  return visual ? <Image className="vehicle-thumbnail" src={visual.image} width={visual.width} height={visual.height} style={{ transform: `translateY(${(visual.thumbnailOffsetY ?? 0) * 100}%)` }} alt="" aria-hidden="true" unoptimized loading="lazy" /> : null;
}

export function VehicleSwatch({ vehicle }: { vehicle: Vehicle }) {
  const visual = visuals[vehicle.id];
  return visual ? <span className="vehicle-swatch" style={{ backgroundColor: visual.color }} aria-hidden="true" title={`${vehicle.name} · sampled base artwork color ${visual.color}`} /> : null;
}

export function VehicleArtwork({ option }: { option: Option }) {
  const vehicles = [{ vehicle: option.engine, label: option.engine.fixedFormation ? "Leading vehicle" : "Engine / vehicle" },
    ...(option.wagon ? [{ vehicle: option.wagon, label: "Wagon" }] : [])];
  return <div className="vehicle-artwork">
    {vehicles.map(({ vehicle, label }) => {
      const visual = visuals[vehicle.id];
      return visual ? <figure key={vehicle.id}>
        <figcaption><span>{label}</span><strong><VehicleSwatch vehicle={vehicle} />{vehicle.name}</strong></figcaption>
        <Image src={visual.image} width={visual.width} height={visual.height} alt={`${vehicle.name} — TF3 menu image`} unoptimized loading="eager" />
      </figure> : null;
    })}
    <p>Base menu artwork · company colors may differ.</p>
  </div>;
}

export function VehiclePreviewButton({ option, children, className, onClick, title }: {
  option: Option | null; children: ReactNode; className?: string; onClick: () => void; title?: string;
}) {
  const id = useId();
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearTimer = () => { if (timer.current) clearTimeout(timer.current); };
  function close() { clearTimer(); setPosition(null); }
  function show(element: HTMLButtonElement) {
    if (!option || !visuals[option.engine.id]) return;
    const rect = element.getBoundingClientRect();
    const height = option.wagon ? 310 : 180;
    setPosition({ left: Math.max(12, Math.min(rect.right + 8, window.innerWidth - 344)), top: Math.max(12, Math.min(rect.top, window.innerHeight - height - 12)) });
  }
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  useEffect(() => {
    if (!position) return;
    const dismiss = () => { if (timer.current) clearTimeout(timer.current); setPosition(null); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") dismiss(); };
    window.addEventListener("scroll", dismiss, true);
    window.addEventListener("resize", dismiss);
    window.addEventListener("keydown", escape);
    return () => { window.removeEventListener("scroll", dismiss, true); window.removeEventListener("resize", dismiss); window.removeEventListener("keydown", escape); };
  }, [position]);
  return <>
    <button type="button" className={className} disabled={!option} title={title} aria-describedby={position ? id : undefined}
      onMouseEnter={event => { clearTimer(); const element = event.currentTarget; timer.current = setTimeout(() => show(element), 160); }}
      onMouseLeave={() => { clearTimer(); timer.current = setTimeout(() => setPosition(null), 100); }}
      onFocus={event => { clearTimer(); show(event.currentTarget); }} onBlur={close}
      onClick={() => { close(); onClick(); }}>{children}</button>
    {position && option && createPortal(<div id={id} className="vehicle-artwork-tooltip" role="tooltip" style={position}
      onMouseEnter={clearTimer} onMouseLeave={close}><VehicleArtwork option={option} /></div>, document.body)}
  </>;
}
