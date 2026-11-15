"use client";

import { HARNESS_IDS } from "@foundry/shared";
import { type FormEvent, useTransition } from "react";
import { useToast } from "@/components/toast";
import { repoSettingsAction } from "../../actions";

type Props = {
  repoId: string;
  mergeMode: string;
  defaultHarness: string | null;
  defaultModel: string | null;
  ghProjectId: string | null;
};

/** Per-repo settings form: saves all four fields together and reports the outcome as a toast. */
export function RepoSettingsForm({ repoId, mergeMode, defaultHarness, defaultModel, ghProjectId }: Props) {
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();

  const save = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending) return;
    const form = new FormData(event.currentTarget);
    startTransition(async () => {
      try {
        await repoSettingsAction(form);
        toast({
          title: "Repo settings saved",
          description: "Applies to new jobs and future merges on this repo.",
          tone: "ok",
        });
      } catch {
        toast({
          title: "Repo settings not saved",
          description: "Something went wrong. Try again.",
          tone: "bad",
        });
      }
    });
  };

  return (
    <form onSubmit={save} className="row" style={{ marginTop: 10, alignItems: "flex-end" }}>
      <input type="hidden" name="repoId" value={repoId} />
      <label>
        Merge mode
        <select name="mergeMode" defaultValue={mergeMode} disabled={pending}>
          <option value="off">Off — always hand over</option>
          <option value="merge_when_confident">Merge when confident</option>
        </select>
      </label>
      <label>
        Default harness
        <select name="defaultHarness" defaultValue={defaultHarness ?? ""} disabled={pending}>
          <option value="">Team default</option>
          {HARNESS_IDS.map((h) => (
            <option key={h} value={h}>
              {h}
            </option>
          ))}
        </select>
      </label>
      <label>
        Default model
        <input
          name="defaultModel"
          defaultValue={defaultModel ?? ""}
          placeholder="team default — deepseek/deepseek-chat"
          style={{ width: 300 }}
          disabled={pending}
        />
      </label>
      <label>
        GitHub Project ID (optional)
        <input name="ghProjectId" defaultValue={ghProjectId ?? ""} placeholder="PVT_…" disabled={pending} />
      </label>
      <button type="submit" disabled={pending}>
        {pending ? "Saving…" : "Save"}
      </button>
    </form>
  );
}
