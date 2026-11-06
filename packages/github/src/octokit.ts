import { createAppAuth } from "@octokit/auth-app";
import { Octokit } from "@octokit/rest";
import type { CiState, GhAppInstallation, GhPullRequest, GitHubClient, RepoRef } from "./types";

/** Resolve fetch at call time so the web app's GitHub proxy wrapper is used. */
const liveFetch: typeof fetch = (input, init) => globalThis.fetch(input, init);

export interface GitHubAppConfig {
  appId: string | number;
  privateKey: string;
}

function split(fullName: string): { owner: string; repo: string } {
  const [owner, repo] = fullName.split("/");
  if (!owner || !repo) throw new Error(`Invalid repo name: ${fullName}`);
  return { owner, repo };
}

function isNotFound(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { status?: number }).status === 404;
}

type RawPr = {
  number: number;
  html_url: string;
  head: { sha: string };
  state: string;
  merged?: boolean | null;
  merged_at?: string | null;
};

function toPr(p: RawPr): GhPullRequest {
  return {
    number: p.number,
    url: p.html_url,
    headSha: p.head.sha,
    state: p.state === "open" ? "open" : "closed",
    merged: Boolean(p.merged ?? p.merged_at),
  };
}

/** Combine check runs and commit statuses into one CI state. */
export function combineCi(
  checkRuns: { name: string; status: string; conclusion: string | null }[],
  statuses: { context: string; state: string }[],
  required: string[] = [],
): CiState {
  const results = new Map<string, "success" | "failure" | "pending">();
  for (const r of checkRuns) {
    const state =
      r.status !== "completed"
        ? "pending"
        : ["success", "neutral", "skipped"].includes(r.conclusion ?? "")
          ? "success"
          : "failure";
    results.set(r.name, state);
  }
  for (const s of statuses) {
    if (results.has(s.context)) continue; // statuses list newest first
    results.set(s.context, s.state === "success" ? "success" : s.state === "pending" ? "pending" : "failure");
  }
  for (const name of required) if (!results.has(name)) results.set(name, "pending");
  if (results.size === 0) return "none";
  const values = [...results.values()];
  if (values.includes("failure")) return "failure";
  if (values.includes("pending")) return "pending";
  return "success";
}

export class OctokitGitHubClient implements GitHubClient {
  private readonly app: Octokit;
  private readonly cache = new Map<number, { octokit: Octokit; expires: number }>();

  constructor(private readonly config: GitHubAppConfig) {
    this.app = new Octokit({
      authStrategy: createAppAuth,
      auth: { appId: config.appId, privateKey: config.privateKey },
      request: { fetch: liveFetch },
    });
  }

  private kit(installationId: number): Octokit {
    const hit = this.cache.get(installationId);
    if (hit && hit.expires > Date.now()) return hit.octokit;
    const octokit = new Octokit({
      authStrategy: createAppAuth,
      auth: { appId: this.config.appId, privateKey: this.config.privateKey, installationId },
      request: { fetch: liveFetch },
    });
    this.cache.set(installationId, { octokit, expires: Date.now() + 30 * 60_000 });
    return octokit;
  }

  async listAppInstallations(): Promise<GhAppInstallation[]> {
    const list = await this.app.paginate(this.app.apps.listInstallations, { per_page: 100 });
    return list.map((i) => ({
      id: i.id,
      accountLogin: "login" in (i.account ?? {}) ? ((i.account as { login: string }).login ?? "") : "",
      accountType: "type" in (i.account ?? {}) ? ((i.account as { type?: string }).type ?? "") : "",
    }));
  }

  async installationToken(installationId: number) {
    const { data } = await this.app.apps.createInstallationAccessToken({ installation_id: installationId });
    return { token: data.token, expiresAt: data.expires_at };
  }

  async listInstallationRepos(installationId: number) {
    const repos = await this.kit(installationId).paginate(
      this.kit(installationId).apps.listReposAccessibleToInstallation,
      { per_page: 100 },
    );
    return repos.map((r) => ({ id: r.id, fullName: r.full_name, defaultBranch: r.default_branch }));
  }

  async getIssue(ref: RepoRef, number: number) {
    const { data } = await this.kit(ref.installationId).issues.get({ ...split(ref.fullName), issue_number: number });
    return {
      number: data.number,
      nodeId: data.node_id,
      title: data.title,
      body: data.body ?? "",
      author: data.user?.login ?? "",
      labels: data.labels.map((l) => (typeof l === "string" ? l : (l.name ?? ""))).filter(Boolean),
      state: data.state === "open" ? ("open" as const) : ("closed" as const),
    };
  }

  async createComment(ref: RepoRef, issueNumber: number, body: string) {
    const { data } = await this.kit(ref.installationId).issues.createComment({
      ...split(ref.fullName),
      issue_number: issueNumber,
      body,
    });
    return { id: data.id, body: data.body ?? "", author: data.user?.login ?? "" };
  }

  async updateComment(ref: RepoRef, commentId: number, body: string) {
    await this.kit(ref.installationId).issues.updateComment({ ...split(ref.fullName), comment_id: commentId, body });
  }

  async getComment(ref: RepoRef, commentId: number) {
    const { data } = await this.kit(ref.installationId).issues.getComment({
      ...split(ref.fullName),
      comment_id: commentId,
    });
    return { id: data.id, body: data.body ?? "", author: data.user?.login ?? "" };
  }

  async addLabels(ref: RepoRef, issueNumber: number, labels: string[]) {
    if (labels.length === 0) return;
    await this.kit(ref.installationId).issues.addLabels({ ...split(ref.fullName), issue_number: issueNumber, labels });
  }

  async removeLabel(ref: RepoRef, issueNumber: number, label: string) {
    try {
      await this.kit(ref.installationId).issues.removeLabel({
        ...split(ref.fullName),
        issue_number: issueNumber,
        name: label,
      });
    } catch (err) {
      if (!isNotFound(err)) throw err;
    }
  }

  async ensureLabel(ref: RepoRef, name: string, color: string, description?: string) {
    const kit = this.kit(ref.installationId);
    try {
      await kit.issues.getLabel({ ...split(ref.fullName), name });
    } catch (err) {
      if (!isNotFound(err)) throw err;
      await kit.issues.createLabel({ ...split(ref.fullName), name, color, description });
    }
  }

  async getFile(ref: RepoRef, path: string, gitRef?: string) {
    try {
      const { data } = await this.kit(ref.installationId).repos.getContent({
        ...split(ref.fullName),
        path,
        ref: gitRef,
      });
      if (Array.isArray(data) || data.type !== "file" || !("content" in data)) return null;
      return { content: Buffer.from(data.content, "base64").toString("utf8"), sha: data.sha };
    } catch (err) {
      if (isNotFound(err)) return null;
      throw err;
    }
  }

  async getBranchSha(ref: RepoRef, branch: string) {
    try {
      const { data } = await this.kit(ref.installationId).repos.getBranch({ ...split(ref.fullName), branch });
      return data.commit.sha;
    } catch (err) {
      if (isNotFound(err)) return null;
      throw err;
    }
  }

  async findPullRequest(ref: RepoRef, head: string) {
    const { owner, repo } = split(ref.fullName);
    const { data } = await this.kit(ref.installationId).pulls.list({ owner, repo, head: `${owner}:${head}`, state: "all" });
    const pr = data[0];
    return pr ? toPr(pr) : null;
  }

  async getPullRequest(ref: RepoRef, number: number) {
    const { data } = await this.kit(ref.installationId).pulls.get({ ...split(ref.fullName), pull_number: number });
    return toPr(data);
  }

  async createPullRequest(ref: RepoRef, input: { head: string; base: string; title: string; body: string; draft?: boolean }) {
    const { data } = await this.kit(ref.installationId).pulls.create({ ...split(ref.fullName), ...input });
    return toPr(data);
  }

  async updatePullRequest(ref: RepoRef, number: number, input: { title?: string; body?: string }) {
    await this.kit(ref.installationId).pulls.update({ ...split(ref.fullName), pull_number: number, ...input });
  }

  async listPullRequestFiles(ref: RepoRef, number: number) {
    const kit = this.kit(ref.installationId);
    const files = await kit.paginate(kit.pulls.listFiles, { ...split(ref.fullName), pull_number: number, per_page: 100 });
    return files.map((f) => ({ filename: f.filename, additions: f.additions, deletions: f.deletions, patch: f.patch }));
  }

  async listReviews(ref: RepoRef, number: number) {
    const kit = this.kit(ref.installationId);
    const reviews = await kit.paginate(kit.pulls.listReviews, {
      ...split(ref.fullName),
      pull_number: number,
      per_page: 100,
    });
    return reviews.map((r) => ({ id: r.id, author: r.user?.login ?? "", state: r.state, body: r.body ?? "" }));
  }

  async requestReviewers(ref: RepoRef, number: number, users: string[], teams: string[]) {
    if (users.length === 0 && teams.length === 0) return;
    await this.kit(ref.installationId).pulls.requestReviewers({
      ...split(ref.fullName),
      pull_number: number,
      reviewers: users,
      team_reviewers: teams,
    });
  }

  async mergePullRequest(ref: RepoRef, number: number, method: "squash" | "merge" | "rebase") {
    await this.kit(ref.installationId).pulls.merge({ ...split(ref.fullName), pull_number: number, merge_method: method });
  }

  async ciState(ref: RepoRef, sha: string, requiredChecks: string[] = []) {
    const kit = this.kit(ref.installationId);
    const [runs, statuses] = await Promise.all([
      kit.checks.listForRef({ ...split(ref.fullName), ref: sha, per_page: 100 }),
      kit.repos.listCommitStatusesForRef({ ...split(ref.fullName), ref: sha, per_page: 100 }),
    ]);
    return combineCi(runs.data.check_runs, statuses.data, requiredChecks);
  }

  async setProjectStatus(installationId: number, projectId: string, contentNodeId: string, status: string) {
    const kit = this.kit(installationId);
    const project = await kit.graphql<{
      node: {
        field: { id: string; options: { id: string; name: string }[] } | null;
      };
    }>(
      `query($id: ID!) { node(id: $id) { ... on ProjectV2 { field(name: "Status") { ... on ProjectV2SingleSelectField { id options { id name } } } } } }`,
      { id: projectId },
    );
    const field = project.node.field;
    const option = field?.options.find((o) => o.name.toLowerCase() === status.toLowerCase());
    if (!field || !option) return;
    const added = await kit.graphql<{ addProjectV2ItemById: { item: { id: string } } }>(
      `mutation($p: ID!, $c: ID!) { addProjectV2ItemById(input: { projectId: $p, contentId: $c }) { item { id } } }`,
      { p: projectId, c: contentNodeId },
    );
    await kit.graphql(
      `mutation($p: ID!, $i: ID!, $f: ID!, $o: String!) { updateProjectV2ItemFieldValue(input: { projectId: $p, itemId: $i, fieldId: $f, value: { singleSelectOptionId: $o } }) { projectV2Item { id } } }`,
      { p: projectId, i: added.addProjectV2ItemById.item.id, f: field.id, o: option.id },
    );
  }
}
