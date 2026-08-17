import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { CLAUDE_MODEL } from "@/lib/config";
import { getApiKeyStatus } from "@/lib/env";
import { getGlobalSettings, getSiteSettings } from "@/lib/settings";

import { GlobalSettingsForm } from "./global-settings-form";
import { SiteSettingsForm } from "./site-settings-form";

export const dynamic = "force-dynamic";

export default function SettingsPage() {
  const settings = getGlobalSettings();
  const sites = getSiteSettings();
  const apiKey = getApiKeyStatus();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground">
          Search criteria, guardrails, and the API key everything runs on.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Claude API</CardTitle>
          <CardDescription>
            Read from <code>ANTHROPIC_API_KEY</code> in <code>.env</code>. Restart the dev
            server after changing it.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">Key</span>
            {apiKey.present ? (
              <>
                <Badge variant="secondary">Detected</Badge>
                <code className="text-xs text-muted-foreground">{apiKey.masked}</code>
              </>
            ) : (
              <Badge variant="destructive">Missing</Badge>
            )}
          </div>
          <Separator orientation="vertical" className="h-4" />
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">Model</span>
            <code className="text-xs">{CLAUDE_MODEL}</code>
          </div>
          {!apiKey.present && (
            <p className="w-full text-xs text-muted-foreground">
              Copy <code>.env.example</code> to <code>.env</code> and paste your key. Until
              then, resume parsing and job scoring will fail.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Global</CardTitle>
          <CardDescription>Applies to every site unless overridden below.</CardDescription>
        </CardHeader>
        <CardContent>
          <GlobalSettingsForm settings={settings} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Sites</CardTitle>
          <CardDescription>
            Per-site search criteria and rate limits. Each site saves independently.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-8">
          {sites.map((site, i) => (
            <div key={site.site}>
              {i > 0 && <Separator className="mb-8" />}
              <SiteSettingsForm site={site} />
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
