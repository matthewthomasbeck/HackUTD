import type { AgentName, Priority } from '../types.js';
interface Entry { agent: AgentName; priority: Priority; deadline: number; order: number; resolve: () => void; reject: (e: Error) => void }
export class Budget {
  private sent: number[] = []; private queue: Entry[] = []; private sequence = 0;
  private timer?: ReturnType<typeof setTimeout>; private scheduled = false;
  constructor(public rpm = 20, private now: () => number = Date.now) {}
  acquire(agent: AgentName, priority: Priority, deadline: number): Promise<void> {
    return new Promise((resolve,reject) => {
      this.queue.push({agent,priority,deadline,resolve,reject,order:this.sequence++});
      if (!this.scheduled) { this.scheduled = true; queueMicrotask(() => { this.scheduled = false; this.drain(); }); }
    });
  }
  private drain() {
    if (this.timer) clearTimeout(this.timer);
    const now = this.now(); this.sent = this.sent.filter(t => now - t < 60000);
    const ranks = {critical:0,high:1,normal:2}, agents = {orchestrator:0,comms_agent:1,auditor:2};
    this.queue.sort((a,b) => ranks[a.priority]-ranks[b.priority] || agents[a.agent]-agents[b.agent] || a.order-b.order);
    this.queue = this.queue.filter(e => { if (e.deadline <= now) { e.reject(new Error('Budget deadline expired')); return false; } return true; });
    while (this.queue.length && this.sent.length < this.rpm) { const e = this.queue.shift()!; this.sent.push(now); e.resolve(); }
    if (this.queue.length) this.timer = setTimeout(() => this.drain(), Math.max(1, Math.min(this.sent[0] + 60000, ...this.queue.map(e => e.deadline)) - now));
  }
  close() { if(this.timer) clearTimeout(this.timer); for(const e of this.queue) e.reject(new Error('Budget closed')); this.queue=[]; }
}
