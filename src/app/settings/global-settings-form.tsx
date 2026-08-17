"use client";

import { useActionState, useEffect } from "react";
import { toast } from "sonner";

import { saveGlobalSettings, type ActionResult } from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import type { Settings } from "@/lib/db/schema";

export function GlobalSettingsForm({ settings }: { settings: Settings }) {
  const [result, action, pending] = useActionState<ActionResult | null, FormData>(
    saveGlobalSettings,
    null,
  );

  useEffect(() => {
    if (!result) return;
    if (result.ok) toast.success(result.message);
    else toast.error(result.message);
  }, [result]);

  return (
    <form action={action} className="space-y-5">
      <div className="flex items-start justify-between gap-6 rounded-md border border-amber-500/40 bg-amber-500/5 p-3">
        <div className="space-y-0.5">
          <Label htmlFor="dryRun" className="text-sm font-medium">
            Dry run
          </Label>
          <p className="text-xs text-muted-foreground">
            Every step runs and forms get filled, but the final submit is never clicked.
            Applications are logged with <code>dry_run = true</code>. Leave this on until
            you have watched a full apply run end to end.
          </p>
        </div>
        <Switch id="dryRun" name="dryRun" defaultChecked={settings.dryRun} />
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="space-y-1.5">
          <Label htmlFor="scoreThreshold">Score threshold</Label>
          <Input
            id="scoreThreshold"
            name="scoreThreshold"
            type="number"
            min={0}
            max={100}
            defaultValue={settings.scoreThreshold}
          />
          <p className="text-xs text-muted-foreground">
            Below this, jobs are archived instead of queued.
          </p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="activeHoursStart">Active from</Label>
          <Input
            id="activeHoursStart"
            name="activeHoursStart"
            type="time"
            defaultValue={settings.activeHoursStart}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="activeHoursEnd">Active until</Label>
          <Input
            id="activeHoursEnd"
            name="activeHoursEnd"
            type="time"
            defaultValue={settings.activeHoursEnd}
          />
          <p className="text-xs text-muted-foreground">
            Local time. Automation never runs outside this window.
          </p>
        </div>
      </div>

      <Button type="submit" disabled={pending} size="sm">
        {pending ? "Saving…" : "Save global settings"}
      </Button>
    </form>
  );
}
