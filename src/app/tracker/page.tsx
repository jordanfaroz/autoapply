import Link from "next/link";
import { ExternalLink } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  getSiteActivityToday,
  getTrackerStats,
  listApplications,
  listManualApply,
  siteDisplayName,
} from "@/lib/tracker";
import { TrackerTable } from "./tracker-table";

export const dynamic = "force-dynamic";

export default function TrackerPage() {
  const stats = getTrackerStats();
  const siteActivity = getSiteActivityToday().filter((s) => s.enabled);
  const applications = listApplications();
  const manualApply = listManualApply();

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold">Tracker</h1>
        <p className="text-sm text-muted-foreground">
          Every application this tool has made, real or dry-run. Click one for the
          exact answers and blurb that were used.
        </p>
      </header>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
        <StatCard label="Total applications" value={stats.total} />
        <StatCard label="Live" value={stats.live} />
        <StatCard label="Dry run" value={stats.dryRun} />
        <StatCard label="Applied today" value={stats.today} />
        <StatCard
          label="Needs your input"
          value={stats.parkedOutstanding + stats.needsReviewOutstanding}
          hint={
            stats.parkedOutstanding + stats.needsReviewOutstanding > 0 ? (
              <Link href="/queue" className="underline underline-offset-2">
                {stats.parkedOutstanding} parked, {stats.needsReviewOutstanding} to review
              </Link>
            ) : undefined
          }
        />
      </div>

      {siteActivity.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Today, by site</CardTitle>
            <CardDescription>
              Applications submitted today against each site&rsquo;s daily cap.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {siteActivity.map((s) => (
              <Badge
                key={s.site}
                variant="outline"
                className={
                  s.appliedToday >= s.dailyCap
                    ? "border-amber-500/40 bg-amber-500/10 font-mono"
                    : "font-mono"
                }
              >
                {s.displayName} · {s.appliedToday}/{s.dailyCap}
              </Badge>
            ))}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Applications</CardTitle>
        </CardHeader>
        <CardContent>
          <TrackerTable applications={applications} />
        </CardContent>
      </Card>

      {manualApply.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Manual apply</CardTitle>
            <CardDescription>
              Redirected off-site during apply — outside what this tool automates. Open
              each listing and apply there yourself.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-1.5">
            {manualApply.map((job) => (
              <a
                key={job.id}
                href={job.externalUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm hover:bg-muted/50"
              >
                <span>
                  <span className="font-medium">{job.title}</span>{" "}
                  <span className="text-muted-foreground">
                    — {job.company} · {siteDisplayName(job.site)}
                  </span>
                </span>
                <ExternalLink className="size-3.5 shrink-0 text-muted-foreground" />
              </a>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function StatCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: number;
  hint?: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardDescription>{label}</CardDescription>
        <CardTitle className="text-2xl tabular-nums">{value}</CardTitle>
      </CardHeader>
      {hint && <CardContent className="text-xs text-muted-foreground">{hint}</CardContent>}
    </Card>
  );
}
