// Remote driving from Camera View (docs/specs/robot.md section 18.1): which inputs drive which way, and the command
// they make. The robot's own convention: vx forward, vy to the left (mecanum strafe), wz counterclockwise (turn left).

export type DriveInput = 'forward' | 'back' | 'left' | 'right' | 'turn_left' | 'turn_right';
export interface DriveCommand { vx: number; vy: number; wz: number }

// The module's teleop_drive limits, the same as the robot's limits.max_lin_mps and max_ang_dps.
export const TELEOP_LIMITS = { linMps: 0.2, turnDps: 45 };
// How often a held input is re-sent. The robot stops 300 ms after the last command, so this keeps it moving.
export const DRIVE_SEND_MS = 100;

// The same keys as `robotctl teleop` on the Pi (w/s, a/d strafe, q/e turn), plus the arrow keys.
export const DRIVE_KEYS: Readonly<Record<string, DriveInput>> = {
  w: 'forward', arrowup: 'forward',
  s: 'back', arrowdown: 'back',
  a: 'left', d: 'right',
  q: 'turn_left', arrowleft: 'turn_left',
  e: 'turn_right', arrowright: 'turn_right',
};

export function driveInputForKey(key: string): DriveInput | undefined {
  return DRIVE_KEYS[key.toLowerCase()];
}

// Opposite inputs cancel, so holding forward and back stops the robot instead of picking one.
export function driveCommand(held: ReadonlySet<DriveInput>): DriveCommand {
  const axis = (plus: DriveInput, minus: DriveInput) => Number(held.has(plus)) - Number(held.has(minus));
  return {
    vx: axis('forward', 'back') * TELEOP_LIMITS.linMps,
    vy: axis('left', 'right') * TELEOP_LIMITS.linMps,
    wz: axis('turn_left', 'turn_right') * TELEOP_LIMITS.turnDps,
  };
}

export function isStill(command: DriveCommand): boolean {
  return command.vx === 0 && command.vy === 0 && command.wz === 0;
}

// "Forward 0.20 m/s · turning left 45°/s", or "Stopped".
export function describeCommand(command: DriveCommand): string {
  const parts: string[] = [];
  if (command.vx !== 0) parts.push(`${command.vx > 0 ? 'Forward' : 'Back'} ${Math.abs(command.vx).toFixed(2)} m/s`);
  if (command.vy !== 0) parts.push(`${parts.length ? 'sideways' : 'Sideways'} ${command.vy > 0 ? 'left' : 'right'} ${Math.abs(command.vy).toFixed(2)} m/s`);
  if (command.wz !== 0) parts.push(`${parts.length ? 'turning' : 'Turning'} ${command.wz > 0 ? 'left' : 'right'} ${Math.abs(command.wz).toFixed(0)}°/s`);
  return parts.length ? parts.join(' · ') : 'Stopped';
}
