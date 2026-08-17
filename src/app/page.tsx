import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { RunPanel } from "@/components/run-panel";
import { getApiKeyStatus } from "@/lib/env";
import { countJobsByStatus } from "@/lib/jobs";
import { getStatus } from "@/lib/runner";
import { getGlobalSettings, getSiteSettings } from "@/lib/settings";
import { getSiteActivityToday, getTrackerStats } from "@/lib/tracker";

export const dynamic = "force-dynamic";

const BUILD_STEPS = [
  { n: 1, label: "Scaffold, schema, settings, .env", done: true },
  { n: 2, label: "Claude client + resume parsing + profile editor", done: true },
  { n: 3, label: "Answer bank CRUD", done: true },
  { n: 4, label: "Playwright runtime + job runner + login flow", done: true },
  { n: 5, label: "Adapter interface + Naukri scrape → dedupe → score → queue", done: true },
  { n: 6, label: "Queue UI + approve flow", done: true },
  { n: 7, label: "Naukri apply flow + parking + blurb + guardrails", done: true },
  { n: 8, label: "Tracker + dashboard", done: true },
  { n: 9, label: "Stubs for the other four adapters", done: true },
];

export default function DashboardPage() {
  // Also reconciles runs whose worker died without reporting — otherwise a crashed
  // run stays "running" forever and blocks every future start.
  const runnerStatus = getStatus();

  const settings = getGlobalSettings();
  const sites = getSiteSettings();
  const apiKey = getApiKeyStatus();
  const tracker = getTrackerStats();
  const siteActivity = getSiteActivityToday().filter((s) => s.enabled);
  const jobCounts = countJobsByStatus();

  const enabledSites = sites.filter((s) => s.enabled).length;
  const implementedSites = sites.filter((s) => s.descriptor.implemented).length;
  const runPanelSites = sites.map((s) => ({
    id: s.descriptor.id,
    displayName: s.descriptor.displayName,
    enabled: s.enabled,
    implemented: s.descriptor.implemented,
  }));

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Dashboard</h1>
          <p className="text-sm text-muted-foreground">
            {tracker.today > 0
              ? `${tracker.today} application${tracker.today === 1 ? "" : "s"} today.`
              : "No applications yet today."}
          </p>
        </div>
        {settings.dryRun ? (
          <Badge variant="secondary" className="border-amber-500/40 bg-amber-500/10">
            Dry run — nothing will be submitted
          </Badge>
        ) : (
          <Badge variant="destructive">Live — applications will be submitted</Badge>
        )}
      </div>

      <RunPanel initial={runnerStatus} sites={runPanelSites} />

      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>API key</CardDescription>
            <CardTitle className="text-2xl">
              {apiKey.present ? "Ready" : "Missing"}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">
            {apiKey.present ? apiKey.masked : "Set ANTHROPIC_API_KEY in .env"}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Sites enabled</CardDescription>
            <CardTitle className="text-2xl">
              {enabledSites}
              <span className="text-base font-normal text-muted-foreground">
                {" "}
                / {sites.length}
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">
            {implementedSites} of {sites.length} sites have an adapter.
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Needs your input</CardDescription>
            <CardTitle className="text-2xl tabular-nums">
              {(jobCounts.parked_needs_input ?? 0) + (jobCounts.failed_needs_review ?? 0)}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">
            {(jobCounts.parked_needs_input ?? 0) + (jobCounts.failed_needs_review ?? 0) > 0 ? (
              <Link href="/queue" className="underline underline-offset-2">
                {jobCounts.parked_needs_input ?? 0} parked, {jobCounts.failed_needs_review ?? 0} to
                review
              </Link>
            ) : (
              "Nothing waiting on you."
            )}
          </CardContent>
        </Card>
      </div>

      {siteActivity.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Today, by site</CardTitle>
            <CardDescription>
              Applications submitted today against each site&rsquo;s daily cap. Full history
              on the{" "}
              <Link href="/tracker" className="underline underline-offset-2">
                Tracker
              </Link>
              .
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
        <CardHeader>
          <CardTitle className="text-base">Build progress</CardTitle>
          <CardDescription>
            All 9 steps are done. Naukri is the only site with a working adapter —
            Hirist, IIMJobs, Instahyre, and LinkedIn are registered as clean stubs
            until each gets its own verified selectors. Seed the{" "}
            <Link href="/answers" className="underline underline-offset-2">
              Answer Bank
            </Link>{" "}
            so apply runs have less to park on.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ol className="space-y-1.5 text-sm">
            {BUILD_STEPS.map((step) => (
              <li key={step.n} className="flex items-center gap-2.5">
                <span
                  className={
                    step.done
                      ? "flex size-5 shrink-0 items-center justify-center rounded-full bg-foreground text-[11px] text-background"
                      : "flex size-5 shrink-0 items-center justify-center rounded-full border text-[11px] text-muted-foreground"
                  }
                >
                  {step.done ? "✓" : step.n}
                </span>
                <span className={step.done ? "" : "text-muted-foreground"}>
                  {step.label}
                </span>
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>
    </div>
  );
}
