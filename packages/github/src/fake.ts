import type {
  CiState,
  GhAppInstallation,
  GhCheckFailure,
  GhComment,
  GhInstallationRepo,
  GhIssue,
  GhPrFile,
  GhPullRequest,
  GhReview,
  GitHubClient,
  RepoRef,
} from "./types";

interface FakeRepo {
  issues: Map<number, GhIssue>;
  comments: Map<number, GhComment & { issueNumber: number }>;
  labels: Set<string>;
  files: Map<string, string>;
  branches: Map<string, string>;
  prs: Map<number, GhPullRequest & { head: string; base: string; title: string; body: string }>;
  prFiles: Map<number, GhPrFile[]>;
  reviews: Map<number, GhReview[]>;
  requestedReviewers: Map<number, { users: string[]; teams: string[] }>;
  ci: Map<string, CiState>;
  checkFailures: Map<string, GhCheckFailure[]>;
}

/** In-memory GitHub used by unit and end-to-end tests. Every call is also recorded in `calls`. */
export class FakeGitHub implements GitHubClient {
  readonly repos = new Map<string, FakeRepo>();
  readonly installations = new Map<number, GhInstallationRepo[]>();
  readonly appInstallations: GhAppInstallation[] = [];
  readonly projectStatus = new Map<string, string>();
  readonly calls: { method: string; args: unknown[] }[] = [];
  private nextId = 1000;

  repo(fullName: string): FakeRepo {
    let r = this.repos.get(fullName);
    if (!r) {
      r = {
        issues: new Map(),
        comments: new Map(),
        labels: new Set(),
        files: new Map(),
        branches: new Map([["main", "sha-main"]]),
        prs: new Map(),
        prFiles: new Map(),
        reviews: new Map(),
        requestedReviewers: new Map(),
        ci: new Map(),
        checkFailures: new Map(),
      };
      this.repos.set(fullName, r);
    }
    return r;
  }

  addIssue(fullName: string, issue: Partial<GhIssue> & { number: number; title: string }): GhIssue {
    const full: GhIssue = {
      nodeId: `I_${issue.number}`,
      body: "",
      author: "alice",
      labels: [],
      state: "open",
      ...issue,
    };
    this.repo(fullName).issues.set(issue.number, full);
    return full;
  }

  commentsOn(fullName: string, issueNumber: number): GhComment[] {
    return [...this.repo(fullName).comments.values()].filter((c) => c.issueNumber === issueNumber);
  }

  /** What `checkFailures` returns for a commit; tests use this to stand in for failed CI. */
  seedCheckFailures(fullName: string, sha: string, failures: GhCheckFailure[]): void {
    this.repo(fullName).checkFailures.set(sha, failures);
  }

  reviewsOn(fullName: string, prNumber: number): GhReview[] {
    return this.repo(fullName).reviews.get(prNumber) ?? [];
  }

  private record(method: string, ...args: unknown[]) {
    this.calls.push({ method, args });
  }

  private issue(ref: RepoRef, number: number): GhIssue {
    const issue = this.repo(ref.fullName).issues.get(number);
    if (!issue) throw Object.assign(new Error(`issue ${number} not found`), { status: 404 });
    return issue;
  }

  async installationToken(installationId: number) {
    this.record("installationToken", installationId);
    return { token: `ghs_fake_${installationId}`, expiresAt: new Date(Date.now() + 3600_000).toISOString() };
  }

  async listAppInstallations() {
    if (this.appInstallations.length > 0) return this.appInstallations;
    return [...this.installations.keys()].map((id) => ({
      id,
      accountLogin: "fake",
      accountType: "Organization",
    }));
  }

  async listInstallationRepos(installationId: number) {
    return this.installations.get(installationId) ?? [];
  }

  async getIssue(ref: RepoRef, number: number) {
    return structuredClone(this.issue(ref, number));
  }

  async listIssues(ref: RepoRef, opts: { labels?: string[]; state?: "open" | "closed" | "all" } = {}) {
    const state = opts.state ?? "open";
    const labels = opts.labels ?? [];
    return [...this.repo(ref.fullName).issues.values()]
      .filter((i) => (state === "all" || i.state === state) && labels.every((l) => i.labels.includes(l)))
      .map((i) => structuredClone(i));
  }

  async createComment(ref: RepoRef, issueNumber: number, body: string) {
    this.record("createComment", ref.fullName, issueNumber, body);
    const comment = { id: this.nextId++, body, author: "foundry[bot]", issueNumber };
    this.repo(ref.fullName).comments.set(comment.id, comment);
    return { id: comment.id, body, author: comment.author };
  }

  async updateComment(ref: RepoRef, commentId: number, body: string) {
    this.record("updateComment", ref.fullName, commentId, body);
    const c = this.repo(ref.fullName).comments.get(commentId);
    if (!c) throw Object.assign(new Error("comment not found"), { status: 404 });
    c.body = body;
  }

  async getComment(ref: RepoRef, commentId: number) {
    const c = this.repo(ref.fullName).comments.get(commentId);
    if (!c) throw Object.assign(new Error("comment not found"), { status: 404 });
    return { id: c.id, body: c.body, author: c.author };
  }

  async addLabels(ref: RepoRef, issueNumber: number, labels: string[]) {
    this.record("addLabels", ref.fullName, issueNumber, labels);
    const target = this.repo(ref.fullName).issues.get(issueNumber);
    if (target) for (const l of labels) if (!target.labels.includes(l)) target.labels.push(l);
  }

  async removeLabel(ref: RepoRef, issueNumber: number, label: string) {
    this.record("removeLabel", ref.fullName, issueNumber, label);
    const target = this.repo(ref.fullName).issues.get(issueNumber);
    if (target) target.labels = target.labels.filter((l) => l !== label);
  }

  async ensureLabel(ref: RepoRef, name: string) {
    this.repo(ref.fullName).labels.add(name);
  }

  async getFile(ref: RepoRef, path: string) {
    const content = this.repo(ref.fullName).files.get(path);
    return content === undefined ? null : { content, sha: `sha-${path}-${content.length}` };
  }

  async getBranchSha(ref: RepoRef, branch: string) {
    return this.repo(ref.fullName).branches.get(branch) ?? null;
  }

  async createBranch(ref: RepoRef, branch: string, fromSha: string, force = false) {
    this.record("createBranch", ref.fullName, branch, fromSha, force);
    const r = this.repo(ref.fullName);
    if (r.branches.has(branch) && !force) {
      throw Object.assign(new Error(`reference already exists: ${branch}`), { status: 422 });
    }
    r.branches.set(branch, fromSha);
  }

  async putFile(ref: RepoRef, input: { path: string; content: string; message: string; branch: string }) {
    this.record("putFile", ref.fullName, input);
    const r = this.repo(ref.fullName);
    r.files.set(input.path, input.content);
    r.branches.set(input.branch, `sha-${input.path}-${input.content.length}`);
  }

  async findPullRequest(ref: RepoRef, head: string) {
    // GitHub lists newest first; a reused head can have older closed PRs behind the open one.
    const pr = [...this.repo(ref.fullName).prs.values()]
      .filter((p) => p.head === head)
      .sort((a, b) => b.number - a.number)[0];
    return pr ? this.toPr(pr) : null;
  }

  async getPullRequest(ref: RepoRef, number: number) {
    const pr = this.repo(ref.fullName).prs.get(number);
    if (!pr) throw Object.assign(new Error("pr not found"), { status: 404 });
    return this.toPr(pr);
  }

  private toPr(p: GhPullRequest): GhPullRequest {
    return { number: p.number, url: p.url, headSha: p.headSha, state: p.state, merged: p.merged };
  }

  async createPullRequest(ref: RepoRef, input: { head: string; base: string; title: string; body: string }) {
    this.record("createPullRequest", ref.fullName, input);
    const r = this.repo(ref.fullName);
    const number = r.issues.size + r.prs.size + 100;
    const pr = {
      number,
      url: `https://github.com/${ref.fullName}/pull/${number}`,
      headSha: r.branches.get(input.head) ?? `sha-${input.head}`,
      state: "open" as const,
      merged: false,
      ...input,
    };
    r.prs.set(number, pr);
    return this.toPr(pr);
  }

  async updatePullRequest(ref: RepoRef, number: number, input: { title?: string; body?: string }) {
    this.record("updatePullRequest", ref.fullName, number, input);
    const pr = this.repo(ref.fullName).prs.get(number);
    if (pr) Object.assign(pr, input);
  }

  async listPullRequestFiles(ref: RepoRef, number: number) {
    return this.repo(ref.fullName).prFiles.get(number) ?? [];
  }

  async listReviews(ref: RepoRef, number: number) {
    return this.repo(ref.fullName).reviews.get(number) ?? [];
  }

  async requestReviewers(ref: RepoRef, number: number, users: string[], teams: string[]) {
    this.record("requestReviewers", ref.fullName, number, users, teams);
    this.repo(ref.fullName).requestedReviewers.set(number, { users, teams });
  }

  async mergePullRequest(ref: RepoRef, number: number, method: string) {
    this.record("mergePullRequest", ref.fullName, number, method);
    const pr = this.repo(ref.fullName).prs.get(number);
    if (!pr) throw Object.assign(new Error("pr not found"), { status: 404 });
    pr.merged = true;
    pr.state = "closed";
  }

  async ciState(ref: RepoRef, sha: string) {
    return this.repo(ref.fullName).ci.get(sha) ?? "none";
  }

  async checkFailures(ref: RepoRef, sha: string) {
    return this.repo(ref.fullName).checkFailures.get(sha) ?? [];
  }

  async createReview(
    ref: RepoRef,
    number: number,
    input: {
      body: string;
      event: "COMMENT" | "REQUEST_CHANGES" | "APPROVE";
      comments?: { path: string; line: number; body: string }[];
      commitId?: string;
    },
  ) {
    this.record("createReview", ref.fullName, number, input);
    const state =
      input.event === "APPROVE"
        ? "APPROVED"
        : input.event === "REQUEST_CHANGES"
          ? "CHANGES_REQUESTED"
          : "COMMENTED";
    const review: GhReview = { id: this.nextId++, author: "foundry[bot]", state, body: input.body };
    const reviews = this.repo(ref.fullName).reviews;
    reviews.set(number, [...(reviews.get(number) ?? []), review]);
    return review;
  }

  async setProjectStatus(_installationId: number, projectId: string, contentNodeId: string, status: string) {
    this.record("setProjectStatus", projectId, contentNodeId, status);
    this.projectStatus.set(`${projectId}:${contentNodeId}`, status);
  }
}
