/**
 * Serialised JSONL transcript writer. Extracted from the extension so the
 * ordering and flush behaviour can be tested without an extension host.
 */

export interface AppendFs {
  writeFile(path: string, content: string): Promise<void>;
  appendFile(path: string, content: string): Promise<void>;
}

export interface TranscriptWriter {
  path: string;
  /** Queued append; never blocks the extension host. */
  write(event: Record<string, unknown>): void;
  /** Resolves once every queued append has hit disk; rejects with the first append failure. */
  flush(): Promise<void>;
}

export function createTranscriptWriter(file: string, fs: AppendFs): TranscriptWriter {
  let firstError: unknown;
  const remember = (err: unknown): void => {
    if (firstError === undefined) firstError = err;
  };

  // Appends chain off the truncating create so events keep their order.
  let queue: Promise<unknown> = fs.writeFile(file, "").catch(remember);

  return {
    path: file,
    write(event) {
      queue = queue.then(() => fs.appendFile(file, JSON.stringify(event) + "\n")).catch(remember);
    },
    async flush() {
      await queue;
      if (firstError !== undefined) throw firstError;
    },
  };
}
