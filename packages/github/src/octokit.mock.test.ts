import { generateKeyPairSync } from "node:crypto";
import { type Dispatcher, getGlobalDispatcher, MockAgent, setGlobalDispatcher } from "undici";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { OctokitGitHubClient } from "./octokit";

const ref = { installationId: 7, fullName: "acme/app" };

const issue = {
  number: 1,
  node_id: "I_1",
  title: "Bug",
  body: "details",
  user: { login: "alice" },
  labels: [{ name: "bug" }, "extra"],
  state: "open",
};

const closedIssue = {
  number: 3,
  node_id: "I_3",
  title: "Closed",
  body: null,
  user: null,
  labels: ["", { name: "" }, { name: "done" }],
  state: "closed",
};

const openPr = {
  number: 4,
  html_url: "https://github.com/acme/app/pull/4",
  head: { sha: "abc123" },
  state: "open",
  merged: false,
  merged_at: null,
};

const mergedPr = {
  number: 6,
  html_url: "https://github.com/acme/app/pull/6",
  head: { sha: "fff" },
  state: "closed",
  merged: null,
  merged_at: "2020-01-01T00:00:00Z",
};

function privateKey(): string {
  const { privateKey: key } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  return key.export({ type: "pkcs1", format: "pem" }).toString();
}

async function text(body: unknown): Promise<string> {
  if (typeof body === "string") return body;
  if (body instanceof Uint8Array) return Buffer.from(body).toString("utf8");
  if (body && typeof body === "object" && Symbol.asyncIterator in body) {
    const chunks: Buffer[] = [];
    for await (const chunk of body as AsyncIterable<Uint8Array | string>) chunks.push(Buffer.from(chunk));
    return Buffer.concat(chunks).toString("utf8");
  }
  if (Array.isArray(body)) return (await Promise.all(body.map((chunk) => text(chunk)))).join("");
  if (body == null) return "";
  if (typeof body === "object") return JSON.stringify(body);
  return String(body);
}

function json(statusCode: number, data: object | string) {
  return {
    statusCode,
    data,
    responseOptions: { headers: { "content-type": "application/json" } },
  };
}

type ProjectMode = "missing" | "nomatch" | "ok";

describe("OctokitGitHubClient via MockAgent", () => {
  let previous: Dispatcher;
  let agent: MockAgent;
  let client: OctokitGitHubClient;
  let projectMode: ProjectMode = "ok";
  const calls: string[] = [];
  const ghesCalls: string[] = [];

  beforeAll(() => {
    previous = getGlobalDispatcher();
    agent = new MockAgent();
    agent.disableNetConnect();
    setGlobalDispatcher(agent);
    agent
      .get("https://api.github.com")
      .intercept({ path: () => true, method: () => true })
      .reply(async (opts) => reply(opts.method, opts.path, await text(opts.body)))
      .persist();
    agent
      .get("https://github.example.com")
      .intercept({ path: () => true, method: () => true })
      .reply(async (opts) => {
        const pathname = (opts.path.split("?")[0] ?? opts.path).replace(/\/$/, "");
        ghesCalls.push(`${opts.method} ${pathname}`);
        if (opts.method === "GET" && pathname === "/api/v3/app/installations") return json(200, []);
        return json(500, { message: `unmocked ${opts.method} ${opts.path}` });
      })
      .persist();
    client = new OctokitGitHubClient({ appId: 99, privateKey: privateKey() });
  });

  afterAll(async () => {
    setGlobalDispatcher(previous);
    await agent.close();
  });

  function reply(method: string, path: string, body: string) {
    const pathname = (path.split("?")[0] ?? path).replace(/\/$/, "");
    const query = path.includes("?") ? path.slice(path.indexOf("?") + 1) : "";
    calls.push(`${method} ${pathname}${query ? `?${query}` : ""}`);

    if (method === "POST" && pathname === "/app/installations/7/access_tokens") {
      return json(201, { token: "ghs_test", expires_at: "2099-01-01T00:00:00Z" });
    }
    if (method === "GET" && pathname === "/app/installations") {
      return json(200, [
        { id: 1, account: { login: "acme", type: "Organization" } },
        { id: 2, account: { slug: "ent", type: "Enterprise" } },
        { id: 3, account: null },
      ]);
    }
    if (method === "GET" && pathname === "/installation/repositories") {
      return json(200, {
        total_count: 1,
        repositories: [{ id: 42, full_name: "acme/app", default_branch: "main" }],
      });
    }
    if (method === "GET" && pathname === "/repos/acme/app/issues/1") return json(200, issue);
    if (method === "GET" && pathname === "/repos/acme/app/issues/3") return json(200, closedIssue);
    if (method === "GET" && pathname === "/repos/acme/app/issues/404") {
      return json(404, { message: "Not Found" });
    }
    if (method === "GET" && pathname === "/repos/acme/app/issues") {
      return json(200, [issue, { ...issue, number: 2, pull_request: { url: "https://example.test/2" } }]);
    }
    if (method === "POST" && pathname === "/repos/acme/app/issues/1/comments") {
      const sent = JSON.parse(body) as { body?: string };
      return json(201, { id: 9, body: sent.body ?? "", user: { login: "foundry" } });
    }
    if (method === "PATCH" && pathname === "/repos/acme/app/issues/comments/9") return json(200, { id: 9 });
    if (method === "GET" && pathname === "/repos/acme/app/issues/comments/9") {
      return json(200, { id: 9, body: "note", user: null });
    }
    if (method === "POST" && pathname === "/repos/acme/app/issues/1/labels") return json(200, []);
    if (method === "DELETE" && pathname === "/repos/acme/app/issues/1/labels/bug") return json(200, {});
    if (method === "DELETE" && pathname === "/repos/acme/app/issues/1/labels/missing") {
      return json(404, { message: "Not Found" });
    }
    if (method === "DELETE" && pathname === "/repos/acme/app/issues/1/labels/boom") {
      return json(500, { message: "nope" });
    }
    if (method === "GET" && pathname === "/repos/acme/app/labels/foundry") {
      return json(200, { name: "foundry", color: "ededed" });
    }
    if (method === "GET" && pathname === "/repos/acme/app/labels/fresh") {
      return json(404, { message: "Not Found" });
    }
    if (method === "GET" && pathname === "/repos/acme/app/labels/broken") {
      return json(500, { message: "nope" });
    }
    if (method === "POST" && pathname === "/repos/acme/app/labels") return json(201, { name: "fresh" });
    if (method === "GET" && pathname === "/repos/acme/app/contents/README.md") {
      return json(200, {
        type: "file",
        encoding: "base64",
        content: Buffer.from("hello\n").toString("base64"),
        sha: "sha1",
      });
    }
    if (method === "GET" && pathname === "/repos/acme/app/contents/dir") {
      return json(200, [{ type: "file", name: "a.ts", path: "dir/a.ts", sha: "x" }]);
    }
    if (method === "GET" && pathname === "/repos/acme/app/contents/link") {
      return json(200, { type: "submodule", sha: "sub" });
    }
    if (method === "GET" && pathname === "/repos/acme/app/contents/missing") {
      return json(404, { message: "Not Found" });
    }
    if (method === "GET" && pathname === "/repos/acme/app/contents/explode") {
      return json(500, { message: "nope" });
    }
    if (method === "GET" && pathname === "/repos/acme/app/branches/main") {
      return json(200, { name: "main", commit: { sha: "branchsha" } });
    }
    if (method === "GET" && pathname === "/repos/acme/app/branches/gone") {
      return json(404, { message: "Not Found" });
    }
    if (method === "GET" && pathname === "/repos/acme/app/branches/bad") {
      return json(500, { message: "nope" });
    }
    if (method === "GET" && pathname === "/repos/acme/app/pulls") {
      if (query.includes("none")) return json(200, []);
      if (query.includes("merged")) return json(200, [mergedPr]);
      return json(200, [openPr]);
    }
    if (method === "GET" && pathname === "/repos/acme/app/pulls/4") return json(200, openPr);
    if (method === "GET" && pathname === "/repos/acme/app/pulls/6") return json(200, mergedPr);
    if (method === "POST" && pathname === "/repos/acme/app/pulls") return json(201, openPr);
    if (method === "PATCH" && pathname === "/repos/acme/app/pulls/4") return json(200, openPr);
    if (method === "GET" && pathname === "/repos/acme/app/pulls/4/files") {
      return json(200, [{ filename: "a.ts", additions: 2, deletions: 1, patch: "@@" }]);
    }
    if (method === "GET" && pathname === "/repos/acme/app/pulls/4/reviews") {
      return json(200, [{ id: 8, user: { login: "bob" }, state: "APPROVED", body: "lgtm" }]);
    }
    if (method === "POST" && pathname === "/repos/acme/app/pulls/4/requested_reviewers") return json(201, {});
    if (method === "PUT" && pathname === "/repos/acme/app/pulls/4/merge") return json(200, { merged: true });
    if (method === "GET" && pathname === "/repos/acme/app/commits/abc/check-runs") {
      return json(200, { check_runs: [{ name: "test", status: "completed", conclusion: "success" }] });
    }
    if (method === "GET" && pathname === "/repos/acme/app/commits/abc/statuses") {
      return json(200, [{ context: "lint", state: "success" }]);
    }
    if (method === "GET" && pathname === "/repos/acme/app/commits/none/check-runs") {
      return json(200, { check_runs: [] });
    }
    if (method === "GET" && pathname === "/repos/acme/app/commits/none/statuses") return json(200, []);
    if (method === "GET" && pathname === "/repos/acme/app/commits/bad/check-runs") {
      return json(200, { check_runs: [{ name: "test", status: "completed", conclusion: "failure" }] });
    }
    if (method === "GET" && pathname === "/repos/acme/app/commits/bad/statuses") return json(200, []);
    if (method === "POST" && pathname === "/graphql") {
      const queryText = (JSON.parse(body) as { query?: string }).query ?? "";
      if (queryText.includes('field(name: "Status")')) {
        if (projectMode === "missing") return json(200, { data: { node: { field: null } } });
        const name = projectMode === "ok" ? "In Progress" : "Done";
        return json(200, {
          data: { node: { field: { id: "FIELD", options: [{ id: "OPT", name }] } } },
        });
      }
      if (queryText.includes("addProjectV2ItemById")) {
        return json(200, { data: { addProjectV2ItemById: { item: { id: "ITEM" } } } });
      }
      if (queryText.includes("updateProjectV2ItemFieldValue")) {
        return json(200, { data: { updateProjectV2ItemFieldValue: { projectV2Item: { id: "ITEM" } } } });
      }
    }
    return json(500, { message: `unmocked ${method} ${path}` });
  }

  it("lists installations, including accounts without a login", async () => {
    await expect(client.listAppInstallations()).resolves.toEqual([
      { id: 1, accountLogin: "acme", accountType: "Organization" },
      { id: 2, accountLogin: "", accountType: "Enterprise" },
      { id: 3, accountLogin: "", accountType: "" },
    ]);
  });

  it("passes a GHES baseUrl through to Octokit and app auth", async () => {
    const ghes = new OctokitGitHubClient({
      appId: 99,
      privateKey: privateKey(),
      baseUrl: "https://github.example.com/api/v3",
    });
    await expect(ghes.listAppInstallations()).resolves.toEqual([]);
    expect(ghesCalls).toContain("GET /api/v3/app/installations");
  });

  it("mints an installation token and lists repos", async () => {
    await expect(client.installationToken(7)).resolves.toEqual({
      token: "ghs_test",
      expiresAt: "2099-01-01T00:00:00Z",
    });
    await expect(client.listInstallationRepos(7)).resolves.toEqual([
      { id: 42, fullName: "acme/app", defaultBranch: "main" },
    ]);
  });

  it("reads, lists, and comments on issues", async () => {
    await expect(client.getIssue(ref, 1)).resolves.toMatchObject({
      number: 1,
      author: "alice",
      labels: ["bug", "extra"],
      state: "open",
    });
    await expect(client.getIssue(ref, 3)).resolves.toEqual({
      number: 3,
      nodeId: "I_3",
      title: "Closed",
      body: "",
      author: "",
      labels: ["done"],
      state: "closed",
    });
    await expect(client.listIssues(ref, { labels: ["bug"], state: "open" })).resolves.toHaveLength(1);
    await expect(client.createComment(ref, 1, "hello")).resolves.toEqual({
      id: 9,
      body: "hello",
      author: "foundry",
    });
    await expect(client.updateComment(ref, 9, "edited")).resolves.toBeUndefined();
    await expect(client.getComment(ref, 9)).resolves.toEqual({ id: 9, body: "note", author: "" });
    await expect(client.getIssue(ref, 404)).rejects.toThrow();
    await expect(client.getIssue({ ...ref, fullName: "nope" }, 1)).rejects.toThrow(/Invalid repo name/);
  });

  it("adds, removes, and ensures labels", async () => {
    const before = calls.length;
    await client.addLabels(ref, 1, []);
    expect(calls.length).toBe(before);
    await expect(client.addLabels(ref, 1, ["bug"])).resolves.toBeUndefined();
    await expect(client.removeLabel(ref, 1, "bug")).resolves.toBeUndefined();
    await expect(client.removeLabel(ref, 1, "missing")).resolves.toBeUndefined();
    await expect(client.removeLabel(ref, 1, "boom")).rejects.toThrow();
    await expect(client.ensureLabel(ref, "foundry", "ededed")).resolves.toBeUndefined();
    await expect(client.ensureLabel(ref, "fresh", "0e8a16", "new")).resolves.toBeUndefined();
    await expect(client.ensureLabel(ref, "broken", "000000")).rejects.toThrow();
    expect(calls.some((call) => call.startsWith("POST /repos/acme/app/labels"))).toBe(true);
  });

  it("reads files and branch shas, swallowing 404s", async () => {
    await expect(client.getFile(ref, "README.md")).resolves.toEqual({ content: "hello\n", sha: "sha1" });
    await expect(client.getFile(ref, "dir")).resolves.toBeNull();
    await expect(client.getFile(ref, "link")).resolves.toBeNull();
    await expect(client.getFile(ref, "missing", "main")).resolves.toBeNull();
    await expect(client.getFile(ref, "explode")).rejects.toThrow();
    await expect(client.getBranchSha(ref, "main")).resolves.toBe("branchsha");
    await expect(client.getBranchSha(ref, "gone")).resolves.toBeNull();
    await expect(client.getBranchSha(ref, "bad")).rejects.toThrow();
  });

  it("opens, updates, reviews, and merges pull requests", async () => {
    await expect(client.findPullRequest(ref, "none")).resolves.toBeNull();
    await expect(client.findPullRequest(ref, "feature")).resolves.toMatchObject({
      number: 4,
      state: "open",
      merged: false,
      headSha: "abc123",
    });
    await expect(client.findPullRequest(ref, "merged")).resolves.toMatchObject({
      number: 6,
      state: "closed",
      merged: true,
    });
    await expect(client.getPullRequest(ref, 4)).resolves.toMatchObject({ number: 4, url: openPr.html_url });
    await expect(
      client.createPullRequest(ref, { head: "feature", base: "main", title: "T", body: "B", draft: true }),
    ).resolves.toMatchObject({ number: 4 });
    await expect(client.updatePullRequest(ref, 4, { title: "T2" })).resolves.toBeUndefined();
    await expect(client.listPullRequestFiles(ref, 4)).resolves.toEqual([
      { filename: "a.ts", additions: 2, deletions: 1, patch: "@@" },
    ]);
    await expect(client.listReviews(ref, 4)).resolves.toEqual([
      { id: 8, author: "bob", state: "APPROVED", body: "lgtm" },
    ]);
    const before = calls.length;
    await client.requestReviewers(ref, 4, [], []);
    expect(calls.length).toBe(before);
    await expect(client.requestReviewers(ref, 4, ["bob"], ["devs"])).resolves.toBeUndefined();
    await expect(client.mergePullRequest(ref, 4, "squash")).resolves.toBeUndefined();
  });

  it("combines check runs and statuses", async () => {
    await expect(client.ciState(ref, "abc")).resolves.toBe("success");
    await expect(client.ciState(ref, "abc", ["e2e"])).resolves.toBe("pending");
    await expect(client.ciState(ref, "none")).resolves.toBe("none");
    await expect(client.ciState(ref, "bad")).resolves.toBe("failure");
  });

  it("sets a project status and returns when the field or option is missing", async () => {
    projectMode = "missing";
    await expect(client.setProjectStatus(7, "PVT", "I_1", "In Progress")).resolves.toBeUndefined();
    projectMode = "nomatch";
    await expect(client.setProjectStatus(7, "PVT", "I_1", "In Progress")).resolves.toBeUndefined();
    projectMode = "ok";
    const start = calls.length;
    await client.setProjectStatus(7, "PVT", "I_1", "in progress");
    const graphql = calls.slice(start).filter((call) => call.startsWith("POST /graphql"));
    expect(graphql).toHaveLength(3);
  });
});
