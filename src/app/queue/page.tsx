import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { countJobsByStatus, getLatestApplications, listJobsByStatus } from "@/lib/jobs";
import { QueueBoard, type QueueJobRow, type QueueSection } from "./queue-board";

export const dynamic = "force-dynamic";

/**
 * The approve queue. This is the only place a job can become `approved` — the apply
 * flow refuses to touch anything that has not passed through here.
 */
export default function QueuePage() {
  const counts = countJobsByStatus();
  const total = Object.values(counts).reduce((sum, n) => sum + n, 0);

  const applied = listJobsByStatus(["applied"], 30);
  const applicationsByJob = getLatestApplications(applied.map((j) => j.id));
  const appliedWithInfo: QueueJobRow[] = applied.map((job) => ({
    ...job,
    application: applicationsByJob.get(job.id),
  }));

  const sections: QueueSection[] = [
    {
      key: "failed_needs_review",
      title: "Needs review",
      hint: "The apply flow stopped here — check the reason and screenshot before deciding.",
      jobs: listJobsByStatus(["failed_needs_review"], 50),
    },
    {
      key: "approved",
      title: "Approved — ready to apply",
      hint: "Waiting on an apply run. Reject here to undo an approval.",
      jobs: listJobsByStatus(["approved"]),
    },
    {
      key: "queued",
      title: "Matches",
      hint: "At or above your score threshold.",
      jobs: listJobsByStatus(["queued"]),
      emptyText: "Nothing has cleared the threshold yet.",
    },
    {
      key: "scraped",
      title: "Scraped but not scored",
      hint: "Scoring failed for these — the run log on the dashboard says why. Approve or reject by hand, or fix the cause and re-run the scrape.",
      jobs: listJobsByStatus(["scraped"], 50),
    },
    {
      key: "applied",
      title: "Applied",
      hint: "Submitted by an apply run. Click one to see the answers and blurb that were used.",
      jobs: appliedWithInfo,
    },
    {
      key: "parked_needs_input",
      title: "Parked — waiting on an answer",
      hint: "A screening question had no confident match in the Answer Bank. Answer it there to release the job back to approved.",
      jobs: listJobsByStatus(["parked_needs_input"], 50),
      muted: true,
    },
    {
      key: "manual_apply",
      title: "Manual apply",
      hint: "Redirected off-site to the company's own careers page — outside what this tool automates. Open the listing and apply there yourself.",
      jobs: listJobsByStatus(["manual_apply"], 50),
      muted: true,
    },
    {
      key: "archived_low_score",
      title: "Below threshold",
      hint: "Archived automatically. Approve one here if you disagree with the score.",
      jobs: listJobsByStatus(["archived_low_score"], 50),
      muted: true,
    },
    {
      key: "rejected",
      title: "Rejected",
      hint: "Approve one here to move it back into the queue.",
      jobs: listJobsByStatus(["rejected"], 50),
      muted: true,
    },
  ];

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold">Queue</h1>
        <p className="text-sm text-muted-foreground">
          Nothing is applied to without your approval here. Click a job for the full
          description and scoring reasoning.
        </p>
      </header>

      {total === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            No jobs scraped yet. Enable Naukri in{" "}
            <Link href="/settings" className="underline underline-offset-4">
              Settings
            </Link>
            , add at least one keyword, then start a scrape from the{" "}
            <Link href="/" className="underline underline-offset-4">
              dashboard
            </Link>
            .
          </CardContent>
        </Card>
      ) : (
        <div className="flex flex-wrap gap-2">
          {Object.entries(counts)
            .sort((a, b) => b[1] - a[1])
            .map(([status, n]) => (
              <Badge key={status} variant="outline" className="font-mono text-xs">
                {status.replace(/_/g, " ")} · {n}
              </Badge>
            ))}
        </div>
      )}

      <QueueBoard sections={sections} />
    </div>
  );
}
