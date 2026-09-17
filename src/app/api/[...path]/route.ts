import { NextResponse } from "next/server";

// Catch-all API route — returns a JSON 404 for any unmatched /api/* path.
// Without this, Next.js returns a full HTML 404 page which breaks JSON clients.
export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json(
    { error: "API endpoint not found" },
    { status: 404 },
  );
}

export function POST() {
  return NextResponse.json(
    { error: "API endpoint not found" },
    { status: 404 },
  );
}

export function PATCH() {
  return NextResponse.json(
    { error: "API endpoint not found" },
    { status: 404 },
  );
}

export function DELETE() {
  return NextResponse.json(
    { error: "API endpoint not found" },
    { status: 404 },
  );
}

export function PUT() {
  return NextResponse.json(
    { error: "API endpoint not found" },
    { status: 404 },
  );
}
