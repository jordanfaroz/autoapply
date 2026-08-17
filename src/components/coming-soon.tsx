import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

/** Placeholder for pages that arrive in a later build step. */
export function ComingSoon({
  title,
  step,
  description,
}: {
  title: string;
  step: number;
  description: string;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="text-sm text-muted-foreground">
        Built in step {step}.
      </CardContent>
    </Card>
  );
}
