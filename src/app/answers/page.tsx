import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { listAnswers, listParkedQuestions } from "@/lib/answers";

import { AnswerBankTable } from "./answer-bank-table";
import { ParkedQuestions } from "./parked-questions";

export const dynamic = "force-dynamic";

export default function AnswersPage() {
  const answers = listAnswers();
  const parked = listParkedQuestions();

  const waitingJobs = new Set(parked.flatMap((g) => g.jobs.map((j) => j.id))).size;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Answer Bank</h1>
        <p className="text-sm text-muted-foreground">
          The only source of screening answers. If a question has no confident match
          here, the job is parked rather than answered.
        </p>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <CardTitle className="text-base">Parked questions</CardTitle>
            {parked.length > 0 && (
              <Badge variant="secondary">
                {parked.length} question{parked.length === 1 ? "" : "s"} ·{" "}
                {waitingJobs} job{waitingJobs === 1 ? "" : "s"}
              </Badge>
            )}
          </div>
          <CardDescription>
            Answering one question releases every job waiting on it. A job returns to{" "}
            <code>approved</code> only once all of its questions are answered.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ParkedQuestions groups={parked} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <CardTitle className="text-base">Answers</CardTitle>
            <Badge variant="outline">{answers.length}</Badge>
          </div>
          <CardDescription>
            Stored answers are used verbatim. Matching ignores case, spacing and trailing
            punctuation, so “Notice period?” and “NOTICE PERIOD *” are the same question.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <AnswerBankTable rows={answers} />
        </CardContent>
      </Card>
    </div>
  );
}
