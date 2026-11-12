export interface RepoRef {
  installationId: number;
  /** `owner/name` */
  fullName: string;
}

export interface GhIssue {
  number: number;
  nodeId: string;
  title: string;
  body: string;
  author: string;
  labels: string[];
  state: "open" | "closed";
}

export interface GhComment {
  id: number;
  body: string;
  author: string;
}

export interface GhPullRequest {
  number: number;
  url: string;
  headSha: string;
  state: "open" | "closed";
  merged: boolean;
}

export interface GhPrFile {
  filename: string;
  additions: number;
  deletions: number;
  patch?: string;
}

export interface GhReview {
  id: number;
  author: string;
  state: string; // APPROVED | CHANGES_REQUESTED | COMMENTED | DISMISSED
  body: string;
}

/** A failed CI check, reduced to what a reviewer needs to find the cause. */
export interface GhCheckFailure {
  name: string;
  conclusion: string;
  summary: string | null;
  detailsUrl: string | null;
  annotations: { path: string; line?: number; message: string }[];
}

export interface GhInstallationRepo {
  id: number;
  fullName: string;
  defaultBranch: string;
}

export interface GhAppInstallation {
  id: number;
  accountLogin: string;
  accountType: string;
}

export type CiState = "success" | "failure" | "pending" | "none";

/** Everything Foundry needs from GitHub, behind one interface so tests use the in-memory fake. */
export interface GitHubClient {
  installationToken(installationId: number): Promise<{ token: string; expiresAt: string }>;
  listAppInstallations(): Promise<GhAppInstallation[]>;
  listInstallationRepos(installationId: number): Promise<GhInstallationRepo[]>;

  getIssue(repo: RepoRef, number: number): Promise<GhIssue>;
  listIssues(
    repo: RepoRef,
    opts?: { labels?: string[]; state?: "open" | "closed" | "all" },
  ): Promise<GhIssue[]>;
  createComment(repo: RepoRef, issueNumber: number, body: string): Promise<GhComment>;
  updateComment(repo: RepoRef, commentId: number, body: string): Promise<void>;
  getComment(repo: RepoRef, commentId: number): Promise<GhComment>;
  addLabels(repo: RepoRef, issueNumber: number, labels: string[]): Promise<void>;
  removeLabel(repo: RepoRef, issueNumber: number, label: string): Promise<void>;
  ensureLabel(repo: RepoRef, name: string, color: string, description?: string): Promise<void>;

  getFile(repo: RepoRef, path: string, ref?: string): Promise<{ content: string; sha: string } | null>;
  getBranchSha(repo: RepoRef, branch: string): Promise<string | null>;
  /** Create `branch` at `fromSha`; `force` resets an existing branch to that commit. */
  createBranch(repo: RepoRef, branch: string, fromSha: string, force?: boolean): Promise<void>;
  /** Create or overwrite one file on `branch` (the Contents API's update path). */
  putFile(
    repo: RepoRef,
    input: { path: string; content: string; message: string; branch: string },
  ): Promise<void>;

  findPullRequest(repo: RepoRef, head: string): Promise<GhPullRequest | null>;
  getPullRequest(repo: RepoRef, number: number): Promise<GhPullRequest>;
  createPullRequest(
    repo: RepoRef,
    input: { head: string; base: string; title: string; body: string; draft?: boolean },
  ): Promise<GhPullRequest>;
  updatePullRequest(repo: RepoRef, number: number, input: { title?: string; body?: string }): Promise<void>;
  listPullRequestFiles(repo: RepoRef, number: number): Promise<GhPrFile[]>;
  listReviews(repo: RepoRef, number: number): Promise<GhReview[]>;
  requestReviewers(repo: RepoRef, number: number, users: string[], teams: string[]): Promise<void>;
  mergePullRequest(repo: RepoRef, number: number, method: "squash" | "merge" | "rebase"): Promise<void>;
  ciState(repo: RepoRef, sha: string, requiredChecks?: string[]): Promise<CiState>;
  /** Failed check runs and commit statuses for a commit, with their annotations/output. */
  checkFailures(repo: RepoRef, sha: string): Promise<GhCheckFailure[]>;
  /**
   * Submit a pull-request review. The Foundry App authors the PR, so callers use the `COMMENT`
   * event and put the verdict in the body; inline comments are dropped if GitHub rejects them.
   */
  createReview(
    repo: RepoRef,
    number: number,
    input: {
      body: string;
      event: "COMMENT" | "REQUEST_CHANGES" | "APPROVE";
      comments?: { path: string; line: number; body: string }[];
      commitId?: string;
    },
  ): Promise<GhReview>;

  /** GitHub Projects (v2): set the single-select "Status" field of the item for `contentNodeId`. */
  setProjectStatus(
    installationId: number,
    projectId: string,
    contentNodeId: string,
    status: string,
  ): Promise<void>;
}
