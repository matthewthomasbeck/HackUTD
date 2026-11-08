import { useEffect, useState } from 'react';

export function LiveFeed({ url, label, thermal = false }: { url: string; label: string; thermal?: boolean }) {
  const [image, setImage] = useState<string>();
  const [status, setStatus] = useState('Connecting');
  const [scale, setScale] = useState('');
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
          setScale(`${range.replace(',', ' to ')}°C`);
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
    {image ? <img className={thermal ? 'thermal-image' : undefined} src={image} alt={`${label} live view`} />
      : <div className="no-frame">{status}</div>}
  </figure>;
}
