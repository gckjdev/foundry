"use client";

import { type FormEvent, useTransition } from "react";
import { usd } from "@/components/status";
import { useToast } from "@/components/toast";
import { jobLimitsAction } from "../../../../actions";

type Props = {
  jobId: string;
  limitsKey: string;
  maxJobMinutes: number;
  maxCostUsd: number;
  customMaxMinutes: boolean;
  customMaxCost: boolean;
  policyMaxMinutes: number;
  policyMaxCost: number;
};

/** Job limits form: saves both limits together and reports the outcome as a toast. */
export function JobLimitsForm({
  jobId,
  limitsKey,
  maxJobMinutes,
  maxCostUsd,
  customMaxMinutes,
  customMaxCost,
  policyMaxMinutes,
  policyMaxCost,
}: Props) {
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();

  const save = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending) return;
    const form = new FormData(event.currentTarget);
    startTransition(async () => {
      try {
        const result = await jobLimitsAction(form);
        if (!result.ok) {
          toast({ title: "Job limits not saved", description: result.error, tone: "bad" });
          return;
        }
        toast({
          title: "Job limits saved",
          description: "Changes apply to this job, including a running one.",
          tone: "ok",
        });
      } catch {
        toast({
          title: "Job limits not saved",
          description: "Something went wrong. Try again.",
          tone: "bad",
        });
      }
    });
  };

  return (
    <form key={limitsKey} onSubmit={save} className="stack">
      <input type="hidden" name="jobId" value={jobId} />
      <label>
        Max execution time (minutes)
        <input
          name="maxMinutes"
          type="number"
          min="1"
          step="1"
          defaultValue={maxJobMinutes}
          disabled={pending}
        />
      </label>
      <div className="dim small">
        {customMaxMinutes ? "Custom for this job." : `Using the repo default (${policyMaxMinutes} minutes).`}{" "}
        The runner stops the job when it runs over. Changes apply to a running job too.
      </div>
      <label>
        Max cost (USD)
        <input
          name="maxCost"
          type="number"
          min="0.01"
          step="0.01"
          defaultValue={maxCostUsd}
          disabled={pending}
        />
      </label>
      <div className="dim small">
        {customMaxCost ? "Custom for this job." : `Using the repo default (${usd(policyMaxCost)}).`} The
        runner stops the job when it spends more. Changes apply to a running job too.
      </div>
      <div>
        <button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save"}
        </button>
      </div>
    </form>
  );
}
