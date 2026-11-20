import { codes, SherpaError } from "../cli/errors.ts";

export type CommandEffect = "read" | "mutation";

export interface CommandOutput {
  stdout: Uint8Array;
  stderr: Uint8Array;
}

export interface RunOptions {
  stdin?: Uint8Array;
  timeoutMs?: number;
  outputLimit?: number;
  effect?: CommandEffect;
}

/**
 * Runs one external command with a fixed argv, bounded input, output and time.
 * The child inherits only PATH. Once a mutation command holds its input, any
 * failure is `uncertain`, never a failure that reads as "nothing happened".
 */
export async function runCommand(
  executable: string,
  args: readonly string[],
  options: RunOptions = {},
): Promise<CommandOutput> {
  const { stdin = new Uint8Array(), timeoutMs = 30_000, outputLimit = 4 * 1024 * 1024 } = options;
  const effect = options.effect ?? "read";
  if (stdin.byteLength > 2 * 1024 * 1024 || outputLimit <= 0) {
    throw new SherpaError(codes.invalidRequest);
  }
  let child: ReturnType<typeof Bun.spawn<"pipe", "pipe", "pipe">>;
  try {
    child = Bun.spawn([executable, ...args], {
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
      env: { PATH: process.env.PATH ?? "/usr/bin:/bin" },
      // Its own process group, so a timeout also stops grandchildren that hold the pipes.
      detached: true,
    });
  } catch {
    throw new SherpaError(codes.executableUnavailable);
  }
  const stop = () => {
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch {
      child.kill("SIGKILL");
    }
  };
  let timedOut = false;
  try {
    await child.stdin.write(stdin);
    await child.stdin.end();
    const timer = setTimeout(() => {
      timedOut = true;
      stop();
    }, timeoutMs);
    const [stdout, stderr] = await Promise.all([
      collect(child.stdout, outputLimit, stop),
      collect(child.stderr, 64 * 1024, stop),
    ]);
    const exitCode = await child.exited;
    clearTimeout(timer);
    if (timedOut) throw new SherpaError(codes.timedOut);
    if (stdout === null || stderr === null) throw new SherpaError(codes.outputTooLarge);
    if (exitCode !== 0) throw new SherpaError(codes.failed);
    return { stdout, stderr };
  } catch (error) {
    if (effect === "mutation") throw new SherpaError(codes.uncertain, { mayHaveApplied: true });
    throw error;
  }
}

/** Reads a stream up to `limit` bytes; returns null (after `onOverflow`) when it is larger. */
async function collect(
  stream: ReadableStream<Uint8Array>,
  limit: number,
  onOverflow: () => void,
): Promise<Uint8Array | null> {
  const chunks: Uint8Array[] = [];
  let total = 0;
  for await (const chunk of stream) {
    total += chunk.byteLength;
    if (total > limit) {
      onOverflow();
      return null;
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
