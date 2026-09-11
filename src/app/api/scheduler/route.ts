import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// GET /api/scheduler — proxy to the scheduler mini-service on port 3004.
//
// The scheduler runs as an independent bun project (mini-services/scheduler-service)
// on port 3004. It exposes a health endpoint at GET / that returns:
//   { status, lastRun, nextRun, totalRuns, lastResult }
//
// This route is a server-to-server proxy so the browser can read the scheduler
// status without CORS issues. If the scheduler is down, we return
// { status: "offline" } with HTTP 200 (don't error) so the UI can render an
// "Offline" badge gracefully.
export async function GET() {
  const broker = await getCurrentBroker();
  if (!broker) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 3000);
    const res = await fetch("http://localhost:3004/", {
      signal: ctrl.signal,
      cache: "no-store",
    });
    clearTimeout(t);
    if (!res.ok) {
      return NextResponse.json({ status: "offline" });
    }
    const data = await res.json();
    return NextResponse.json(data);
  } catch {
    return NextResponse.json({ status: "offline" });
  }
}
