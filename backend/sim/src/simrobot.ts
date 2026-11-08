import { RobotState } from '../../spacetimedb-bindings/types.js';
import type { DemoSiteConfig } from './config.ts';
import { offsetToLatLon } from './geo.ts';
import type { SimPool } from './pool.ts';

export class SimRobotRunner {
  private readonly timers = new Map<string, NodeJS.Timeout>();

  constructor(private readonly config: DemoSiteConfig, private readonly pool: SimPool) {}

  startDog(): void { this.startRobot(this.config.robots.sim.robot_id, this.config.robots.sim.home); }

  startFleet(): void {
    for (let index = 0; index < this.config.robots.fleet_size; index += 1) {
      const robotId = `${this.config.robots.sim.robot_id}-${index + 2}`;
      this.startRobot(robotId, { east_m: (index * 35) % 150 - 75, north_m: -80 - index * 10 });
    }
  }

  startAll(): void { this.startFleet(); this.startDog(); }

  stop(robotId: string): void {
    const timer = this.timers.get(robotId);
    if (timer) clearInterval(timer);
    this.timers.delete(robotId);
  }

  stopAll(): void { for (const robotId of this.timers.keys()) this.stop(robotId); }

  isRunning(robotId: string): boolean { return this.timers.has(robotId); }

  private startRobot(robotId: string, offset: { east_m: number; north_m: number }): void {
    if (this.timers.has(robotId)) return;
    const actor = this.pool.get(robotId);
    const point = offsetToLatLon({ lat: this.config.site.center_lat, lon: this.config.site.center_lon }, offset);
    const update = async () => {
      try {
        await actor.connection.reducers.robotHeartbeat({ robotId, state: RobotState.Ready, batteryPct: 95, observedAt: undefined });
        await actor.connection.reducers.robotReportPosition({ robotId, ...point, gpsFix: false, indoorOffsetM: 0, headingDeg: 0, observedAt: undefined });
      } catch (error) {
        console.error(`Sim robot ${robotId} update failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    };
    void update();
    this.timers.set(robotId, setInterval(() => void update(), this.config.timing.robot_heartbeat_ms));
  }
}
