export interface DiffFile {
  path: string;
  additions: number;
  deletions: number;
  addedLines: string[];
}

export interface ParsedDiff {
  files: DiffFile[];
  additions: number;
  deletions: number;
  /** additions + deletions, the size used by the auto-merge size rule */
  changedLines: number;
}

function summarize(files: DiffFile[]): ParsedDiff {
  const additions = files.reduce((n, f) => n + f.additions, 0);
  const deletions = files.reduce((n, f) => n + f.deletions, 0);
  return { files, additions, deletions, changedLines: additions + deletions };
}

/** Parse `git diff` unified output. */
export function parseUnifiedDiff(text: string): ParsedDiff {
  const files: DiffFile[] = [];
  let current: DiffFile | null = null;
  for (const line of text.split("\n")) {
    if (line.startsWith("diff --git ")) {
      const m = / b\/(.+)$/.exec(line);
      current = { path: m?.[1] ?? line, additions: 0, deletions: 0, addedLines: [] };
      files.push(current);
    } else if (!current) {
    } else if (line.startsWith("+++ ")) {
      const p = line.slice(4);
      if (p !== "/dev/null") current.path = p.replace(/^b\//, "");
    } else if (line.startsWith("--- ")) {
    } else if (line.startsWith("+")) {
      current.additions++;
      current.addedLines.push(line.slice(1));
    } else if (line.startsWith("-")) {
      current.deletions++;
    }
  }
  return summarize(files);
}

/** Build from GitHub's "list pull request files" response. */
export function diffFromGitHubFiles(
  files: { filename: string; additions: number; deletions: number; patch?: string | undefined }[],
): ParsedDiff {
  return summarize(
    files.map((f) => ({
      path: f.filename,
      additions: f.additions,
      deletions: f.deletions,
      addedLines: (f.patch ?? "")
        .split("\n")
        .filter((l) => l.startsWith("+") && !l.startsWith("+++"))
        .map((l) => l.slice(1)),
    })),
  );
}
