import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

const sql = (name: string) => readFileSync(new URL(`../sql/${name}`, import.meta.url), 'utf8');

export interface ApiCall {
  developerId: string;
  at: Date;
  method: string;
  route: string;
  status: number;
  keyMode: 'test' | 'live';
  sdk?: string | null;
}

export interface Params {
  /** Seconds. A success counts as "second" only if it's at least this long after the first. */
  returnGap: number;
  /** Seconds. A nudge this soon before the second success makes it "prompted". */
  nudgeWindow: number;
  /** Seconds after the first success within which a second success counts. */
  horizon: number;
}

export const DEFAULT_PARAMS: Params = {
  returnGap: 24 * 3600,
  nudgeWindow: 72 * 3600,
  horizon: 30 * 86400,
};

export interface Journey {
  developerId: string;
  signedUp: number;
  firstSuccess: number | null;
  secondSuccess: number | null;
  prompted: boolean | null;
}

export interface Cliff {
  cohort: 'stalled' | 'never';
  route: string;
  status: number;
  keyMode: 'test' | 'live';
  developers: number;
}

/** Records what developers do, and asks questions about it. */
export class EventStore {
  readonly db: DatabaseSync;

  constructor(path = ':memory:') {
    this.db = new DatabaseSync(path);
    this.db.exec(sql('schema.sql'));
  }

  addDeveloper(id: string, signedUpAt: Date): void {
    this.db.prepare('INSERT OR IGNORE INTO developers VALUES (?, ?)').run(id, signedUpAt.toISOString());
  }

  recordCall(call: ApiCall): void {
    this.db
      .prepare('INSERT INTO api_calls VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(call.developerId, call.at.toISOString(), call.method, call.route, call.status, call.keyMode, call.sdk ?? null);
  }

  recordNudge(developerId: string, at: Date, kind: string): void {
    this.db.prepare('INSERT INTO nudges VALUES (?, ?, ?)').run(developerId, at.toISOString(), kind);
  }

  transaction(work: () => void): void {
    this.db.exec('BEGIN');
    try {
      work();
      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  journeys(params: Params = DEFAULT_PARAMS): Journey[] {
    const rows = this.db.prepare(sql('journeys.sql')).all({
      return_gap: params.returnGap,
      nudge_window: params.nudgeWindow,
      horizon: params.horizon,
    }) as Array<{ developer_id: string; signed_up: number; first_success: number | null; second_success: number | null; prompted: number | null }>;

    return rows.map((row) => ({
      developerId: row.developer_id,
      signedUp: row.signed_up,
      firstSuccess: row.first_success,
      secondSuccess: row.second_success,
      prompted: row.prompted === null ? null : row.prompted === 1,
    }));
  }

  /** Developers who made at least one API call, successful or not. */
  callers(): number {
    return (this.db.prepare('SELECT COUNT(DISTINCT developer_id) AS n FROM api_calls').get() as { n: number }).n;
  }

  cliffs(asOf: Date, params: Params = DEFAULT_PARAMS): Cliff[] {
    return this.db.prepare(sql('cliffs.sql')).all({
      return_gap: params.returnGap,
      horizon: params.horizon,
      as_of: Math.floor(asOf.getTime() / 1000),
    }) as unknown as Cliff[];
  }
}
