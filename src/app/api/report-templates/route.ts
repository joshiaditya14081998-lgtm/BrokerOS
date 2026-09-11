import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentBroker } from "@/lib/auth";
import { z } from "zod";
import {
  isValidTemplateType,
  toReportTemplateDTO,
} from "@/lib/report-columns";

// GET /api/report-templates
//
// Returns all saved custom-report templates, sorted by createdAt desc
// (most-recently-created first — same convention as Saved Views, so the
// freshest user template appears at the top of the Report Builder's left
// panel).
//
// Response: { templates: ReportTemplateDTO[] }
export async function GET() {
  const broker = await getCurrentBroker();
  if (!broker) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const rows = await db.reportTemplate.findMany({
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json({ templates: rows.map(toReportTemplateDTO) });
}

const CreateSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  type: z.string().min(1).max(40),
  configJson: z.string().min(2),
});

// POST /api/report-templates
//
// Body: { name, description?, type, configJson }
//
// Creates a new ReportTemplate. `configJson` is stored verbatim — the caller
// (ReportBuilderView) is responsible for JSON.stringify-ing the editor
// state. We do a light JSON-validity check so we don't persist garbage.
//
// Response: { template: ReportTemplateDTO }
export async function POST(req: NextRequest) {
  const broker = await getCurrentBroker();
  if (!broker) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const parsed = CreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  try {
    JSON.parse(parsed.data.configJson);
  } catch {
    return NextResponse.json(
      { error: "configJson must be valid JSON" },
      { status: 400 },
    );
  }

  const type = isValidTemplateType(parsed.data.type) ? parsed.data.type : "custom";
  const name = parsed.data.name.trim();

  const tpl = await db.reportTemplate.create({
    data: {
      name,
      description: parsed.data.description?.trim() || null,
      type,
      configJson: parsed.data.configJson,
    },
  });

  await db.auditLog.create({
    data: {
      entityType: "ReportTemplate",
      entityId: tpl.id,
      action: "create",
      after: JSON.stringify(tpl),
      userName: "Broker",
      reason: `Created report template "${tpl.name}" (${tpl.type})`,
    },
  });

  return NextResponse.json({ template: toReportTemplateDTO(tpl) });
}
