'use client';

import { useEffect, useRef, useState } from 'react';

const H = 220;

/**
 * Dependency-free SVG bar chart, drawn at the container's real pixel width so labels
 * stay legible on phones. Loaded lazily via next/dynamic from the dashboard.
 */
export default function UsageChart({ data }: { data: { date: string; count: number }[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(560);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => entry && setWidth(Math.max(260, Math.floor(entry.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const max = Math.max(1, ...data.map((d) => d.count));
  const niceMax = max <= 4 ? 4 : Math.ceil(max / 4) * 4;
  const pad = { top: 18, right: 8, bottom: 30, left: 34 };
  const innerW = width - pad.left - pad.right;
  const innerH = H - pad.top - pad.bottom;
  const slot = innerW / data.length;
  const barW = Math.min(48, slot * 0.62);
  const ticks = [0, 0.5, 1].map((t) => Math.round(niceMax * t));
  const compact = width < 420;
  const dayLabel = (iso: string) =>
    new Date(`${iso}T00:00:00Z`).toLocaleDateString(undefined, { weekday: compact ? 'narrow' : 'short', timeZone: 'UTC' });

  return (
    <div ref={ref} className="w-full">
      <svg
        width={width}
        height={H}
        role="img"
        aria-label={`Verifications per day for the last 7 days: ${data.map((d) => `${d.date} ${d.count}`).join(', ')}`}
        className="block max-w-full"
      >
        {ticks.map((t) => {
          const y = pad.top + innerH - (t / niceMax) * innerH;
          return (
            <g key={t}>
              <line x1={pad.left} x2={width - pad.right} y1={y} y2={y} stroke="#e2ded1" strokeDasharray={t === 0 ? undefined : '3 4'} />
              <text x={pad.left - 8} y={y + 4} textAnchor="end" fontSize="12" fill="#5b6269">{t}</text>
            </g>
          );
        })}
        {data.map((d, i) => {
          const h = (d.count / niceMax) * innerH;
          const x = pad.left + slot * i + (slot - barW) / 2;
          const isToday = i === data.length - 1;
          return (
            <g key={d.date}>
              <rect x={x} y={pad.top + innerH - h} width={barW} height={Math.max(h, d.count ? 2 : 0)} rx="4" fill={isToday ? '#0f6b4f' : '#7fb8a3'}>
                <title>{`${d.date}: ${d.count}`}</title>
              </rect>
              {d.count > 0 && (
                <text x={x + barW / 2} y={pad.top + innerH - h - 6} textAnchor="middle" fontSize="12" fontWeight="600" fill="#14171a">{d.count}</text>
              )}
              <text x={x + barW / 2} y={H - 9} textAnchor="middle" fontSize="12" fill="#5b6269">{dayLabel(d.date)}</text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
