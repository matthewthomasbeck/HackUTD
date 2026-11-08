import { DeviceHealth } from '../../spacetimedb-bindings/types.js';
import type { DemoSiteConfig } from './config.ts';
import { logInjection } from './inject.ts';
import type { SimPool } from './pool.ts';
import { RescuerRunner } from './rescuers.ts';
import { SimRobotRunner } from './simrobot.ts';

export class FailureController {
  constructor(
    private readonly config: DemoSiteConfig,
    private readonly pool: SimPool,
    private readonly robots: SimRobotRunner,
    private readonly rescuers: RescuerRunner,
  ) {}

  async inject(kind: string, args: string[]): Promise<void> {
    const sim = this.pool.get('sim');
    if (kind === 'robot-offline') {
      const robotId = args[0] ?? this.config.robots.sim.robot_id;
      if (!robotId.startsWith(this.config.robots.sim.robot_id)) throw new Error('The simulator can only stop a simulated robot');
      this.pool.get(robotId);
      await logInjection(sim, 'fail robot-offline', robotId);
      this.robots.stop(robotId);
      return;
    }
    if (kind === 'rescuer-silent' || kind === 'rescuer-drop') {
      const key = args[0];
      if (!key || key === 'cayden') throw new Error('Choose a simulated rescuer key, such as r2');
      const actor = this.pool.get(key);
      if (kind === 'rescuer-silent') {
        const assignments = Array.from(actor.connection.db.myAssignment.iter());
        if (!assignments.some((row) => row.status.tag === 'Active')) {
          throw new Error(`${key} needs an active assignment before rescuer-silent`);
        }
        await logInjection(sim, 'fail rescuer-silent', key);
        this.rescuers.pause(key);
      } else {
        await logInjection(sim, 'fail rescuer-drop', key);
        this.rescuers.drop(key);
      }
      return;
    }
    if (kind === 'device') {
      const device = args[0] ?? 'thermal';
      const status = args[1] ?? 'FAILED';
      const robotId = args[2] ?? this.config.robots.sim.robot_id;
      if (!['OK', 'DEGRADED', 'FAILED'].includes(status)) throw new Error('device status must be OK, DEGRADED, or FAILED');
      const robot = this.pool.get(robotId);
      const health = status === 'OK' ? DeviceHealth.Ok : status === 'DEGRADED' ? DeviceHealth.Degraded : DeviceHealth.Failed;
      await logInjection(sim, 'fail device', `${device} ${status} ${robotId}`);
      await robot.connection.reducers.robotReportDevice({ robotId, device, status: health, detail: status === 'FAILED' ? 'no frames for 3 s' : `simulated ${status.toLowerCase()} status`, observedAt: undefined });
      return;
    }
    throw new Error(`Unknown failure: ${kind}`);
  }

  async recover(): Promise<void> {
    await logInjection(this.pool.get('sim'), 'recover', 'all');
    await this.pool.connectConfiguredActors(this.config);
    this.robots.startAll();
    for (const actor of this.pool.list()) {
      if (actor.role === 'robot') await actor.connection.reducers.robotReportDevice({ robotId: actor.name, device: 'thermal', status: DeviceHealth.Ok, detail: 'recovered by simulator', observedAt: undefined });
      if (actor.role === 'rescuer') this.rescuers.resume(actor.key);
    }
  }
}
