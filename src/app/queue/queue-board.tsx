"use client";

import { useState, useTransition } from "react";
import { ExternalLink, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { approveJobAction, rejectJobAction } from "./actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { ApplicationSummary, JobRow } from "@/lib/jobs";
import { SITES, isSiteId } from "@/lib/sites";

export type QueueJobRow = JobRow & { application?: ApplicationSummary };

/**
 * Mirrors the transition rules enforced server-side in src/lib/jobs.ts, purely so
 * buttons the server would refuse are not shown in the first place. The server call
 * is still the actual guard — a stale copy here only costs a toast, never a bad write.
 */
function canApprove(status: JobRow["status"]): boolean {
  return (
    status === "queued" ||
    status === "archived_low_score" ||
    status === "scraped" ||
    status === "rejected" ||
    status === "failed_needs_review"
  );
}
function canReject(status: JobRow["status"]): boolean {
  return (
    status === "queued" ||
    status === "archived_low_score" ||
    status === "scraped" ||
    status === "approved" ||
    status === "failed_needs_review"
  );
}

function scoreTone(score: number | null): string {
  if (score === null) return "text-muted-foreground";
  if (score >= 85) return "text-emerald-600 dark:text-emerald-400";
  if (score >= 70) return "text-sky-600 dark:text-sky-400";
  if (score >= 50) return "text-amber-600 dark:text-amber-400";
  return "text-muted-foreground";
}

export type QueueSection = {
  key: string;
  title: string;
  hint: string;
  jobs: QueueJobRow[];
  /** Section is hidden entirely when its job list is empty and this is unset. */
  emptyText?: string;
  muted?: boolean;
};

export function QueueBoard({ sections }: { sections: QueueSection[] }) {
  const [selected, setSelected] = useState<QueueJobRow | null>(null);
  const [pendingId, setPendingId] = useState<number | null>(null);
  const [, startTransition] = useTransition();

  function act(job: QueueJobRow, kind: "approve" | "reject") {
    setPendingId(job.id);
    startTransition(async () => {
      const result =
        kind === "approve" ? await approveJobAction(job.id) : await rejectJobAction(job.id);
      setPendingId(null);

      if (result.ok) {
        toast.success(result.message);
        setSelected((current) => (current?.id === job.id ? null : current));
      } else {
        toast.error(result.message);
      }
    });
  }

  return (
    <div className="space-y-6">
      {sections.map((section) => (
        <QueueSectionCard
          key={section.key}
          section={section}
          pendingId={pendingId}
          onView={setSelected}
          onAct={act}
        />
      ))}

      <JobDetailDialog
        job={selected}
        pending={selected !== null && pendingId === selected.id}
        onOpenChange={(open) => !open && setSelected(null)}
        onAct={act}
      />
    </div>
  );
}

function QueueSectionCard({
  section,
  pendingId,
  onView,
  onAct,
}: {
  section: QueueSection;
  pendingId: number | null;
  onView: (job: QueueJobRow) => void;
  onAct: (job: QueueJobRow, kind: "approve" | "reject") => void;
}) {
  if (section.jobs.length === 0 && !section.emptyText) return null;

  return (
    <Card className={section.muted ? "opacity-75" : undefined}>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-baseline gap-2 text-sm">
          {section.title}
          <span className="font-mono text-xs font-normal text-muted-foreground">
            {section.jobs.length}
          </span>
        </CardTitle>
        <p className="text-xs text-muted-foreground">{section.hint}</p>
      </CardHeader>
      <CardContent className="space-y-2">
        {section.jobs.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted-foreground">{section.emptyText}</p>
        ) : (
          section.jobs.map((job) => (
            <JobRowView
              key={job.id}
              job={job}
              pending={pendingId === job.id}
              onView={() => onView(job)}
              onApprove={canApprove(job.status) ? () => onAct(job, "approve") : undefined}
              onReject={canReject(job.status) ? () => onAct(job, "reject") : undefined}
            />
          ))
        )}
      </CardContent>
    </Card>
  );
}

function JobRowView({
  job,
  pending,
  onView,
  onApprove,
  onReject,
}: {
  job: QueueJobRow;
  pending: boolean;
  onView: () => void;
  onApprove?: () => void;
  onReject?: () => void;
}) {
  const siteName = isSiteId(job.site) ? SITES[job.site].displayName : job.site;

  return (
    <div
      data-job-id={job.id}
      className={`rounded-md border px-3 py-2.5 ${pending ? "opacity-50" : ""}`}
    >
      <div className="flex items-start gap-3">
        <span
          className={`w-10 shrink-0 font-mono text-lg leading-6 font-semibold ${scoreTone(job.matchScore)}`}
        >
          {job.matchScore ?? "—"}
        </span>

        <button type="button" onClick={onView} className="min-w-0 flex-1 space-y-1 text-left">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <span className="text-sm font-medium underline-offset-4 hover:underline">
              {job.title}
            </span>
            <span className="text-sm text-muted-foreground">{job.company}</span>
          </div>

          <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
            <span>{siteName}</span>
            {job.location && <span>{job.location}</span>}
            {job.salaryText && <span>{job.salaryText}</span>}
            <span>
              {job.jdText ? `${job.jdText.length.toLocaleString()} char JD` : "no JD captured"}
            </span>
          </div>

          {job.status === "failed_needs_review" && job.failureReason ? (
            <p className="line-clamp-2 text-xs leading-relaxed text-destructive">
              {job.failureReason}
            </p>
          ) : (
            job.matchReasoning && (
              <p className="line-clamp-2 text-xs leading-relaxed text-muted-foreground">
                {job.matchReasoning}
              </p>
            )
          )}
        </button>

        <div className="flex shrink-0 gap-1.5">
          {onReject && (
            <Button
              size="sm"
              variant="outline"
              disabled={pending}
              onClick={onReject}
              aria-label={`Reject ${job.title}`}
            >
              Reject
            </Button>
          )}
          {onApprove && (
            <Button
              size="sm"
              disabled={pending}
              onClick={onApprove}
              aria-label={`Approve ${job.title}`}
            >
              Approve
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function JobDetailDialog({
  job,
  pending,
  onOpenChange,
  onAct,
}: {
  job: QueueJobRow | null;
  pending: boolean;
  onOpenChange: (open: boolean) => void;
  onAct: (job: QueueJobRow, kind: "approve" | "reject") => void;
}) {
  return (
    <Dialog open={job !== null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        {job && (
          <>
            <DialogHeader>
              <DialogTitle>{job.title}</DialogTitle>
              <DialogDescription>
                {job.company}
                {job.location ? ` · ${job.location}` : ""}
                {" · "}
                {isSiteId(job.site) ? SITES[job.site].displayName : job.site}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <Badge variant="outline" className="font-mono">
                  <span className={scoreTone(job.matchScore)}>score {job.matchScore ?? "—"}</span>
                </Badge>
                {job.salaryText && <Badge variant="outline">{job.salaryText}</Badge>}
                <a
                  href={job.externalUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                >
                  Open listing <ExternalLink className="size-3" />
                </a>
              </div>

              {job.status === "failed_needs_review" && job.failureReason && (
                <div className="space-y-2 rounded-md border border-destructive/40 bg-destructive/5 p-3">
                  <p className="text-xs font-medium text-destructive">Why this needs review</p>
                  <p className="text-sm leading-relaxed">{job.failureReason}</p>
                  {job.failureScreenshotPath && (
                    // A local screenshot file, not a remote image next/image optimizes.
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={`/api/screenshots/${encodeURIComponent(
                        job.failureScreenshotPath.split(/[\\/]/).pop() ?? "",
                      )}`}
                      alt="Screenshot at the point of failure"
                      className="max-h-96 w-full rounded border object-contain object-top"
                    />
                  )}
                </div>
              )}

              {job.application && (
                <div className="space-y-2 rounded-md border p-3">
                  <div className="flex items-center gap-2">
                    <p className="text-xs font-medium text-muted-foreground">
                      What was submitted
                    </p>
                    {job.application.dryRun && <Badge variant="outline">dry run</Badge>}
                  </div>
                  {job.application.answersUsed.length > 0 && (
                    <dl className="space-y-1.5 text-sm">
                      {job.application.answersUsed.map((qa, i) => (
                        <div key={i}>
                          <dt className="text-xs text-muted-foreground">{qa.question}</dt>
                          <dd>{qa.answer}</dd>
                        </div>
                      ))}
                    </dl>
                  )}
                  {job.application.blurb && (
                    <div>
                      <p className="text-xs text-muted-foreground">Blurb</p>
                      <p className="text-sm leading-relaxed whitespace-pre-wrap">
                        {job.application.blurb}
                      </p>
                    </div>
                  )}
                  {job.application.answersUsed.length === 0 && !job.application.blurb && (
                    <p className="text-sm text-muted-foreground">
                      No screening questions on this application.
                    </p>
                  )}
                </div>
              )}

              {job.matchReasoning && (
                <div className="space-y-1">
                  <p className="text-xs font-medium text-muted-foreground">Why this score</p>
                  <p className="text-sm leading-relaxed">{job.matchReasoning}</p>
                </div>
              )}

              <div className="space-y-1">
                <p className="text-xs font-medium text-muted-foreground">Job description</p>
                <ScrollArea className="h-64 rounded-md border p-3">
                  <p className="whitespace-pre-wrap text-sm leading-relaxed">
                    {job.jdText || "No description was captured for this listing."}
                  </p>
                </ScrollArea>
              </div>
            </div>

            <DialogFooter>
              {canReject(job.status) && (
                <Button variant="outline" disabled={pending} onClick={() => onAct(job, "reject")}>
                  {pending && <Loader2 className="size-3.5 animate-spin" />}
                  Reject
                </Button>
              )}
              {canApprove(job.status) && (
                <Button disabled={pending} onClick={() => onAct(job, "approve")}>
                  {pending && <Loader2 className="size-3.5 animate-spin" />}
                  Approve
                </Button>
              )}
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
