import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "vite-plus/test";
import { SherpaError } from "../src/cli/errors.ts";
import { journaled, JournaledMutationError, MutationJournal } from "../src/journal/journal.ts";

let dir: string;
let journal: MutationJournal;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "sherpa-journal-"));
  journal = new MutationJournal(join(dir, "native.sqlite3"));
});
afterEach(() => {
  journal.close();
  rmSync(dir, { recursive: true, force: true });
});

test("a completed send is journaled completed", async () => {
  const result = await journaled(journal, "imessage.send", async () => "ok");
  expect(result.journalFailure).toBeNull();
  expect(journal.recent(1)[0]).toMatchObject({
    operation_id: result.operationID,
    status: "completed",
  });
});

test("a send rejected before dispatch is journaled failed", async () => {
  const error = await journaled(journal, "imessage.send", async () => {
    throw new SherpaError("invalidRequest");
  }).catch((e: unknown) => e);
  expect(error).toBeInstanceOf(JournaledMutationError);
  expect((error as JournaledMutationError).status).toBe("failed");
  expect(journal.recent(1)[0]).toMatchObject({
    status: "failed",
    stable_error_code: "invalidRequest",
  });
});

test("a send that may have applied is journaled uncertain", async () => {
  const error = (await journaled(journal, "mail.send", async () => {
    throw new SherpaError("uncertain", { mayHaveApplied: true });
  }).catch((e: unknown) => e)) as JournaledMutationError;
  expect(error.status).toBe("uncertain");
  expect(journal.recent(1)[0]?.status).toBe("uncertain");
});

test("a terminal row accepts no second transition", () => {
  const id = journal.start("imessage.send");
  journal.finish(id, "uncertain", "uncertain");
  expect(() => journal.finish(id, "completed", null)).toThrow(SherpaError);
});

test("an accepted send whose journal finish fails stays completed and says so", async () => {
  const result = await journaled(journal, "imessage.send", async () => {
    journal.close();
    return "ok";
  });
  expect(result.output).toBe("ok");
  expect(result.journalFailure).toBe("journal.finish_failed");
  journal = new MutationJournal(join(dir, "native.sqlite3"));
  expect(journal.recent(1)[0]?.status).toBe("started");
});

test("nothing is attempted when the journal cannot start", async () => {
  journal.close();
  let attempted = false;
  const error = (await journaled(journal, "imessage.send", async () => {
    attempted = true;
  }).catch((e: unknown) => e)) as JournaledMutationError;
  expect(attempted).toBe(false);
  expect(error.stableCode).toBe("journal.start_failed");
  journal = new MutationJournal(join(dir, "native.sqlite3"));
});
