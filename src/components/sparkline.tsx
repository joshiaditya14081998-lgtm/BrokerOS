"use client";

import * as React from "react";

/**
 * Tiny inline sparkline — no axes, no labels, just a trend line.
 * Used in cards/rows to show 6-month volume trends at a glance.
 */
export function Sparkline({
  data,
  width = 120,
  height = 32,
  className,
  stroke = "oklch(0.7 0.15 162)",
  fill = "oklch(0.7 0.15 162 / 0.12)",
}: {
  data: number[];
  width?: number;
  height?: number;
  className?: string;
  stroke?: string;
  fill?: string;
}) {
  const nonZero = data.some((d) => d > 0);
  if (!nonZero) {
    return (
      <svg width={width} height={height} className={className} aria-hidden="true">
        <line x1={0} y1={height - 1} x2={width} y2={height - 1} stroke="oklch(0.7 0.02 160 / 0.2)" strokeWidth={1} strokeDasharray="2 3" />
      </svg>
    );
  }
  const max = Math.max(...data, 1);
  const min = Math.min(...data, 0);
  const range = max - min || 1;
  const step = data.length > 1 ? width / (data.length - 1) : width;
  const pts = data.map((d, i) => {
    const x = i * step;
    const y = height - 2 - ((d - min) / range) * (height - 4);
    return [x, y] as const;
  });
  const linePath = pts.map((p, i) => `${i === 0 ? "M" : "L"}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ");
  const areaPath = `${linePath} L${width},${height} L0,${height} Z`;
  const lastPt = pts[pts.length - 1];
  return (
    <svg width={width} height={height} className={className} aria-hidden="true" preserveAspectRatio="none">
      <path d={areaPath} fill={fill} stroke="none" />
      <path d={linePath} fill="none" stroke={stroke} strokeWidth={1.75} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={lastPt[0]} cy={lastPt[1]} r={2.5} fill={stroke} />
    </svg>
  );
}
