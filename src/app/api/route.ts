import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({
    name: "Garment Broker OS API",
    version: "1.0.0",
    modules: [
      "dashboard", "clients", "suppliers", "visits", "bookings",
      "purchase-orders", "dispatches", "bills", "payments", "brokerages",
      "disputes", "notifications", "audit",
    ],
  });
}
