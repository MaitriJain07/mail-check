import type { Db, RowDataPacket } from '../db/pool';
import { getCredits } from './credits';

export interface UsageSummary {
  credits: number;
  totals: { total: number; deliverable: number; undeliverable: number; risky: number; unknown: number };
  last7Days: { date: string; count: number }[];
  history: {
    items: {
      id: number;
      email: string;
      result: string;
      creditsUsed: number;
      apiKeyPrefix: string | null;
      createdAt: Date;
    }[];
    page: number;
    pageSize: number;
    total: number;
  };
}

const isoDay = (d: Date) => d.toISOString().slice(0, 10);

export async function getUsage(db: Db, userId: number, page: number, pageSize: number): Promise<UsageSummary> {
  const [credits, [byResult], [byDay], [items]] = await Promise.all([
    getCredits(db, userId),
    db.query<(RowDataPacket & { result: string; n: number })[]>(
      'SELECT result, COUNT(*) AS n FROM usage_events WHERE user_id = ? GROUP BY result',
      [userId],
    ),
    db.query<(RowDataPacket & { d: string; n: number })[]>(
      `SELECT DATE_FORMAT(created_at, '%Y-%m-%d') AS d, COUNT(*) AS n
         FROM usage_events
        WHERE user_id = ? AND created_at >= UTC_DATE() - INTERVAL 6 DAY
        GROUP BY d`,
      [userId],
    ),
    db.query<RowDataPacket[]>(
      `SELECT u.id, u.email, u.result, u.credits_used, u.created_at, k.prefix
         FROM usage_events u LEFT JOIN api_keys k ON k.id = u.api_key_id
        WHERE u.user_id = ?
        ORDER BY u.created_at DESC, u.id DESC
        LIMIT ? OFFSET ?`,
      [userId, pageSize, (page - 1) * pageSize],
    ),
  ]);

  const totals = { total: 0, deliverable: 0, undeliverable: 0, risky: 0, unknown: 0 };
  for (const r of byResult) {
    totals[r.result as keyof typeof totals] = Number(r.n);
    totals.total += Number(r.n);
  }

  const counts = new Map(byDay.map((r) => [r.d, Number(r.n)]));
  const last7Days: UsageSummary['last7Days'] = [];
  for (let i = 6; i >= 0; i--) {
    const date = isoDay(new Date(Date.now() - i * 86_400_000));
    last7Days.push({ date, count: counts.get(date) ?? 0 });
  }

  return {
    credits,
    totals,
    last7Days,
    history: {
      items: items.map((r) => ({
        id: r.id,
        email: r.email,
        result: r.result,
        creditsUsed: r.credits_used,
        apiKeyPrefix: r.prefix ?? null,
        createdAt: r.created_at,
      })),
      page,
      pageSize,
      total: totals.total,
    },
  };
}
