export interface DirentLike {
  name: string;
  isDirectory(): boolean;
  isFile(): boolean;
  isSymbolicLink(): boolean;
}

export interface StatLike {
  isDirectory(): boolean;
  isFile(): boolean;
  isSymbolicLink(): boolean;
  size: number;
  mtimeMs: number;
  ino?: number;
  dev?: number;
}

/**
 * Read-only filesystem abstraction.
 * Completely lacks mutating primitives (no writeFile, unlink, mkdir, rmdir, etc.).
 */
export interface ReadonlyFs {
  stat(path: string): Promise<StatLike | null>;
  lstat(path: string): Promise<StatLike | null>;
  readFile(path: string): Promise<Buffer | null>;
  readText(path: string): Promise<string | null>;
  readdir(path: string): Promise<DirentLike[]>;
  readlink(path: string): Promise<string | null>;
  realpath(path: string): Promise<string | null>;
  exists(path: string): Promise<boolean>;
}

export interface Env {
  home: string;
  platform: NodeJS.Platform;
  vars: Readonly<Record<string, string | undefined>>;
  cwd: string;
  managedRoot?: string;
  fs: ReadonlyFs;
  which(cmd: string): Promise<string | null>;
  exec?(cmd: string, args: string[], timeoutMs: number): Promise<{ stdout: string; code: number }>;
}
