"use client";

import { useState, useTransition } from "react";
import { CheckCircle2, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { resolveParkedAction } from "./actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ANSWER_TYPES, type AnswerType } from "@/lib/db/schema";
import type { ParkedQuestionGroup } from "@/lib/answers";

export function ParkedQuestions({ groups }: { groups: ParkedQuestionGroup[] }) {
  if (groups.length === 0) {
    return (
      <div className="flex items-center gap-2 rounded-md border border-dashed px-3 py-6 text-sm text-muted-foreground">
        <CheckCircle2 className="size-4" />
        Nothing parked. Jobs land here when a screening question has no confident match
        in the bank — Claude never guesses an answer.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {groups.map((group) => (
        <ParkedGroup key={group.questionNormalized} group={group} />
      ))}
    </div>
  );
}

function ParkedGroup({ group }: { group: ParkedQuestionGroup }) {
  const [answer, setAnswer] = useState("");
  const [type, setType] = useState<AnswerType>("text");
  const [pending, start] = useTransition();

  function submit() {
    if (!answer.trim()) {
      toast.error("Enter an answer first.");
      return;
    }
    start(async () => {
      const result = await resolveParkedAction({
        questionNormalized: group.questionNormalized,
        questionText: group.questionText,
        answer,
        type,
      });
      if (result.ok) {
        setAnswer("");
        toast.success(result.message, { duration: 8_000 });
      } else {
        toast.error(result.message);
      }
    });
  }

  return (
    <div className="rounded-md border border-amber-500/40 bg-amber-500/5 p-3 space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="text-sm font-medium">{group.questionText}</p>
        <Badge variant="secondary" className="shrink-0">
          {group.jobs.length} job{group.jobs.length === 1 ? "" : "s"} waiting
        </Badge>
      </div>

      <ul className="flex flex-wrap gap-1.5">
        {group.jobs.map((job) => (
          <li
            key={job.id}
            className="rounded border bg-background px-1.5 py-0.5 text-xs text-muted-foreground"
          >
            {job.company} — {job.title}
            <span className="ml-1 opacity-60">({job.site})</span>
          </li>
        ))}
      </ul>

      <div className="grid gap-3 sm:grid-cols-[1fr_9rem_auto] sm:items-end">
        <div className="space-y-1.5">
          <Label htmlFor={`pq-answer-${group.questionNormalized}`} className="text-xs">
            Your answer
          </Label>
          <Textarea
            id={`pq-answer-${group.questionNormalized}`}
            rows={2}
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
            className="bg-background"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`pq-type-${group.questionNormalized}`} className="text-xs">
            Type
          </Label>
          <Select value={type} onValueChange={(v) => setType(v as AnswerType)}>
            <SelectTrigger
              id={`pq-type-${group.questionNormalized}`}
              className="w-full bg-background"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ANSWER_TYPES.map((t) => (
                <SelectItem key={t} value={t}>
                  {t}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button onClick={submit} disabled={pending} size="sm">
          {pending && <Loader2 className="size-3.5 animate-spin" />}
          Save & release
        </Button>
      </div>
    </div>
  );
}
