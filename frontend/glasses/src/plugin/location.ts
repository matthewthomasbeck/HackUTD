// Phone position from the SDK to position messages, at most once a second (glasses.md 3.2, 5.1).
// The simulator may return no location at all; the plugin keeps going without it.
import { AppLocationAccuracy } from '@evenrealities/even_hub_sdk';
import type { EvenAppBridge } from '@evenrealities/even_hub_sdk';
import type { PluginMsg } from './protocol';

const MIN_GAP_MS = 1000;

export async function startLocation(sdk: EvenAppBridge, send: (msg: PluginMsg) => void): Promise<() => void> {
  let lastSent = 0;
  const unsubscribe = sdk.onAppLocationChanged((loc) => {
    if (!loc || typeof loc.latitude !== 'number' || typeof loc.longitude !== 'number') return;
    const t = Date.now();
    if (t - lastSent < MIN_GAP_MS) return;
    lastSent = t;
    const msg: PluginMsg = { type: 'position', lat: loc.latitude, lon: loc.longitude };
    if (typeof loc.accuracy === 'number') msg.accuracy_m = loc.accuracy;
    send(msg);
  });
  try {
    const ok = await sdk.startAppLocationUpdates({ accuracy: AppLocationAccuracy.High, intervalMs: 1000, distanceFilter: 1 });
    if (!ok) console.warn('[location] startAppLocationUpdates returned false; continuing without position');
  } catch (err) {
    console.warn('[location] startAppLocationUpdates threw; continuing without position', err);
  }
  return () => {
    unsubscribe();
    sdk.stopAppLocationUpdates().catch(() => {});
  };
}
