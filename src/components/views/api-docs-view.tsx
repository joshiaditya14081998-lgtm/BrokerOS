"use client";

import * as React from "react";
import {
  Code,
  Copy,
  Lock,
  ChevronDown,
  Search,
  Check,
  FileJson,
} from "lucide-react";
import { GlassCard, SectionHeader, EmptyState } from "@/components/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { useTranslation } from "@/hooks/use-translation";
import { API_ENDPOINTS, type ApiEndpoint, type HttpMethod } from "@/lib/api-docs";

// ── Method badge tone ─────────────────────────────────────────────────────────
// GET = emerald, POST = teal, PATCH = amber, DELETE = rose. Picked to mirror the
// rest of the app's emerald-first palette (no indigo / blue per design rules).
const METHOD_TONE: Record<HttpMethod, string> = {
  GET: "border-emerald-500/40 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  POST: "border-teal-500/40 bg-teal-500/15 text-teal-700 dark:text-teal-300",
  PATCH: "border-amber-500/40 bg-amber-500/15 text-amber-700 dark:text-amber-300",
  DELETE: "border-rose-500/40 bg-rose-500/15 text-rose-700 dark:text-rose-300",
};

// ── Filter chips (All / GET / POST / PATCH / DELETE) ─────────────────────────
const METHOD_FILTERS: ("All" | HttpMethod)[] = [
  "All",
  "GET",
  "POST",
  "PATCH",
  "DELETE",
];

export function ApiDocsView() {
  const { t } = useTranslation();
  const [methodFilter, setMethodFilter] = React.useState<"All" | HttpMethod>("All");
  const [search, setSearch] = React.useState("");

  // Filter endpoints by method + free-text (path / description).
  const filtered = React.useMemo(() => {
    const q = search.trim().toLowerCase();
    return API_ENDPOINTS.filter((e) => {
      if (methodFilter !== "All" && e.method !== methodFilter) return false;
      if (!q) return true;
      return (
        e.path.toLowerCase().includes(q) ||
        e.description.toLowerCase().includes(q)
      );
    });
  }, [methodFilter, search]);

  return (
    <div className="flex flex-col gap-6">
      <SectionHeader
        title={t("apiDocs.title")}
        description={t("apiDocs.subtitle")}
        action={
          <Badge
            variant="outline"
            className="hidden items-center gap-1.5 border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-emerald-700 dark:text-emerald-300 sm:inline-flex"
          >
            <Code className="size-3.5" />
            {API_ENDPOINTS.length} endpoints
          </Badge>
        }
      />

      {/* Filter bar — method chips + search input. Stacks on mobile. */}
      <GlassCard className="p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap items-center gap-1.5">
            {METHOD_FILTERS.map((m) => {
              const active = methodFilter === m;
              return (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMethodFilter(m)}
                  className={cn(
                    "rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors",
                    active
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border/60 bg-transparent text-muted-foreground hover:bg-muted/40 hover:text-foreground",
                  )}
                >
                  {m === "All" ? "All methods" : m}
                </button>
              );
            })}
          </div>
          <div className="relative w-full lg:w-80">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filter by path or description…"
              className="pl-9"
              aria-label="Filter endpoints by path or description"
            />
          </div>
        </div>

        {/* Count line — re-renders instantly when filters change. */}
        <p className="mt-3 text-xs text-muted-foreground">
          Showing{" "}
          <span className="font-semibold text-foreground">{filtered.length}</span>{" "}
          of{" "}
          <span className="font-semibold text-foreground">{API_ENDPOINTS.length}</span>{" "}
          endpoints
        </p>
      </GlassCard>

      {/* Endpoint list */}
      {filtered.length === 0 ? (
        <GlassCard className="p-6">
          <EmptyState
            title="No endpoints match your filter"
            hint="Try a different method or clear the search."
            icon={<FileJson className="size-5" />}
          />
        </GlassCard>
      ) : (
        <div className="flex flex-col gap-3">
          {filtered.map((endpoint, i) => (
            <EndpointCard key={`${endpoint.method}-${endpoint.path}-${i}`} endpoint={endpoint} />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Endpoint card ─────────────────────────────────────────────────────────────
// Collapsible: header always visible (method badge + path + auth lock + description).
// Body (params / body fields / response / curl example) is shown when expanded.
function EndpointCard({ endpoint }: { endpoint: ApiEndpoint }) {
  const [open, setOpen] = React.useState(false);

  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className="glass rounded-2xl"
    >
      <CollapsibleTrigger asChild>
        <button
          type="button"
          className="flex w-full items-start gap-3 p-4 text-left transition-colors hover:bg-muted/30 lg:items-center"
          aria-expanded={open}
        >
          <Badge
            className={cn(
              "shrink-0 font-mono text-[11px] font-bold tracking-wider",
              METHOD_TONE[endpoint.method],
            )}
          >
            {endpoint.method}
          </Badge>
          <code className="min-w-0 flex-1 break-all font-mono text-sm font-medium text-foreground">
            {endpoint.path}
          </code>
          {endpoint.auth && (
            <span
              className="inline-flex shrink-0 items-center gap-1 rounded-md border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-300"
              title="Requires authentication"
            >
              <Lock className="size-3" />
              Auth
            </span>
          )}
          <ChevronDown
            className={cn(
              "size-4 shrink-0 text-muted-foreground transition-transform",
              open && "rotate-180",
            )}
          />
        </button>
      </CollapsibleTrigger>

      {/* One-line description (always visible under the trigger row). */}
      <div className="-mt-1 px-4 pb-3">
        <p className="text-xs leading-relaxed text-muted-foreground">{endpoint.description}</p>
      </div>

      <CollapsibleContent>
        <div className="flex flex-col gap-4 border-t border-border/50 p-4">
          {/* Params table */}
          {endpoint.params && endpoint.params.length > 0 && (
            <FieldTable
              title="Query parameters"
              fields={endpoint.params}
            />
          )}

          {/* Body fields table */}
          {endpoint.body && endpoint.body.length > 0 && (
            <FieldTable
              title="Request body"
              fields={endpoint.body}
            />
          )}

          {/* Response description */}
          <div>
            <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Response
            </p>
            <p className="rounded-lg bg-muted/40 px-3 py-2 font-mono text-xs leading-relaxed text-foreground/90">
              {endpoint.response}
            </p>
          </div>

          {/* Curl example */}
          {endpoint.example && (
            <CurlExample example={endpoint.example} />
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

// ── Params / body fields table ────────────────────────────────────────────────
function FieldTable({
  title,
  fields,
}: {
  title: string;
  fields: NonNullable<ApiEndpoint["params"]>;
}) {
  return (
    <div>
      <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {title}
      </p>
      <div className="overflow-x-auto rounded-lg border border-border/50">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="h-8 w-32 text-[11px]">Name</TableHead>
              <TableHead className="h-8 w-28 text-[11px]">Type</TableHead>
              <TableHead className="h-8 w-20 text-[11px]">Required</TableHead>
              <TableHead className="h-8 text-[11px]">Description</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {fields.map((f) => (
              <TableRow key={f.name} className="hover:bg-transparent">
                <TableCell className="py-2 font-mono text-xs font-medium text-foreground">
                  {f.name}
                </TableCell>
                <TableCell className="py-2 font-mono text-xs text-muted-foreground">
                  {f.type}
                </TableCell>
                <TableCell className="py-2">
                  {f.required ? (
                    <Badge
                      variant="outline"
                      className="border-rose-500/30 bg-rose-500/10 px-1.5 py-0 text-[10px] font-semibold text-rose-700 dark:text-rose-300"
                    >
                      required
                    </Badge>
                  ) : (
                    <Badge
                      variant="outline"
                      className="border-border/60 bg-muted/40 px-1.5 py-0 text-[10px] font-medium text-muted-foreground"
                    >
                      optional
                    </Badge>
                  )}
                </TableCell>
                <TableCell className="py-2 text-xs leading-relaxed text-muted-foreground">
                  {f.description}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

// ── Curl example with copy button ────────────────────────────────────────────
function CurlExample({ example }: { example: string }) {
  const [copied, setCopied] = React.useState(false);

  const copy = React.useCallback(async () => {
    try {
      await navigator.clipboard.writeText(example);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard may be unavailable (e.g. insecure context). Non-blocking.
    }
  }, [example]);

  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Example
        </p>
        <Button
          variant="ghost"
          size="sm"
          onClick={copy}
          className="h-7 px-2 text-[11px] text-muted-foreground hover:text-foreground"
          aria-label="Copy curl example"
        >
          {copied ? (
            <>
              <Check className="size-3.5 text-emerald-600 dark:text-emerald-400" />
              Copied
            </>
          ) : (
            <>
              <Copy className="size-3.5" />
              Copy
            </>
          )}
        </Button>
      </div>
      <pre className="overflow-x-auto rounded-lg border border-border/50 bg-muted/40 px-3 py-2 font-mono text-[11px] leading-relaxed text-foreground/90">
        <code>{example}</code>
      </pre>
    </div>
  );
}
