import { useEffect, useState } from 'react';

type ThermalStats = { min_c: number; max_c: number; background_c: number; peak_col: number; peak_row: number; width: number; height: number };

export function LiveFeed({ url, label, thermal = false }: { url: string; label: string; thermal?: boolean }) {
  const [image, setImage] = useState<string>();
  const [status, setStatus] = useState('Connecting');
  const [scale, setScale] = useState('');
  const [stats, setStats] = useState<ThermalStats>();
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    let current: string | undefined;
    let etag: string | undefined;
    let retryMs = 250;
    let controller = new AbortController();
    const poll = async () => {
      if (document.hidden) { timer = setTimeout(poll, 500); return; }
      controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3000);
      try {
        const response = await fetch(url, { cache: 'no-store', signal: controller.signal,
          headers: etag ? { 'If-None-Match': etag } : undefined });
        if (response.status === 304) { retryMs = 250; return; }
        if (!response.ok) throw new Error('No fresh frame');
        const blob = await response.blob();
        if (!blob.type.startsWith('image/')) throw new Error('Invalid image');
        if (stopped) return;
        const previous = current;
        current = URL.createObjectURL(blob);
        setImage(current);
        setStatus('Live');
        retryMs = 250;
        etag = response.headers.get('ETag') ?? undefined;
        const range = response.headers.get('X-Thermal-Range-C');
        if (thermal && range && /^-?\d+(\.\d+)?,-?\d+(\.\d+)?$/.test(range)) {
          const mode = response.headers.get('X-Thermal-Range-Mode') === 'auto' ? 'Auto' : 'Fixed';
          setScale(`${mode} ${range.replace(',', ' to ')}°C`);
        }
        if (thermal) {
          try {
            const info = JSON.parse(response.headers.get('X-Thermal-Stats') ?? 'null') as ThermalStats | null;
            const keys: Array<keyof ThermalStats> = ['min_c', 'max_c', 'background_c', 'peak_col', 'peak_row', 'width', 'height'];
            setStats(info && keys.every((key) => Number.isFinite(info[key])) && info.width > 0 && info.height > 0
              && info.peak_col >= 0 && info.peak_col < info.width && info.peak_row >= 0 && info.peak_row < info.height ? info : undefined);
          } catch { setStats(undefined); }
        }
        if (previous) URL.revokeObjectURL(previous);
      } catch {
        if (!stopped) {
          setImage(undefined);
          setStatus('Feed unavailable');
          if (current) URL.revokeObjectURL(current);
          current = undefined;
          etag = undefined;
          retryMs = Math.min(4000, Math.max(500, retryMs * 2));
        }
      } finally {
        clearTimeout(timeout);
        if (!stopped) timer = setTimeout(poll, retryMs);
      }
    };
    void poll();
    return () => { stopped = true; clearTimeout(timer); controller.abort(); if (current) URL.revokeObjectURL(current); };
  }, [url, thermal]);
  return <figure><figcaption>{label} · {status}{thermal && scale ? ` · ${scale}` : ''}</figcaption>
    {image && thermal && stats ? <>
      <svg className="thermal-diagnostic" viewBox={`0 0 ${stats.width} ${stats.height}`} role="img" aria-label="Thermal view with hottest pixel marked">
        <image href={image} width={stats.width} height={stats.height} />
        <rect className="thermal-peak" x={stats.peak_col - 0.5} y={stats.peak_row - 0.5} width="2" height="2" />
      </svg>
      <span className="feed-note">Peak {stats.max_c.toFixed(1)}°C · background {stats.background_c.toFixed(1)}°C · min {stats.min_c.toFixed(1)}°C. Marker: hottest pixel, not a confirmed person.</span>
    </> : image ? <img className={thermal ? 'thermal-image' : undefined} src={image} alt={`${label} live view`} />
      : <div className="no-frame">{status}</div>}
  </figure>;
}
