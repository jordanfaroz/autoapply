"use client";

import { useState, useTransition } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { createAnswerAction, updateAnswerAction } from "./actions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ANSWER_TYPES, type AnswerBankEntry, type AnswerType } from "@/lib/db/schema";
import { normalizeQuestion } from "@/lib/questions";

export type AnswerDialogState =
  | { mode: "closed" }
  | { mode: "create" }
  | { mode: "edit"; entry: AnswerBankEntry };

type ExistingQuestion = { id: number; normalized: string };

export function AnswerDialog({
  state,
  onOpenChange,
  existingNormalized,
}: {
  state: AnswerDialogState;
  onOpenChange: (open: boolean) => void;
  /** Normalised questions already in the bank, for the inline duplicate warning. */
  existingNormalized: ExistingQuestion[];
}) {
  const open = state.mode !== "closed";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        {/* Keyed so switching targets remounts with fresh state — no effect syncing. */}
        {state.mode !== "closed" && (
          <AnswerForm
            key={state.mode === "edit" ? `edit-${state.entry.id}` : "create"}
            state={state}
            existingNormalized={existingNormalized}
            onDone={() => onOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function AnswerForm({
  state,
  existingNormalized,
  onDone,
}: {
  state: Exclude<AnswerDialogState, { mode: "closed" }>;
  existingNormalized: ExistingQuestion[];
  onDone: () => void;
}) {
  const isEdit = state.mode === "edit";
  const [question, setQuestion] = useState(isEdit ? state.entry.question : "");
  const [answer, setAnswer] = useState(isEdit ? state.entry.answer : "");
  const [type, setType] = useState<AnswerType>(isEdit ? state.entry.type : "text");
  const [pending, start] = useTransition();

  const normalized = normalizeQuestion(question);
  const duplicate =
    normalized.length > 0 &&
    existingNormalized.some(
      (e) => e.normalized === normalized && (!isEdit || e.id !== state.entry.id),
    );

  function submit() {
    start(async () => {
      const result = isEdit
        ? await updateAnswerAction({ id: state.entry.id, question, answer, type })
        : await createAnswerAction({ question, answer, type });

      if (result.ok) {
        toast.success(result.message);
        onDone();
      } else {
        toast.error(result.message);
      }
    });
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>{isEdit ? "Edit answer" : "Add answer"}</DialogTitle>
        <DialogDescription>
          Used verbatim when a screening form asks this question. Claude may adapt
          formatting to fit the field, never the content.
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="ab-question">Question</Label>
          <Input
            id="ab-question"
            value={question}
            placeholder="What is your notice period?"
            onChange={(e) => setQuestion(e.target.value)}
          />
          {normalized && (
            <p className="text-xs text-muted-foreground">
              Matches as: <code>{normalized}</code>
            </p>
          )}
          {duplicate && (
            <p className="text-xs text-destructive">
              Another entry already matches this question. Edit that one instead.
            </p>
          )}
        </div>

        <div className="grid gap-4 sm:grid-cols-[1fr_10rem]">
          <div className="space-y-1.5">
            <Label htmlFor="ab-answer">Answer</Label>
            <Textarea
              id="ab-answer"
              rows={4}
              value={answer}
              onChange={(e) => setAnswer(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ab-type">Type</Label>
            <Select value={type} onValueChange={(v) => setType(v as AnswerType)}>
              <SelectTrigger id="ab-type" className="w-full">
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
            <p className="text-xs text-muted-foreground">
              Hints how this maps to a form control.
            </p>
          </div>
        </div>
      </div>

      <DialogFooter>
        <Button variant="outline" onClick={onDone} disabled={pending}>
          Cancel
        </Button>
        <Button onClick={submit} disabled={pending || duplicate}>
          {pending && <Loader2 className="size-3.5 animate-spin" />}
          {isEdit ? "Save changes" : "Add answer"}
        </Button>
      </DialogFooter>
    </>
  );
}
