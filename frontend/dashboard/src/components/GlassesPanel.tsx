// Cayden's glasses, floating over the map while Play demo runs, so the board and the heads-up are seen side by side.
// It embeds the glasses fallback page (the same containers the G2 draws) as Cayden's primary display, which keeps his
// glasses session and its database connection up even when no G2 or Even simulator is attached.
type Props = {
  url: string;
  hidden: boolean;
  status: string;
  onClose: () => void;
};

export function GlassesPanel({ url, hidden, status, onClose }: Props) {
  return <section className="glasses-float" aria-label="Cayden’s glasses" hidden={hidden}>
    <header>
      <b>Cayden’s glasses</b>
      {status && <span className="glasses-status">{status}</span>}
      <button className="close" aria-label="Close the glasses view" onClick={onClose}>×</button>
    </header>
    <div className="glasses-frame"><iframe title="Cayden’s glasses" src={url} /></div>
  </section>;
}
