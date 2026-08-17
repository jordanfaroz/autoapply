"use client";

import { useMemo, useState } from "react";
import { ExternalLink, Search } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { SITES, isSiteId } from "@/lib/sites";
import type { ApplicationRow } from "@/lib/tracker";

function siteDisplayName(site: string): string {
  return isSiteId(site) ? SITES[site].displayName : site;
}

const DATE_FORMAT = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

export function TrackerTable({ applications }: { applications: ApplicationRow[] }) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<ApplicationRow | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return applications;
    return applications.filter(
      (a) =>
        a.title.toLowerCase().includes(q) ||
        a.company.toLowerCase().includes(q) ||
        siteDisplayName(a.site).toLowerCase().includes(q),
    );
  }, [applications, query]);

  return (
    <div className="space-y-3">
      <div className="relative max-w-sm">
        <Search className="absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search company, title, site…"
          className="pl-8"
        />
      </div>

      {applications.length === 0 ? (
        <p className="rounded-md border border-dashed px-3 py-8 text-center text-sm text-muted-foreground">
          No applications yet — approve a job in the Queue and start an apply run.
        </p>
      ) : filtered.length === 0 ? (
        <p className="rounded-md border border-dashed px-3 py-8 text-center text-sm text-muted-foreground">
          No application matches &ldquo;{query}&rdquo;.
        </p>
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Job</TableHead>
                <TableHead>Site</TableHead>
                <TableHead>Mode</TableHead>
                <TableHead className="text-right">Answers</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((a) => (
                <TableRow
                  key={a.id}
                  className="cursor-pointer"
                  onClick={() => setSelected(a)}
                >
                  <TableCell className="text-muted-foreground tabular-nums">
                    {DATE_FORMAT.format(a.appliedAt)}
                  </TableCell>
                  <TableCell>
                    <div className="font-medium">{a.title}</div>
                    <div className="text-xs text-muted-foreground">{a.company}</div>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {siteDisplayName(a.site)}
                  </TableCell>
                  <TableCell>
                    {a.dryRun ? (
                      <Badge variant="outline">dry run</Badge>
                    ) : (
                      <Badge variant="secondary">live</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">
                    {a.answersUsed.length > 0 ? a.answersUsed.length : "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <Dialog open={selected !== null} onOpenChange={(open) => !open && setSelected(null)}>
        <DialogContent className="sm:max-w-xl">
          {selected && (
            <>
              <DialogHeader>
                <DialogTitle>{selected.title}</DialogTitle>
                <DialogDescription>
                  {selected.company} · {siteDisplayName(selected.site)} ·{" "}
                  {DATE_FORMAT.format(selected.appliedAt)}
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-3">
                {selected.dryRun && (
                  <Badge variant="outline">dry run — nothing was submitted</Badge>
                )}

                {selected.answersUsed.length > 0 && (
                  <dl className="space-y-1.5 text-sm">
                    {selected.answersUsed.map((qa, i) => (
                      <div key={i}>
                        <dt className="text-xs text-muted-foreground">{qa.question}</dt>
                        <dd>{qa.answer}</dd>
                      </div>
                    ))}
                  </dl>
                )}

                {selected.blurb && (
                  <div>
                    <p className="text-xs text-muted-foreground">Blurb</p>
                    <p className="text-sm leading-relaxed whitespace-pre-wrap">
                      {selected.blurb}
                    </p>
                  </div>
                )}

                {selected.answersUsed.length === 0 && !selected.blurb && (
                  <p className="text-sm text-muted-foreground">
                    No screening questions on this application.
                  </p>
                )}
              </div>

              <DialogFooter>
                <a
                  href={selected.externalUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                >
                  Open listing <ExternalLink className="size-3" />
                </a>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
