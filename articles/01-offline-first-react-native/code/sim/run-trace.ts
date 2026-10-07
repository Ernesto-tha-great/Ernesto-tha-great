import { OrderService } from '../server/core.js';
import { SimClock, seededRandom } from './clock.js';
import { SimNetwork } from './network.js';
import type { StrategyDefinition, UserAction } from './strategies.js';
import { durationMs, segmentAt, type Trace } from './trace.js';

export interface RunOptions {
  seed: number;
  /** Mean seconds between the user's actions. */
  meanActionGapSeconds?: number;
  /** Clean network after the trace, so slow-but-durable strategies can finish. */
  drainSeconds?: number;
}

export interface RunResult {
  actions: number;
  exactlyOnce: number;
  duplicated: number;
  lost: number;
  /** Seconds from the tap to the first time the server did the work. */
  deliveryLatencies: number[];
}

export async function runTrace(trace: Trace, definition: StrategyDefinition, options: RunOptions): Promise<RunResult> {
  const clock = new SimClock();
  const network = new SimNetwork(trace, clock, seededRandom(options.seed));
  const service = new OrderService({ honourIdempotencyKeys: definition.sendsIdempotencyKeys, now: clock.now });
  const strategy = definition.create({ clock, network, service, random: seededRandom(options.seed + 1) });

  const events = [...(trace.events ?? [])].sort((a, b) => a.at - b.at);
  // Decide up front which taps happen, so every strategy faces the same user.
  const actions = scheduleActions(trace, options).filter((action) => !inBackground(events, action.createdAt));
  const endMs = durationMs(trace) + (options.drainSeconds ?? 900) * 1_000;

  let nextAction = 0;
  let nextEvent = 0;
  let suspended = false;
  let wasDown = segmentAt(trace, 0).state === 'down';
  const created: UserAction[] = [];

  for (let tickAt = 0; tickAt < endMs; tickAt += 1_000) {
    clock.advanceTo(tickAt);

    while (nextEvent < events.length && events[nextEvent]!.at * 1_000 <= clock.now()) {
      const event = events[nextEvent++]!;
      if (event.type === 'suspend') suspended = true;
      if (event.type === 'kill') {
        suspended = true;
        await strategy.kill();
      }
      if (event.type === 'resume') {
        suspended = false;
        await strategy.resume();
      }
    }

    const isDown = network.state().state === 'down';
    if (wasDown && !isDown && !suspended) await strategy.connectivityHint();
    wasDown = isDown;

    while (!suspended && nextAction < actions.length && actions[nextAction]!.createdAt <= clock.now()) {
      const action = actions[nextAction++]!;
      created.push(action);
      await strategy.userAction(action);
    }

    if (!suspended) await strategy.tick();
  }

  return score(created, service);
}

/** True while the app is backgrounded or killed: the phone is in a pocket, nobody is tapping. */
function inBackground(events: NonNullable<Trace['events']>, atMs: number): boolean {
  let background = false;
  for (const event of events) {
    if (event.at * 1_000 > atMs) break;
    background = event.type !== 'resume';
  }
  return background;
}

function scheduleActions(trace: Trace, options: RunOptions): UserAction[] {
  const random = seededRandom(options.seed + 2);
  const meanGapMs = (options.meanActionGapSeconds ?? 20) * 1_000;
  const actions: UserAction[] = [];
  let at = 5_000;
  let n = 0;
  while (at < durationMs(trace)) {
    actions.push({ actionId: `action-${++n}`, createdAt: at, sku: `SKU-${1 + Math.floor(random() * 50)}`, qty: 1 + Math.floor(random() * 3) });
    at += Math.round(meanGapMs * (0.5 + random()));
  }
  return actions;
}

function score(created: UserAction[], service: OrderService): RunResult {
  const executions = new Map<string, number[]>();
  for (const execution of service.executions) {
    if (!execution.actionId) continue;
    const times = executions.get(execution.actionId) ?? [];
    times.push(execution.at);
    executions.set(execution.actionId, times);
  }

  const result: RunResult = { actions: created.length, exactlyOnce: 0, duplicated: 0, lost: 0, deliveryLatencies: [] };
  for (const action of created) {
    const times = executions.get(action.actionId) ?? [];
    if (times.length === 0) result.lost++;
    else {
      if (times.length === 1) result.exactlyOnce++;
      else result.duplicated++;
      result.deliveryLatencies.push((Math.min(...times) - action.createdAt) / 1_000);
    }
  }
  return result;
}
