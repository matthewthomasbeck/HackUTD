import type { DemoSiteConfig } from './config.ts';
import { offsetToLatLon, type LatLon } from './geo.ts';

export interface NamedCoordinate extends LatLon {
  label: string;
}

export function getNamedCoordinates(config: DemoSiteConfig): NamedCoordinate[] {
  const center = { lat: config.site.center_lat, lon: config.site.center_lon };
  const points: NamedCoordinate[] = [
    { label: 'site center', ...center },
    ...config.houses.map((house) => ({
      label: house.label,
      ...offsetToLatLon(center, house),
    })),
    {
      label: `demo anchor: ${config.demo_anchor.label}`,
      ...offsetToLatLon(center, config.demo_anchor),
    },
    {
      label: `robot: ${config.robots.sim.robot_id}`,
      ...offsetToLatLon(center, config.robots.sim.home),
    },
    ...config.rescuers.flatMap((rescuer) => rescuer.start
      ? [{ label: `rescuer: ${rescuer.name}`, ...offsetToLatLon(center, rescuer.start) }]
      : []),
    ...config.hidden_survivors.map((survivor) => ({
      label: `survivor: ${survivor.house}`,
      ...offsetToLatLon(center, survivor),
    })),
  ];

  return points;
}

export function formatNamedCoordinates(points: NamedCoordinate[]): string {
  return points.map(({ label, lat, lon }) => `${label}: ${lat.toFixed(7)}, ${lon.toFixed(7)}`).join('\n');
}
