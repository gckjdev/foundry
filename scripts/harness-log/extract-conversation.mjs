#!/usr/bin/env node
// Extract conversation history from a harness log / Claude Code SDK transcript.
//
// The log is a stream of `===== <ts> <LABEL> =====` sections (a Foundry harness log) or raw
// Claude Code SDK stream-json. Each section/message holds one JSON object. This script reconstructs
// the agent's conversation: it groups the log into sessions, then prints each session's assistant
// text, tool calls and (optionally) thinking, in order.
//
// Usage:
//   node extract-conversation.mjs <file|jobId> [--session review|work|<index>|<cwd-substring>]
//                                 [--thinking] [--tool-results] [--max-text N] [--json]
//
//   <file|jobId>  a path to a harness log / transcript, or a job UUID (resolved to the default
//                 Foundry log path ~/.foundry/jobs/<id>.harness.log).

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const MARKER = /^===== (.*) =====$/;
const DEFAULT_LOG_DIR = join(homedir(), ".foundry", "jobs");
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ---- argument handling ---------------------------------------------------------------------

function parseArgs(argv) {
  const opts = { file: null, session: null, thinking: false, toolResults: false, maxText: 600, json: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--session") opts.session = argv[++i];
    else if (a === "--max-text") opts.maxText = Number(argv[++i]);
    else if (a === "--thinking") opts.thinking = true;
    else if (a === "--tool-results") opts.toolResults = true;
    else if (a === "--json") opts.json = true;
    else if (!a.startsWith("--")) opts.file = a;
  }
  if (!opts.file) {
    console.error("usage: extract-conversation.mjs <file|jobId> [--session review|work|<index>|<substr>] [--thinking] [--tool-results] [--max-text N] [--json]");
    process.exit(2);
  }
  return opts;
}

function resolvePath(input) {
  if (UUID.test(input)) {
    const p = join(DEFAULT_LOG_DIR, `${input}.harness.log`);
    if (existsSync(p)) return p;
  }
  if (existsSync(input)) return input;
  // Fall back to a glob-less prefix match for convenience.
  if (input.endsWith(".harness.log") || input.includes("/")) return input;
  return join(DEFAULT_LOG_DIR, `${input}.harness.log`);
}

// ---- parsing -------------------------------------------------------------------------------

function parseSections(content) {
  const sections = [];
  let cur = null;
  let body = [];
  for (const line of content.split("\n")) {
    const m = line.match(MARKER);
    if (m) {
      if (cur) sections.push({ ...cur, body: body.join("\n") });
      const [ts, ...label] = m[1].split(" ");
      cur = { ts, label: label.join(" ") };
      body = [];
    } else if (cur) {
      body.push(line);
    }
  }
  if (cur) sections.push({ ...cur, body: body.join("\n") });
  return sections;
}

function tryJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** Tag a session from its prompt heading, not from any one framework's stage names. */
function classifySession(systemPrompt) {
  const head = (systemPrompt ?? "").split("\n", 1)[0].toLowerCase();
  return head.includes("review") ? "review" : "work";
}

function truncate(s, n) {
  if (s == null) return "";
  const t = String(s).replace(/\s+/g, " ").trim();
  return t.length > n ? t.slice(0, n) + "…" : t;
}

/** A one-line summary of a tool call's key input, by tool name. */
function summarizeTool(name, input = {}) {
  switch (name) {
    case "Skill": return `Skill(${input.skill ?? "?"})`;
    case "Bash": return truncate(input.command, 120);
    case "Read": return `Read ${truncate(input.file_path, 100)}`;
    case "Edit": return `Edit ${truncate(input.file_path, 100)}`;
    case "Write": return `Write ${truncate(input.file_path, 100)}`;
    case "Grep": return `Grep ${truncate(input.pattern, 60)} in ${truncate(input.path, 60)}`;
    case "Glob": return `Glob ${truncate(input.pattern, 80)}`;
    case "Task": return `Task: ${truncate(input.description ?? input.prompt, 90)}`;
    case "Agent": return `Agent(${truncate(input.description, 90)})`;
    case "AskUserQuestion": return `Ask: ${truncate(input.questions?.[0]?.question, 90)}`;
    case "ToolSearch": return `ToolSearch: ${truncate(input.query, 80)}`;
    case "mcp__foundry__review":
      return `review: verdict=${input.verdict ?? "?"} risk=${input.risk?.level ?? "?"}`;
    case "mcp__foundry__stage": return `stage(${input.name ?? input.to ?? input.stage ?? "?"})`;
    case "mcp__foundry__ask": return `ask: ${truncate(input.prompt, 90)}`;
    case "mcp__foundry__confidence": return `confidence(${input.level ?? "?"})`;
    case "mcp__foundry__evidence": return `evidence: ${input.name ?? "?"} (${input.status ?? "?"})`;
    case "mcp__foundry__plan": return "plan";
    case "mcp__foundry__run_checks": return "run_checks";
    default: return name;
  }
}

/** Extract the conversation from one assistant/user message. */
function extractMessage(msg) {
  const out = [];
  for (const c of msg?.message?.content ?? []) {
    if (c.type === "text" && c.text?.trim()) out.push({ kind: "text", text: c.text.trim() });
    else if (c.type === "tool_use") out.push({ kind: "tool", name: c.name, input: c.input ?? {} });
    else if (c.type === "thinking" && c.thinking?.trim()) out.push({ kind: "thinking", text: c.thinking.trim() });
  }
  return out;
}

// ---- main ----------------------------------------------------------------------------------

const opts = parseArgs(process.argv.slice(2));
const path = resolvePath(opts.file);
if (!existsSync(path)) {
  console.error(`log file not found: ${path}`);
  process.exit(1);
}

const content = readFileSync(path, "utf8");
const sections = parseSections(content);

const sessions = [];
let current = null;

for (const sec of sections) {
  if (sec.label === "REQUEST query") {
    const q = tryJson(sec.body);
    const systemPrompt = q?.systemPrompt ?? "";
    current = {
      ts: sec.ts,
      systemPrompt,
      cwd: null,
      type: "main",
      prompt: q?.prompt ?? "",
      items: [],
    };
    sessions.push(current);
    if (systemPrompt) current.items.push({ kind: "system", text: systemPrompt });
    if (q?.prompt) current.items.push({ kind: "user", text: q.prompt });
  } else if (sec.label === "REQUEST start" || sec.label === "REQUEST resume") {
    const q = tryJson(sec.body);
    if (current && q?.prompt) current.items.push({ kind: "user", text: q.prompt });
  } else if (sec.label === "CLAUDE message" && current) {
    const m = tryJson(sec.body);
    if (!m) continue;
    if (m.type === "system" && m.subtype === "init" && m.cwd) current.cwd = m.cwd;
    else if (m.type === "assistant") {
      current.items.push(...extractMessage(m));
    } else if (m.type === "user" && opts.toolResults) {
      for (const c of m.message?.content ?? []) {
        if (c.type === "tool_result" && c.content) {
          const text = Array.isArray(c.content)
            ? c.content.map((b) => b.text ?? "").join(" ")
            : c.content;
          if (text?.trim()) current.items.push({ kind: "user", text: truncate(text, opts.maxText) });
        }
      }
    }
  }
}

// Finalize session tags now that the system prompt is known.
for (const s of sessions) s.type = classifySession(s.systemPrompt);

const filtered = opts.session
  ? sessions.filter(
      (s) =>
        s.type === opts.session ||
        String(sessions.indexOf(s) + 1) === opts.session ||
        ((s.cwd ?? "").split("/").pop() ?? "").includes(opts.session),
    )
  : sessions;

if (opts.json) {
  console.log(JSON.stringify(filtered, null, 2));
  process.exit(0);
}

const time = (iso) => (iso ? iso.slice(11, 19) : "??:??:??");
const base = (p) => (p ? p.split("/").pop() : "?");

console.log(`harness log: ${path}`);
console.log(`${sessions.length} session(s)${opts.session ? ` (filter: ${opts.session})` : ""}\n`);

for (const s of filtered) {
  console.log(`── Session ${sessions.indexOf(s) + 1} · ${s.type} · ${time(s.ts)} · ${base(s.cwd)}`);
  for (const it of s.items) {
    if (it.kind === "system") {
      console.log(`  [system prompt] ${truncate(it.text, opts.maxText)}`);
    } else if (it.kind === "user") {
      console.log(`  [user] ${truncate(it.text, opts.maxText)}`);
    } else if (it.kind === "text") {
      console.log(`  [assistant] ${truncate(it.text, opts.maxText)}`);
    } else if (it.kind === "tool") {
      console.log(`  [tool_call] ${summarizeTool(it.name, it.input)}`);
    } else if (it.kind === "thinking" && opts.thinking) {
      console.log(`  [thinking] ${truncate(it.text, opts.maxText)}`);
    }
  }
  console.log("");
}
