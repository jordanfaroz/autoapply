"use client";

import { Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type {
  CertificationEntry,
  EducationEntry,
  ExperienceEntry,
} from "@/lib/db/schema";

function SectionShell({
  label,
  count,
  onAdd,
  addLabel,
  children,
}: {
  label: string;
  count: number;
  onAdd: () => void;
  addLabel: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <Label className="text-sm font-medium">
          {label}
          <span className="ml-1.5 font-normal text-muted-foreground">({count})</span>
        </Label>
        <Button type="button" size="sm" variant="outline" onClick={onAdd}>
          <Plus className="size-3.5" />
          {addLabel}
        </Button>
      </div>
      {count === 0 ? (
        <p className="rounded-md border border-dashed px-3 py-4 text-center text-xs text-muted-foreground">
          Nothing here yet.
        </p>
      ) : (
        <div className="space-y-3">{children}</div>
      )}
    </div>
  );
}

function EntryShell({
  index,
  onRemove,
  children,
}: {
  index: number;
  onRemove: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="relative rounded-md border p-3 pt-8">
      <div className="absolute right-2 top-2 flex items-center gap-2">
        <span className="text-[11px] tabular-nums text-muted-foreground">
          #{index + 1}
        </span>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="size-6 text-muted-foreground hover:text-destructive"
          onClick={onRemove}
          aria-label={`Remove entry ${index + 1}`}
        >
          <Trash2 className="size-3.5" />
        </Button>
      </div>
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------

export function ExperienceEditor({
  value,
  onChange,
}: {
  value: ExperienceEntry[];
  onChange: (next: ExperienceEntry[]) => void;
}) {
  const update = (i: number, patch: Partial<ExperienceEntry>) =>
    onChange(value.map((e, idx) => (idx === i ? { ...e, ...patch } : e)));

  return (
    <SectionShell
      label="Experience"
      count={value.length}
      addLabel="Add role"
      onAdd={() =>
        onChange([
          ...value,
          { company: "", title: "", from: "", to: "", highlights: [] },
        ])
      }
    >
      {value.map((entry, i) => (
        <EntryShell
          key={i}
          index={i}
          onRemove={() => onChange(value.filter((_, idx) => idx !== i))}
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor={`exp-company-${i}`} className="text-xs">
                Company
              </Label>
              <Input
                id={`exp-company-${i}`}
                value={entry.company}
                onChange={(e) => update(i, { company: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`exp-title-${i}`} className="text-xs">
                Title
              </Label>
              <Input
                id={`exp-title-${i}`}
                value={entry.title}
                onChange={(e) => update(i, { title: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`exp-from-${i}`} className="text-xs">
                From
              </Label>
              <Input
                id={`exp-from-${i}`}
                value={entry.from}
                placeholder="Mar 2021"
                onChange={(e) => update(i, { from: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`exp-to-${i}`} className="text-xs">
                To
              </Label>
              <Input
                id={`exp-to-${i}`}
                value={entry.to}
                placeholder="Present"
                onChange={(e) => update(i, { to: e.target.value })}
              />
            </div>
          </div>
          <div className="mt-3 space-y-1.5">
            <Label htmlFor={`exp-highlights-${i}`} className="text-xs">
              Highlights <span className="text-muted-foreground">(one per line)</span>
            </Label>
            <Textarea
              id={`exp-highlights-${i}`}
              rows={4}
              value={entry.highlights.join("\n")}
              onChange={(e) =>
                update(i, {
                  highlights: e.target.value.split("\n").map((s) => s.trimStart()),
                })
              }
            />
          </div>
        </EntryShell>
      ))}
    </SectionShell>
  );
}

// ---------------------------------------------------------------------------

export function EducationEditor({
  value,
  onChange,
}: {
  value: EducationEntry[];
  onChange: (next: EducationEntry[]) => void;
}) {
  const update = (i: number, patch: Partial<EducationEntry>) =>
    onChange(value.map((e, idx) => (idx === i ? { ...e, ...patch } : e)));

  return (
    <SectionShell
      label="Education"
      count={value.length}
      addLabel="Add education"
      onAdd={() => onChange([...value, { institution: "", degree: "" }])}
    >
      {value.map((entry, i) => (
        <EntryShell
          key={i}
          index={i}
          onRemove={() => onChange(value.filter((_, idx) => idx !== i))}
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor={`edu-institution-${i}`} className="text-xs">
                Institution
              </Label>
              <Input
                id={`edu-institution-${i}`}
                value={entry.institution}
                onChange={(e) => update(i, { institution: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`edu-degree-${i}`} className="text-xs">
                Degree
              </Label>
              <Input
                id={`edu-degree-${i}`}
                value={entry.degree}
                onChange={(e) => update(i, { degree: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`edu-field-${i}`} className="text-xs">
                Field
              </Label>
              <Input
                id={`edu-field-${i}`}
                value={entry.field ?? ""}
                onChange={(e) => update(i, { field: e.target.value || undefined })}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor={`edu-from-${i}`} className="text-xs">
                  From
                </Label>
                <Input
                  id={`edu-from-${i}`}
                  value={entry.from ?? ""}
                  onChange={(e) => update(i, { from: e.target.value || undefined })}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={`edu-to-${i}`} className="text-xs">
                  To
                </Label>
                <Input
                  id={`edu-to-${i}`}
                  value={entry.to ?? ""}
                  onChange={(e) => update(i, { to: e.target.value || undefined })}
                />
              </div>
            </div>
          </div>
        </EntryShell>
      ))}
    </SectionShell>
  );
}

// ---------------------------------------------------------------------------

export function CertificationsEditor({
  value,
  onChange,
}: {
  value: CertificationEntry[];
  onChange: (next: CertificationEntry[]) => void;
}) {
  const update = (i: number, patch: Partial<CertificationEntry>) =>
    onChange(value.map((e, idx) => (idx === i ? { ...e, ...patch } : e)));

  return (
    <SectionShell
      label="Certifications"
      count={value.length}
      addLabel="Add certification"
      onAdd={() => onChange([...value, { name: "" }])}
    >
      {value.map((entry, i) => (
        <EntryShell
          key={i}
          index={i}
          onRemove={() => onChange(value.filter((_, idx) => idx !== i))}
        >
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor={`cert-name-${i}`} className="text-xs">
                Name
              </Label>
              <Input
                id={`cert-name-${i}`}
                value={entry.name}
                onChange={(e) => update(i, { name: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`cert-issuer-${i}`} className="text-xs">
                Issuer
              </Label>
              <Input
                id={`cert-issuer-${i}`}
                value={entry.issuer ?? ""}
                onChange={(e) => update(i, { issuer: e.target.value || undefined })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`cert-year-${i}`} className="text-xs">
                Year
              </Label>
              <Input
                id={`cert-year-${i}`}
                value={entry.year ?? ""}
                onChange={(e) => update(i, { year: e.target.value || undefined })}
              />
            </div>
          </div>
        </EntryShell>
      ))}
    </SectionShell>
  );
}
