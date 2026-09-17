import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentBroker } from "@/lib/auth";
import { z } from "zod";
import {
  isValidTemplateType,
  toReportTemplateDTO,
} from "@/lib/report-columns";

// DELETE /api/report-templates/[id]
//
// Removes a single ReportTemplate. The Report Builder view calls this from
// the template list's per-row delete affordance (after a confirm dialog on
// the client).
//
// Response: { ok: true }
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const broker = await getCurrentBroker();
  if (!broker) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const before = await db.reportTemplate.findFirst({ where: { id, brokerId: broker.id } });
  if (!before) {
    return NextResponse.json({ error: "Report template not found" }, { status: 404 });
  }
  await db.reportTemplate.delete({ where: { id } });
  await db.auditLog.create({
    data: {
      brokerId: broker.id,
      entityType: "ReportTemplate",
      entityId: id,
      action: "delete",
      before: JSON.stringify(before),
      userName: "Broker",
      reason: `Deleted report template "${before.name}" (${before.type})`,
    },
  });
  return NextResponse.json({ ok: true });
}

const PatchSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional(),
  type: z.string().min(1).max(40).optional(),
  configJson: z.string().min(2).optional(),
});

// PATCH /api/report-templates/[id]
//
// Body: { name?, description?, configJson?, type? }
//
// Updates one or more fields. `configJson` is re-validated as JSON before
// persistence. `type` (when present) is validated against the canonical
// set (summary | comparison | ledger | custom).
//
// Response: { template: ReportTemplateDTO }
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const broker = await getCurrentBroker();
  if (!broker) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const body = await req.json();
  const parsed = PatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const before = await db.reportTemplate.findFirst({ where: { id, brokerId: broker.id } });
  if (!before) {
    return NextResponse.json({ error: "Report template not found" }, { status: 404 });
  }

  const data: {
    name?: string;
    description?: string | null;
    type?: string;
    configJson?: string;
  } = {};

  if (parsed.data.name !== undefined) data.name = parsed.data.name.trim();
  if (parsed.data.description !== undefined) {
    data.description = parsed.data.description.trim() || null;
  }
  if (parsed.data.type !== undefined) {
    data.type = isValidTemplateType(parsed.data.type) ? parsed.data.type : "custom";
  }
  if (parsed.data.configJson !== undefined) {
    try {
      JSON.parse(parsed.data.configJson);
    } catch {
      return NextResponse.json(
        { error: "configJson must be valid JSON" },
        { status: 400 },
      );
    }
    data.configJson = parsed.data.configJson;
  }

  const tpl = await db.reportTemplate.update({ where: { id }, data });
  await db.auditLog.create({
    data: {
      brokerId: broker.id,
      entityType: "ReportTemplate",
      entityId: id,
      action: "update",
      before: JSON.stringify(before),
      after: JSON.stringify(tpl),
      userName: "Broker",
      reason: `Updated report template "${tpl.name}"`,
    },
  });
  return NextResponse.json({ template: toReportTemplateDTO(tpl) });
}
