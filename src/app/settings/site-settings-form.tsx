"use client";

import { useActionState, useEffect, useState } from "react";
import { ExternalLink, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { saveSiteSettings, type ActionResult } from "./actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import type { SiteSettingsView } from "@/lib/settings";

export function SiteSettingsForm({ site }: { site: SiteSettingsView }) {
  const [result, action, pending] = useActionState<ActionResult | null, FormData>(
    saveSiteSettings,
    null,
  );

  useEffect(() => {
    if (!result) return;
    if (result.ok) toast.success(result.message);
    else toast.error(result.message);
  }, [result]);

  const { descriptor } = site;

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="site" value={site.site} />

      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold">{descriptor.displayName}</h3>
          {descriptor.implemented ? (
            <Badge variant="secondary">Adapter ready</Badge>
          ) : (
            <Badge variant="outline" className="text-muted-foreground">
              Not implemented
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Label htmlFor={`enabled-${site.site}`} className="text-xs text-muted-foreground">
            Enabled
          </Label>
          <Switch
            id={`enabled-${site.site}`}
            name="enabled"
            defaultChecked={site.enabled}
            disabled={!descriptor.implemented}
          />
        </div>
      </div>

      {!descriptor.implemented && (
        <p className="rounded-md bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
          No adapter yet — this site cannot be scraped or applied to. Criteria saved here
          are kept and will take effect once the adapter lands.
        </p>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor={`keywords-${site.site}`}>Keywords</Label>
          <Input
            id={`keywords-${site.site}`}
            name="keywords"
            defaultValue={site.keywords.join(", ")}
            placeholder="engineering manager, staff engineer"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`locations-${site.site}`}>Locations</Label>
          <Input
            id={`locations-${site.site}`}
            name="locations"
            defaultValue={site.locations.join(", ")}
            placeholder="Bangalore, Remote"
          />
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-4">
        <div className="space-y-1.5">
          <Label htmlFor={`experienceMin-${site.site}`}>Exp. min (yrs)</Label>
          <Input
            id={`experienceMin-${site.site}`}
            name="experienceMin"
            type="number"
            step="0.5"
            min={0}
            defaultValue={site.experienceMin ?? ""}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`experienceMax-${site.site}`}>Exp. max (yrs)</Label>
          <Input
            id={`experienceMax-${site.site}`}
            name="experienceMax"
            type="number"
            step="0.5"
            min={0}
            defaultValue={site.experienceMax ?? ""}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`salaryFloor-${site.site}`}>Salary floor</Label>
          <Input
            id={`salaryFloor-${site.site}`}
            name="salaryFloor"
            defaultValue={site.salaryFloor ?? ""}
            placeholder="40 LPA"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`dailyApplyCap-${site.site}`}>Daily apply cap</Label>
          <Input
            id={`dailyApplyCap-${site.site}`}
            name="dailyApplyCap"
            type="number"
            min={0}
            defaultValue={site.dailyApplyCap}
          />
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-4">
        <div className="space-y-1.5">
          <Label htmlFor={`activeHoursStart-${site.site}`}>Active from</Label>
          <Input
            id={`activeHoursStart-${site.site}`}
            name="activeHoursStart"
            type="time"
            defaultValue={site.activeHoursStart ?? ""}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`activeHoursEnd-${site.site}`}>Active until</Label>
          <Input
            id={`activeHoursEnd-${site.site}`}
            name="activeHoursEnd"
            type="time"
            defaultValue={site.activeHoursEnd ?? ""}
          />
        </div>
        <div className="col-span-2 flex items-end">
          <p className="text-xs text-muted-foreground">
            Overrides the global window for this site. Clear both to fall back to global.
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 pt-1">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Saving…" : "Save"}
        </Button>
        <LoginButton site={site.site} displayName={descriptor.displayName} />
        <span className="text-xs text-muted-foreground">
          Opens a visible browser. Sign in once, then close the window — the session
          persists for every later run.
        </span>
      </div>
    </form>
  );
}

function LoginButton({ site, displayName }: { site: string; displayName: string }) {
  const [opening, setOpening] = useState(false);

  async function open() {
    setOpening(true);
    try {
      const res = await fetch("/api/browser/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ site }),
      });
      const data = (await res.json()) as { ok?: boolean; message?: string };
      if (res.ok && data.ok !== false) {
        toast.success(data.message ?? `Opening ${displayName}…`, { duration: 8_000 });
      } else {
        toast.error(data.message ?? "Could not open the browser.", { duration: 10_000 });
      }
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setOpening(false);
    }
  }

  return (
    <Button type="button" size="sm" variant="outline" onClick={open} disabled={opening}>
      {opening ? (
        <Loader2 className="size-3.5 animate-spin" />
      ) : (
        <ExternalLink className="size-3.5" />
      )}
      Open login window
    </Button>
  );
}
