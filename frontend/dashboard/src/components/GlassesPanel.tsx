// Cayden's glasses as a small terminal-style window over the map, opened by Play demo: drag it by its title bar
// anywhere below the top bar to see what is behind it, resize it from the corner (it keeps the G2's 2:1 shape),
// fold it to its title bar, or reset it. Where it was is remembered in this browser only.
// It embeds the glasses fallback page (the same containers the G2 draws) as Cayden's primary display, which keeps his
// glasses session and its database connection up even when no G2 or Even simulator is attached.
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';

type Props = {
  url: string;
  hidden: boolean;
  status: string;
  onClose: () => void;
};

interface Placement { x: number; y: number; width: number; folded: boolean }

const STORAGE_KEY = 'underdog:glasses-window';
const TOP_BAR = 56; // the app bar's height: the window stays below it
const TITLE = 34; // title bar height, including its gap above the display
const PAD = 8;
const MIN_WIDTH = 304;
const MAX_WIDTH = 960;
const DEFAULT_WIDTH = 432;
const DOCK_GAP = 68; // the default spot sits just above the map dock

const heightFor = (width: number, folded: boolean) => (folded ? TITLE + PAD : TITLE + PAD * 2 + (width - PAD * 2) / 2);

function defaultPlacement(): Placement {
  const width = DEFAULT_WIDTH;
  return { x: (window.innerWidth - width) / 2, y: window.innerHeight - DOCK_GAP - heightFor(width, false), width, folded: false };
}

// Keeps the whole window on screen and under the top bar.
function clamp(place: Placement): Placement {
  const width = Math.min(Math.max(place.width, MIN_WIDTH), Math.min(MAX_WIDTH, window.innerWidth));
  const height = heightFor(width, place.folded);
  return {
    ...place,
    width,
    x: Math.min(Math.max(place.x, 0), Math.max(0, window.innerWidth - width)),
    y: Math.min(Math.max(place.y, TOP_BAR), Math.max(TOP_BAR, window.innerHeight - height)),
  };
}

function readPlacement(): Placement {
  try {
    const saved = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? 'null') as Partial<Placement> | null;
    if (saved && [saved.x, saved.y, saved.width].every((value) => typeof value === 'number' && Number.isFinite(value))) {
      return clamp({ x: saved.x!, y: saved.y!, width: saved.width!, folded: saved.folded === true });
    }
  } catch { /* storage blocked or bad JSON: use the default spot */ }
  return defaultPlacement();
}

function savePlacement(place: Placement): void {
  try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(place)); } catch { /* storage blocked: not remembered */ }
}

export function GlassesPanel({ url, hidden, status, onClose }: Props) {
  const [place, setPlace] = useState<Placement>(readPlacement);
  const [moving, setMoving] = useState(false);
  const placeRef = useRef(place);
  placeRef.current = place;

  useEffect(() => {
    const onResize = () => setPlace((current) => clamp(current));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // One pointer gesture: move the window (title bar) or resize it (corner), then remember the result.
  const gesture = (kind: 'move' | 'resize') => (event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0 || (kind === 'move' && (event.target as HTMLElement).closest('button'))) return;
    event.preventDefault();
    const handle = event.currentTarget;
    handle.setPointerCapture(event.pointerId);
    const start = { x: event.clientX, y: event.clientY, place: placeRef.current };
    setMoving(true);
    const onMove = (move: PointerEvent) => {
      const dx = move.clientX - start.x;
      const dy = move.clientY - start.y;
      setPlace(clamp(kind === 'move'
        ? { ...start.place, x: start.place.x + dx, y: start.place.y + dy }
        : { ...start.place, width: start.place.width + Math.max(dx, dy * 2) }));
    };
    const onEnd = () => {
      handle.removeEventListener('pointermove', onMove);
      handle.removeEventListener('pointerup', onEnd);
      handle.removeEventListener('pointercancel', onEnd);
      setMoving(false);
      savePlacement(placeRef.current);
    };
    handle.addEventListener('pointermove', onMove);
    handle.addEventListener('pointerup', onEnd);
    handle.addEventListener('pointercancel', onEnd);
  };

  const update = (next: Placement) => { const placed = clamp(next); setPlace(placed); savePlacement(placed); };

  return <section className={`glasses-float ${moving ? 'moving' : ''} ${place.folded ? 'folded' : ''}`} aria-label="Cayden’s glasses" hidden={hidden}
    style={{ left: place.x, top: place.y, width: place.width }}>
    <header onPointerDown={gesture('move')} onDoubleClick={() => update({ ...place, folded: !place.folded })}>
      <span className="lights">
        <button className="light close" aria-label="Close the glasses view" title="Close" onClick={onClose} />
        <button className="light fold" aria-label={place.folded ? 'Show the glasses display' : 'Fold to the title bar'} title={place.folded ? 'Show' : 'Fold'}
          onClick={() => update({ ...place, folded: !place.folded })} />
        <button className="light reset" aria-label="Reset position and size" title="Reset position and size" onClick={() => update(defaultPlacement())} />
      </span>
      <b>Cayden’s glasses</b>
      {status && <span className="glasses-status">{status}</span>}
    </header>
    {/* Folding only hides the display: unloading it would drop Cayden's glasses connection mid-demo. */}
    <div className="glasses-frame"><iframe title="Cayden’s glasses" src={url} /></div>
    <span className="resize-grip" aria-hidden="true" onPointerDown={gesture('resize')} />
  </section>;
}
