import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { SecretStore } from "./types";

/**
 * AES-256-GCM encrypted JSON file with its key in a separate 0600 file, both owned by the runner
 * user. Used on Linux when systemd-creds is unavailable, and for tests.
 */
export class FileSecretStore implements SecretStore {
  readonly kind = "encrypted-file";
  private readonly file: string;
  private readonly keyFile: string;

  constructor(dir: string) {
    this.file = join(dir, "secrets.enc");
    this.keyFile = join(dir, "secrets.key");
  }

  private async key(): Promise<Buffer> {
    try {
      return Buffer.from(await readFile(this.keyFile, "utf8"), "base64");
    } catch {
      await mkdir(dirname(this.keyFile), { recursive: true, mode: 0o700 });
      const key = randomBytes(32);
      await writeFile(this.keyFile, key.toString("base64"), { mode: 0o600 });
      await chmod(this.keyFile, 0o600);
      return key;
    }
  }

  private async load(): Promise<Record<string, string>> {
    let raw: Buffer;
    try {
      raw = await readFile(this.file);
    } catch {
      return {};
    }
    const key = await this.key();
    const iv = raw.subarray(0, 12);
    const tag = raw.subarray(12, 28);
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    const plain = Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]);
    return JSON.parse(plain.toString("utf8")) as Record<string, string>;
  }

  private async save(data: Record<string, string>): Promise<void> {
    const key = await this.key();
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    const enc = Buffer.concat([cipher.update(JSON.stringify(data), "utf8"), cipher.final()]);
    await writeFile(this.file, Buffer.concat([iv, cipher.getAuthTag(), enc]), { mode: 0o600 });
  }

  async get(k: string) {
    return (await this.load())[k] ?? null;
  }

  async set(k: string, v: string) {
    const data = await this.load();
    data[k] = v;
    await this.save(data);
  }

  async delete(k: string) {
    const data = await this.load();
    delete data[k];
    await this.save(data);
  }
}
