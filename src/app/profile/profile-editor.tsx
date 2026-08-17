"use client";

import { useRef, useState, useTransition } from "react";
import { FileText, Loader2, Upload } from "lucide-react";
import { toast } from "sonner";

import { parseResumeAction, saveProfileAction } from "./actions";
import {
  CertificationsEditor,
  EducationEditor,
  ExperienceEditor,
} from "./list-editors";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { WORK_MODES } from "@/lib/db/schema";
import type { ProfileInput } from "@/lib/profile";

type Props = {
  initial: ProfileInput;
  resumeOnDisk: boolean;
  apiKeyPresent: boolean;
};

const csvToList = (raw: string) =>
  raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

export function ProfileEditor({ initial, resumeOnDisk, apiKeyPresent }: Props) {
  const [form, setForm] = useState<ProfileInput>(initial);
  /** Set after a parse so the UI can say "reviewed but not yet saved". */
  const [unsavedFromParse, setUnsavedFromParse] = useState(false);
  const [parsing, startParse] = useTransition();
  const [saving, startSave] = useTransition();
  const fileInput = useRef<HTMLInputElement>(null);

  const set = <K extends keyof ProfileInput>(key: K, value: ProfileInput[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  function handleParse(formData: FormData) {
    startParse(async () => {
      const result = await parseResumeAction(formData);
      if (!result.ok) {
        toast.error(result.message, { duration: 10_000 });
        return;
      }

      const { parsed, stats } = result;
      setForm((prev) => ({
        ...prev,
        // Parsed fields are replaced wholesale...
        name: parsed.name,
        email: parsed.email,
        phone: parsed.phone,
        location: parsed.location,
        summary: parsed.summary,
        skills: parsed.skills,
        experience: parsed.experience,
        education: parsed.education,
        certifications: parsed.certifications,
        resumeFilePath: result.resumeFilePath,
        resumeFileName: result.resumeFileName,
        // ...manual fields are never touched by parsing.
      }));
      setUnsavedFromParse(true);
      fileInput.current?.form?.reset();

      const cost = stats.costUsd === null ? "" : ` · ${`$${stats.costUsd.toFixed(4)}`}`;
      toast.success(
        `Parsed ${stats.pages} page${stats.pages === 1 ? "" : "s"} ` +
          `(${stats.charCount.toLocaleString()} chars)${cost}. Review below, then Save.`,
        { duration: 8_000 },
      );
    });
  }

  function handleSave() {
    startSave(async () => {
      const result = await saveProfileAction(form);
      if (result.ok) {
        setUnsavedFromParse(false);
        toast.success(result.message);
      } else {
        toast.error(result.message);
      }
    });
  }

  return (
    <div className="space-y-6">
      {/* ---------------------------------------------------------------- */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Resume</CardTitle>
          <CardDescription>
            Upload a text-based PDF. Claude extracts the fields below; nothing is saved
            until you review and hit Save.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {form.resumeFileName && (
            <div className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm">
              <FileText className="size-4 shrink-0 text-muted-foreground" />
              <span className="truncate">{form.resumeFileName}</span>
              {resumeOnDisk ? (
                <Badge variant="secondary">on disk</Badge>
              ) : (
                <Badge variant="outline" className="text-muted-foreground">
                  not yet saved
                </Badge>
              )}
            </div>
          )}

          <form action={handleParse} className="flex flex-wrap items-center gap-2">
            <Input
              ref={fileInput}
              type="file"
              name="resume"
              accept="application/pdf,.pdf"
              required
              className="max-w-sm"
              disabled={parsing || !apiKeyPresent}
            />
            <Button type="submit" size="sm" disabled={parsing || !apiKeyPresent}>
              {parsing ? (
                <>
                  <Loader2 className="size-3.5 animate-spin" />
                  Parsing…
                </>
              ) : (
                <>
                  <Upload className="size-3.5" />
                  Parse resume
                </>
              )}
            </Button>
          </form>

          {!apiKeyPresent && (
            <p className="text-xs text-destructive">
              ANTHROPIC_API_KEY is not set — parsing is disabled. Add it to{" "}
              <code>.env</code> and restart the dev server.
            </p>
          )}
          {unsavedFromParse && (
            <p className="rounded-md border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-xs">
              Parsed values are loaded into the form below but{" "}
              <strong>not saved yet</strong>. Review them, then press Save profile.
            </p>
          )}
        </CardContent>
      </Card>

      {/* ---------------------------------------------------------------- */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Parsed fields</CardTitle>
          <CardDescription>
            Everything here comes from the resume. Edit freely — your edits win.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Name" id="name">
              <Input
                id="name"
                value={form.name ?? ""}
                onChange={(e) => set("name", e.target.value || null)}
              />
            </Field>
            <Field label="Email" id="email">
              <Input
                id="email"
                type="email"
                value={form.email ?? ""}
                onChange={(e) => set("email", e.target.value || null)}
              />
            </Field>
            <Field label="Phone" id="phone">
              <Input
                id="phone"
                value={form.phone ?? ""}
                onChange={(e) => set("phone", e.target.value || null)}
              />
            </Field>
            <Field label="Location" id="location">
              <Input
                id="location"
                value={form.location ?? ""}
                onChange={(e) => set("location", e.target.value || null)}
              />
            </Field>
          </div>

          <Field label="Summary" id="summary">
            <Textarea
              id="summary"
              rows={3}
              value={form.summary ?? ""}
              onChange={(e) => set("summary", e.target.value || null)}
            />
          </Field>

          <Field
            label="Skills"
            id="skills"
            hint={`comma separated · ${form.skills.length} listed`}
          >
            <Textarea
              id="skills"
              rows={3}
              value={form.skills.join(", ")}
              onChange={(e) => set("skills", csvToList(e.target.value))}
            />
          </Field>

          <Separator />
          <ExperienceEditor
            value={form.experience}
            onChange={(v) => set("experience", v)}
          />

          <Separator />
          <EducationEditor value={form.education} onChange={(v) => set("education", v)} />

          <Separator />
          <CertificationsEditor
            value={form.certifications}
            onChange={(v) => set("certifications", v)}
          />
        </CardContent>
      </Card>

      {/* ---------------------------------------------------------------- */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Manual fields</CardTitle>
          <CardDescription>
            Never inferred from your resume, and never invented by Claude. These feed
            job scoring and screening answers.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Notice period" id="noticePeriod">
              <Input
                id="noticePeriod"
                placeholder="60 days"
                value={form.noticePeriod ?? ""}
                onChange={(e) => set("noticePeriod", e.target.value || null)}
              />
            </Field>
            <Field label="Current CTC" id="currentCtc">
              <Input
                id="currentCtc"
                placeholder="32 LPA"
                value={form.currentCtc ?? ""}
                onChange={(e) => set("currentCtc", e.target.value || null)}
              />
            </Field>
            <Field label="Expected CTC" id="expectedCtc">
              <Input
                id="expectedCtc"
                placeholder="45 LPA"
                value={form.expectedCtc ?? ""}
                onChange={(e) => set("expectedCtc", e.target.value || null)}
              />
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Total experience (years)" id="totalExperienceYears">
              <Input
                id="totalExperienceYears"
                type="number"
                step="0.5"
                min={0}
                value={form.totalExperienceYears ?? ""}
                onChange={(e) =>
                  set(
                    "totalExperienceYears",
                    e.target.value === "" ? null : Number(e.target.value),
                  )
                }
              />
            </Field>

            <Field label="Work mode" id="workMode">
              <Select
                value={form.workMode ?? "unset"}
                onValueChange={(v) =>
                  set("workMode", v === "unset" ? null : (v as ProfileInput["workMode"]))
                }
              >
                <SelectTrigger id="workMode" className="w-full">
                  <SelectValue placeholder="No preference" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="unset">No preference</SelectItem>
                  {WORK_MODES.map((mode) => (
                    <SelectItem key={mode} value={mode}>
                      {mode}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            <div className="flex items-end pb-2">
              <div className="flex items-center gap-2">
                <Switch
                  id="willingToRelocate"
                  checked={form.willingToRelocate}
                  onCheckedChange={(v) => set("willingToRelocate", v)}
                />
                <Label htmlFor="willingToRelocate" className="text-sm">
                  Willing to relocate
                </Label>
              </div>
            </div>
          </div>

          <Field
            label="Preferred locations"
            id="preferredLocations"
            hint={`comma separated · ${form.preferredLocations.length} listed`}
          >
            <Input
              id="preferredLocations"
              placeholder="Bangalore, Pune, Remote"
              value={form.preferredLocations.join(", ")}
              onChange={(e) => set("preferredLocations", csvToList(e.target.value))}
            />
          </Field>
        </CardContent>
      </Card>

      {/* ---------------------------------------------------------------- */}
      <div className="sticky bottom-0 -mx-4 flex items-center gap-3 border-t bg-background/95 px-4 py-3 backdrop-blur">
        <Button onClick={handleSave} disabled={saving}>
          {saving ? (
            <>
              <Loader2 className="size-3.5 animate-spin" />
              Saving…
            </>
          ) : (
            "Save profile"
          )}
        </Button>
        {unsavedFromParse && (
          <span className="text-xs text-muted-foreground">Unsaved parsed changes</span>
        )}
      </div>
    </div>
  );
}

function Field({
  label,
  id,
  hint,
  children,
}: {
  label: string;
  id: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>
        {label}
        {hint && <span className="ml-1.5 font-normal text-muted-foreground">{hint}</span>}
      </Label>
      {children}
    </div>
  );
}
