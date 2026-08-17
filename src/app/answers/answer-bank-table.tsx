"use client";

import { useMemo, useState, useTransition } from "react";
import { Pencil, Plus, Search, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { deleteAnswerAction } from "./actions";
import { AnswerDialog, type AnswerDialogState } from "./answer-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { AnswerBankRow } from "@/lib/answers";

export function AnswerBankTable({ rows }: { rows: AnswerBankRow[] }) {
  const [dialog, setDialog] = useState<AnswerDialogState>({ mode: "closed" });
  const [query, setQuery] = useState("");
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [, startDelete] = useTransition();

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (r) =>
        r.question.toLowerCase().includes(q) || r.answer.toLowerCase().includes(q),
    );
  }, [rows, query]);

  const existingNormalized = useMemo(
    () => rows.map((r) => ({ id: r.id, normalized: r.questionNormalized })),
    [rows],
  );

  function handleDelete(row: AnswerBankRow) {
    const warning =
      row.resolvedJobCount > 0
        ? `\n\n${row.resolvedJobCount} job${row.resolvedJobCount === 1 ? "" : "s"} rely on this answer and will move back to parked.`
        : "";
    if (!confirm(`Delete "${row.question}"?${warning}`)) return;

    setDeletingId(row.id);
    startDelete(async () => {
      const result = await deleteAnswerAction(row.id);
      setDeletingId(null);
      if (result.ok) toast.success(result.message);
      else toast.error(result.message);
    });
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <div className="relative max-w-sm flex-1">
          <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search questions and answers…"
            className="pl-8"
          />
        </div>
        <div className="flex-1" />
        <Button size="sm" onClick={() => setDialog({ mode: "create" })}>
          <Plus className="size-3.5" />
          Add answer
        </Button>
      </div>

      {rows.length === 0 ? (
        <p className="rounded-md border border-dashed px-3 py-8 text-center text-sm text-muted-foreground">
          The answer bank is empty. Add the questions you already know you will be asked —
          notice period, current CTC, expected CTC, willingness to relocate — so the first
          apply run does not park on them.
        </p>
      ) : filtered.length === 0 ? (
        <p className="rounded-md border border-dashed px-3 py-8 text-center text-sm text-muted-foreground">
          No answer matches “{query}”.
        </p>
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[34%]">Question</TableHead>
                <TableHead>Answer</TableHead>
                <TableHead className="w-20">Type</TableHead>
                <TableHead className="w-24">Source</TableHead>
                <TableHead className="w-20 text-right">Used</TableHead>
                <TableHead className="w-20" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((row) => (
                <TableRow key={row.id} className={deletingId === row.id ? "opacity-50" : ""}>
                  <TableCell className="align-top font-medium">{row.question}</TableCell>
                  <TableCell className="align-top whitespace-pre-wrap text-muted-foreground">
                    {row.answer}
                  </TableCell>
                  <TableCell className="align-top">
                    <Badge variant="outline">{row.type}</Badge>
                  </TableCell>
                  <TableCell className="align-top text-xs text-muted-foreground">
                    {row.createdFrom === "parked_job" ? "from a job" : "manual"}
                  </TableCell>
                  <TableCell className="align-top text-right text-xs tabular-nums text-muted-foreground">
                    {row.resolvedJobCount > 0 ? row.resolvedJobCount : "—"}
                  </TableCell>
                  <TableCell className="align-top">
                    <div className="flex justify-end gap-0.5">
                      <Button
                        size="icon"
                        variant="ghost"
                        className="size-7"
                        aria-label={`Edit ${row.question}`}
                        onClick={() => setDialog({ mode: "edit", entry: row })}
                      >
                        <Pencil className="size-3.5" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="size-7 text-muted-foreground hover:text-destructive"
                        aria-label={`Delete ${row.question}`}
                        disabled={deletingId === row.id}
                        onClick={() => handleDelete(row)}
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <AnswerDialog
        state={dialog}
        existingNormalized={existingNormalized}
        onOpenChange={(open) => !open && setDialog({ mode: "closed" })}
      />
    </div>
  );
}
