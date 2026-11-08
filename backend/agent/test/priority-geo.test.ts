import { describe, expect, it } from "vitest";
import { bearingDeg, compass, haversineM, offsetM } from "../src/geo.ts";
import { compareSurvivors, sortSurvivors, tierOf } from "../src/priority.ts";
import type { Survivor } from "../src/types.ts";

function s(id: number, o: Partial<Survivor>): Survivor {
  return {
    id,
    site_id: 1,
    cell_id: 0,
    first_detection_id: 0,
    lat: 0,
    lon: 0,
    location_note: "",
    house_label: null,
    breathing: "detected",
    breathing_rate_bpm: 20,
    breathing_confidence: 0.8,
    visibility_pct: null,
    critical_level: "delayed",
    critical_score: 50,
    score_confidence: 0.5,
    score_reasons: [],
    status: "unassigned",
    resolution: null,
    resolved_by: null,
    possible_duplicate_of: 0,
    breathing_display_url: null,
    escalated_at: null,
    created_at: 1000,
    updated_at: 1000,
    ...o,
  };
}

describe("priority.ts (agent.md 7.1, G3)", () => {
  it("not_detected with level delayed sorts in tier 0", () => {
    expect(tierOf(s(1, { breathing: "not_detected", critical_level: "delayed" }))).toBe(0);
    expect(tierOf(s(1, { breathing: "unknown", critical_level: "delayed" }))).toBe(0);
  });
  it("unknown level is tier 0", () => {
    expect(tierOf(s(1, { critical_level: "unknown" }))).toBe(0);
  });
  it("delayed is tier 1, minor tier 2 sorted with tier 1", () => {
    expect(tierOf(s(1, {}))).toBe(1);
    expect(tierOf(s(1, { critical_level: "minor" }))).toBe(2);
    const warns: string[] = [];
    const out = sortSurvivors([s(1, { critical_level: "minor", critical_score: 90 }), s(2, { critical_score: 10 })], (m) => warns.push(m));
    expect(out.map((x) => x.id)).toEqual([1, 2]);
    expect(warns.length).toBe(1);
  });
  it("ties on score, then age", () => {
    const a = s(1, { critical_score: 70, created_at: 2000 });
    const b = s(2, { critical_score: 80, created_at: 3000 });
    const c = s(3, { critical_score: 70, created_at: 1000 });
    expect([a, b, c].sort(compareSurvivors).map((x) => x.id)).toEqual([2, 3, 1]);
  });
  it("tier beats score", () => {
    const delayed = s(1, { critical_score: 99 });
    const nd = s(2, { breathing: "not_detected", critical_score: 1 });
    expect([delayed, nd].sort(compareSurvivors)[0].id).toBe(2);
  });
});

describe("geo.ts", () => {
  it("haversine with R = 6,371,000 m", () => {
    // One degree of latitude is about 111.19 km with this radius.
    expect(haversineM(0, 0, 1, 0)).toBeCloseTo(111_195, -1);
    const p = offsetM(32.9857, -96.7502, 0, 40);
    expect(haversineM(32.9857, -96.7502, p.lat, p.lon)).toBeCloseTo(40, 0);
  });
  it("bearing and the 8 compass words", () => {
    expect(Math.round(bearingDeg(0, 0, 1, 0))).toBe(0);
    expect(Math.round(bearingDeg(0, 0, 0, 1))).toBe(90);
    expect(compass(0)).toBe("N");
    expect(compass(44)).toBe("NE");
    expect(compass(90)).toBe("E");
    expect(compass(181)).toBe("S");
    expect(compass(270)).toBe("W");
    expect(compass(338)).toBe("N");
    expect(compass(-45)).toBe("NW");
  });
});
