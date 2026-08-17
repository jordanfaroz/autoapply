"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  CircleDot,
  Loader2,
  Play,
  RefreshCw,
  Square,
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import type { RunnerStatus } from "@/lib/runner";
import type { SiteId } from "@/lib/sites";

type SiteOption = { id: SiteId; displayName: string; enabled: boolean; implemented: boolean };

const POLL_MS = 2_000;

const TERMINAL = new Set(["completed", "failed", "stopped"]);

export function RunPanel({
  initial,
  sites,
}: {
  /** Rendered server-side, so there is no empty first paint and no extra request. */
  initial: RunnerStatus;
  sites: SiteOption[];
}) {
  const [status, setStatus] = useState<RunnerStatus>(initial);
  const [busy, setBusy] = useState(false);
  const [site, setSite] = useState<SiteId | "">(sites.find((s) => s.enabled)?.id ?? "");
  const mounted = useRef(true);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/runs", { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as RunnerStatus;
      if (mounted.current) setStatus(data);
    } catch {
      // Dev server restarting, or the app is closing — the next tick retries.
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    const timer = setInterval(refresh, POLL_MS);
    return () => {
      mounted.current = false;
      clearInterval(timer);
    };
  }, [refresh]);

  async function post(url: string, body: unknown, successFallback: string) {
    setBusy(true);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json()) as { ok?: boolean; message?: string };
      if (res.ok && data.ok !== false) toast.success(data.message ?? successFallback);
      else toast.error(data.message ?? "Something went wrong.", { duration: 10_000 });
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
      await refresh();
    }
  }

  const active = status.activeRun;
  const paused = active?.status === "paused_needs_attention";
  const selected = sites.find((s) => s.id === site);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <div>
            <CardTitle className="text-base">Automation</CardTitle>
            <CardDescription>
              Runs execute in a separate visible browser process, not in this page.
            </CardDescription>
          </div>
          <Button
            size="icon"
            variant="ghost"
            className="size-7"
            onClick={() => void refresh()}
            aria-label="Refresh run status"
          >
            <RefreshCw className="size-3.5" />
          </Button>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* ---- paused: the thing that needs your attention ---- */}
        {paused && active && (
          <div className="rounded-md border-2 border-amber-500 bg-amber-500/10 p-3 space-y-2">
            <div className="flex items-center gap-2">
              <AlertTriangle className="size-4 text-amber-600" />
              <span className="text-sm font-semibold">
                Run #{active.id} is paused and needs you
              </span>
            </div>
            <p className="text-sm">{active.pausedReason}</p>
            <p className="text-xs text-muted-foreground">
              The browser window is still open. Solve it there, then press Resume.
            </p>
            <div className="flex gap-2">
              <Button
                size="sm"
                disabled={busy}
                onClick={() => post(`/api/runs/${active.id}`, { action: "resume" }, "Resumed.")}
              >
                Resume
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => post(`/api/runs/${active.id}`, { action: "stop" }, "Stopped.")}
              >
                Stop run
              </Button>
            </div>
          </div>
        )}

        {/* ---- active run ---- */}
        {active && !paused && (
          <div className="rounded-md border p-3 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <CircleDot className="size-3.5 animate-pulse text-emerald-500" />
              <span className="text-sm font-medium">
                Run #{active.id} — {active.type} on {active.site}
              </span>
              <Badge variant="secondary">{active.status}</Badge>
              {active.dryRun && <Badge variant="outline">dry run</Badge>}
              <div className="flex-1" />
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => post(`/api/runs/${active.id}`, { action: "stop" }, "Stopped.")}
              >
                <Square className="size-3" />
                Stop
              </Button>
            </div>
            <Counts counts={active.counts} />
            {active.errors.length > 0 && (
              <p className="text-xs text-muted-foreground">
                {active.errors[active.errors.length - 1]}
              </p>
            )}
          </div>
        )}

        {/* ---- start controls ---- */}
        {!active && (
          <div className="flex flex-wrap items-end gap-2">
            <div className="space-y-1.5">
              <span className="text-xs text-muted-foreground">Site</span>
              <Select value={site} onValueChange={(v) => setSite(v as SiteId)}>
                <SelectTrigger className="w-56">
                  <SelectValue placeholder="Choose a site" />
                </SelectTrigger>
                <SelectContent>
                  {sites.map((s) => (
                    <SelectItem key={s.id} value={s.id} disabled={!s.enabled}>
                      {s.displayName}
                      {!s.enabled && " — disabled"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button
              size="sm"
              disabled={busy || !site}
              onClick={() => post("/api/runs", { type: "scrape", site }, "Scrape started.")}
            >
              {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Play className="size-3.5" />}
              Start scrape
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={busy || !site}
              onClick={() => post("/api/runs", { type: "apply", site }, "Apply run started.")}
            >
              <Play className="size-3.5" />
              Start apply
            </Button>
            {selected && !selected.implemented && (
              <p className="w-full text-xs text-muted-foreground">
                {selected.displayName} has no adapter yet — a run will open the browser,
                verify your session and guardrails, then stop at the adapter seam.
              </p>
            )}
          </div>
        )}

        {status.lease?.kind === "login" && (
          <p className="text-xs text-muted-foreground">
            A login window is open for {status.lease.site} (pid {status.lease.pid}). Close
            it before starting a run.
          </p>
        )}

        {/* ---- history ---- */}
        {status.recentRuns.length > 0 && (
          <>
            <Separator />
            <div className="space-y-1">
              <span className="text-xs font-medium text-muted-foreground">Recent runs</span>
              <ul className="space-y-1">
                {status.recentRuns.slice(0, 6).map((run) => (
                  <li key={run.id} className="flex items-center gap-2 text-xs">
                    <span className="tabular-nums text-muted-foreground">#{run.id}</span>
                    <span>{run.type}</span>
                    <span className="text-muted-foreground">{run.site}</span>
                    <Badge
                      variant={
                        run.status === "completed"
                          ? "secondary"
                          : TERMINAL.has(run.status)
                            ? "outline"
                            : "default"
                      }
                      className="px-1.5 py-0 text-[10px]"
                    >
                      {run.status}
                    </Badge>
                    <span className="truncate text-muted-foreground">
                      {run.errors[run.errors.length - 1] ?? ""}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function Counts({ counts }: { counts: Record<string, number> }) {
  const entries = Object.entries(counts);
  if (entries.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
      {entries.map(([key, value]) => (
        <span key={key}>
          {key}: <span className="font-medium text-foreground tabular-nums">{value}</span>
        </span>
      ))}
    </div>
  );
}
