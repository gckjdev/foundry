import { briefRef, type HandoffBrief, parseBrief, renderBrief } from "@foundry/shared";
import { git, gitOut } from "./git";

/**
 * The handoff brief lives on its own ref, `refs/foundry/<job>/brief`, as a one-file commit. It
 * never touches the job branch, so it cannot leak into the PR diff.
 */
export async function pushBrief(cwd: string, brief: HandoffBrief, token?: string): Promise<string> {
  const ref = briefRef(brief.jobId);
  const blob = await gitOut(["hash-object", "-w", "--stdin"], { cwd, input: renderBrief(brief) });
  const tree = await gitOut(["mktree"], { cwd, input: `100644 blob ${blob}\tbrief.md\n` });
  const commit = await gitOut(["commit-tree", tree, "-m", `foundry: handoff brief (${brief.stageReached})`], { cwd });
  await git(["push", "--quiet", "--force", "origin", `${commit}:${ref}`], { cwd, token });
  return ref;
}

export async function fetchBrief(cwd: string, jobId: string, token?: string): Promise<HandoffBrief | null> {
  const ref = briefRef(jobId);
  const fetched = await git(["fetch", "--quiet", "origin", `+${ref}:${ref}`], { cwd, token, allowFail: true });
  if (fetched.code !== 0) return null;
  const text = await git(["show", `${ref}:brief.md`], { cwd, allowFail: true });
  if (text.code !== 0) return null;
  try {
    return parseBrief(text.stdout);
  } catch {
    return null;
  }
}
