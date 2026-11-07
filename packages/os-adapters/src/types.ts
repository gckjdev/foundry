export type OsName = "macos" | "linux";

export interface ExecResult {
  code: number;
  stdout: string;
  stderr: string;
}

export type Exec = (
  cmd: string,
  args: string[],
  opts?: { input?: string; timeoutMs?: number },
) => Promise<ExecResult>;

export interface MachineInfo {
  os: OsName;
  osVersion: string;
  arch: string;
  cpu: number;
  memMb: number;
}

export interface SecretStore {
  readonly kind: string;
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
}

export interface ServiceSpec {
  /** Absolute path of the `foundry` binary. */
  binaryPath: string;
  args: string[];
  /** "system": boot-time daemon running as `user`; "user": per-login agent for the current user. */
  mode: "system" | "user";
  user: string;
  workDir: string;
  logDir: string;
}

export interface ServiceInstall {
  /** File to write, with contents. */
  path: string;
  contents: string;
  /** Commands that activate it (run with sudo for system mode). */
  activate: string[][];
  deactivate: string[][];
}

export interface ResourceLimits {
  memMb?: number;
  /** 100 = one full core. */
  cpuPercent?: number;
}

export interface SleepInhibitor {
  release(): void;
}

/** Everything OS-specific the runner needs (spec 5.9); one implementation per OS. */
export interface OsAdapter {
  readonly os: OsName;
  info(): Promise<MachineInfo>;
  diskFreeMb(path: string): Promise<number>;
  /** null when unknown (e.g. a VM without power info). Desktops report true. */
  onAcPower(): Promise<boolean | null>;
  /** Seconds since the last keyboard or mouse input; null on headless machines. */
  idleSeconds(): Promise<number | null>;
  inhibitSleep(reason: string): Promise<SleepInhibitor>;
  service(spec: ServiceSpec): ServiceInstall;
  /** Commands that create the dedicated, unprivileged `foundry` user. */
  createUserCommands(user: string, home: string): string[][];
  secrets(): Promise<SecretStore>;
  /** Prefix a job command so it runs with the given limits where the OS supports them. */
  wrapWithLimits(argv: string[], limits: ResourceLimits): Promise<string[]>;
}
