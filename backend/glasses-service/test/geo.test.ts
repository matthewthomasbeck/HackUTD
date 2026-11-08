import {describe,it,expect} from 'vitest';
import {bearingDeg,destinationPoint,distanceM,octant,octantWithHysteresis} from '../src/geo.js';
describe('geo',()=>{
 const a={lat:32.9857,lon:-96.7502};
 it('matches the contract geometry values',()=>{expect(distanceM(a,{lat:a.lat+0.001,lon:a.lon})).toBeCloseTo(111.2,0);expect(bearingDeg(a,{lat:a.lat+0.001,lon:a.lon})).toBeCloseTo(0,0);expect(distanceM(a,{lat:a.lat,lon:-96.7492})).toBeCloseTo(93.3,0);expect(bearingDeg(a,{lat:a.lat,lon:-96.7492})).toBeCloseTo(90,0);});
 it('uses the specified octant boundary',()=>{expect(octant(22.4)).toBe('N');expect(octant(22.6)).toBe('NE');expect(octantWithHysteresis(26,'N')).toBe('N');expect(octantWithHysteresis(28,'N')).toBe('NE');});
 it('round trips a destination point',()=>{const p=destinationPoint(a,68,950);expect(distanceM(a,p)).toBeCloseTo(950,1);expect(bearingDeg(a,p)).toBeCloseTo(68,1);});
});
