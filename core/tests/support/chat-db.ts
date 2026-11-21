import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

// Synthetic fixtures only: 555 numbers, example.com addresses, made-up guids.

/** The chat.db tables and columns Sherpa reads, as Messages names them. */
export function createChatSchema(db: Database): void {
  db.run(`CREATE TABLE chat (ROWID INTEGER PRIMARY KEY, guid TEXT, chat_identifier TEXT, display_name TEXT,
    service_name TEXT, account_id TEXT, account_login TEXT, last_addressed_handle TEXT)`);
  db.run("CREATE TABLE handle (ROWID INTEGER PRIMARY KEY, id TEXT, service TEXT)");
  db.run(`CREATE TABLE message (ROWID INTEGER PRIMARY KEY, guid TEXT, text TEXT, handle_id INTEGER, service TEXT,
    date INTEGER, is_from_me INTEGER DEFAULT 0, attributedBody BLOB, associated_message_guid TEXT,
    associated_message_type INTEGER DEFAULT 0, associated_message_emoji TEXT, destination_caller_id TEXT,
    is_audio_message INTEGER DEFAULT 0, thread_originator_guid TEXT, thread_originator_part TEXT,
    balloon_bundle_id TEXT, payload_data BLOB, message_summary_info BLOB, reply_to_guid TEXT,
    is_read INTEGER DEFAULT 0, date_read INTEGER DEFAULT 0, date_edited INTEGER DEFAULT 0,
    date_retracted INTEGER DEFAULT 0)`);
  db.run(
    "CREATE TABLE chat_message_join (chat_id INTEGER, message_id INTEGER, message_date INTEGER)",
  );
  db.run("CREATE TABLE chat_handle_join (chat_id INTEGER, handle_id INTEGER)");
  db.run(`CREATE TABLE attachment (ROWID INTEGER PRIMARY KEY, filename TEXT, transfer_name TEXT, uti TEXT,
    mime_type TEXT, total_bytes INTEGER, is_sticker INTEGER, user_info BLOB)`);
  db.run("CREATE TABLE message_attachment_join (message_id INTEGER, attachment_id INTEGER)");
}

export interface FixtureChat {
  id: number;
  guid: string;
  identifier: string;
  displayName: string | null;
  handles: string[];
}

/** Writes a chat.db at `path` with `chats` and no messages. */
export function writeChatDatabase(path: string, chats: readonly FixtureChat[]): void {
  mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path, { create: true });
  try {
    createChatSchema(db);
    const insertChat = db.query(
      "INSERT INTO chat (ROWID, guid, chat_identifier, display_name, service_name) VALUES (?, ?, ?, ?, 'iMessage')",
    );
    const insertHandle = db.query("INSERT INTO handle VALUES (?, ?, 'iMessage')");
    const join = db.query("INSERT INTO chat_handle_join VALUES (?, ?)");
    let handle = 0;
    for (const chat of chats) {
      insertChat.run(chat.id, chat.guid, chat.identifier, chat.displayName);
      for (const id of chat.handles) {
        insertHandle.run(++handle, id);
        join.run(chat.id, handle);
      }
    }
  } finally {
    db.close();
  }
}
