export function geo(fromLat: number, fromLon: number, toLat: number, toLon: number) {
  const rad = (n: number) => n * Math.PI / 180;
  const a = rad(fromLat), b = rad(toLat), delta = rad(toLon - fromLon);
  const h = Math.sin((b - a) / 2) ** 2 + Math.cos(a) * Math.cos(b) * Math.sin(delta / 2) ** 2;
  const distance_m = 6371000 * 2 * Math.asin(Math.sqrt(Math.min(1, Math.max(0, h))));
  const bearing_deg = (Math.atan2(Math.sin(delta) * Math.cos(b), Math.cos(a) * Math.sin(b) - Math.sin(a) * Math.cos(b) * Math.cos(delta)) * 180 / Math.PI + 360) % 360;
  return { distance_m, bearing_deg, compass: ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(bearing_deg / 45) % 8] };
}
