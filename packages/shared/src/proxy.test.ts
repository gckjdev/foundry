import { describe, expect, it } from "vitest";
import {
  applyHttpProxyEnv,
  gitProxyArgs,
  hostMatchesNoProxy,
  httpProxyEnv,
  loadHttpProxyFromEnvFile,
  normalizeHttpProxy,
  redactProxyUrl,
  resolveHttpProxy,
  resolveNoProxy,
  shouldUseHttpProxy,
} from "./proxy";

describe("http proxy config", () => {
  it("prefers FOUNDRY_HTTP_PROXY over HTTPS_PROXY", () => {
    const env = { FOUNDRY_HTTP_PROXY: "http://127.0.0.1:8118", HTTPS_PROXY: "http://127.0.0.1:9999" };
    expect(resolveHttpProxy({ env })).toBe("http://127.0.0.1:8118");
  });

  it("falls back to HTTPS_PROXY, then HTTP_PROXY, then runner config", () => {
    expect(resolveHttpProxy({ env: { HTTPS_PROXY: "http://127.0.0.1:1" } })).toBe("http://127.0.0.1:1");
    expect(resolveHttpProxy({ env: { HTTP_PROXY: "http://127.0.0.1:2" } })).toBe("http://127.0.0.1:2");
    expect(resolveHttpProxy({ env: {}, fallback: "127.0.0.1:8118" })).toBe("http://127.0.0.1:8118");
  });

  it("does not call system detection when a custom env is passed", () => {
    expect(resolveHttpProxy({ env: {} })).toBeUndefined();
    expect(
      resolveHttpProxy({
        env: {},
        detectSystemProxy: () => "http://10.0.0.1:8080",
      }),
    ).toBe("http://10.0.0.1:8080");
  });

  it("adds http:// when the value has no scheme", () => {
    expect(normalizeHttpProxy("127.0.0.1:8118")).toBe("http://127.0.0.1:8118");
  });

  it("redacts userinfo", () => {
    expect(redactProxyUrl("http://user:secret@127.0.0.1:8118")).toBe("http://***:***@127.0.0.1:8118/");
  });

  it("skips localhost even if a proxy is set", () => {
    const env = { FOUNDRY_HTTP_PROXY: "http://127.0.0.1:8118" };
    expect(shouldUseHttpProxy("http://localhost:3000/api/runner/join", { env })).toBe(false);
    expect(shouldUseHttpProxy("https://api.github.com/user", { env })).toBe(true);
    expect(shouldUseHttpProxy("https://api.deepseek.com/v1", { env })).toBe(true);
  });

  it("honors FOUNDRY_NO_PROXY / NO_PROXY", () => {
    const env = { FOUNDRY_HTTP_PROXY: "http://127.0.0.1:8118", FOUNDRY_NO_PROXY: "localhost,github.com" };
    expect(shouldUseHttpProxy("https://api.github.com/user", { env })).toBe(false);
    expect(shouldUseHttpProxy("https://example.com/", { env })).toBe(true);
    expect(resolveNoProxy(env)).toBe("localhost,github.com");
  });

  it("matches no_proxy suffixes", () => {
    expect(hostMatchesNoProxy("api.github.com", "github.com")).toBe(true);
    expect(hostMatchesNoProxy("example.com", "github.com")).toBe(false);
  });

  it("writes standard proxy env for child processes and git -c flags", () => {
    const env = { FOUNDRY_HTTP_PROXY: "http://127.0.0.1:8118" };
    expect(httpProxyEnv({ env })).toMatchObject({
      HTTPS_PROXY: "http://127.0.0.1:8118",
      HTTP_PROXY: "http://127.0.0.1:8118",
      NODE_USE_ENV_PROXY: "1",
    });
    expect(gitProxyArgs({ env })).toEqual([
      "-c",
      "http.proxy=http://127.0.0.1:8118",
      "-c",
      "https.proxy=http://127.0.0.1:8118",
      "-c",
      "http.version=HTTP/1.1",
    ]);
  });

  it("applyHttpProxyEnv fills standard vars on the target env", () => {
    const env: NodeJS.ProcessEnv = { FOUNDRY_HTTP_PROXY: "http://127.0.0.1:8118" };
    expect(applyHttpProxyEnv({ env })).toBe("http://127.0.0.1:8118");
    expect(env.HTTPS_PROXY).toBe("http://127.0.0.1:8118");
    expect(env.NO_PROXY).toBe("localhost,127.0.0.1,::1");
  });

  it("loads only proxy keys from a .env body without overriding", () => {
    const env: NodeJS.ProcessEnv = { HTTPS_PROXY: "http://already:1", AUTH_SECRET: "keep" };
    loadHttpProxyFromEnvFile(
      [
        "# comment",
        "FOUNDRY_HTTP_PROXY=http://127.0.0.1:8118",
        "HTTPS_PROXY=http://ignored:9",
        "AUTH_SECRET=nope",
        "FOUNDRY_NO_PROXY=localhost",
      ].join("\n"),
      env,
    );
    expect(env.FOUNDRY_HTTP_PROXY).toBe("http://127.0.0.1:8118");
    expect(env.HTTPS_PROXY).toBe("http://already:1");
    expect(env.FOUNDRY_NO_PROXY).toBe("localhost");
    expect(env.AUTH_SECRET).toBe("keep");
  });
});
