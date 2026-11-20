import type { PollEvent, PollVote } from "./poll.ts";
import {
  type AttachmentMeta,
  type Chat,
  type ChatInfo,
  isGroupHandle,
  type Message,
  type Reaction,
} from "./store.ts";
import { formatAppleSeconds } from "./time.ts";

/**
 * JSON line shapes of `imsg chats --json` and `imsg history --attachments
 * --json` (imsg 0.21.1, no Contacts lookups). Optional fields are omitted
 * when absent, as Swift's synthesized `Encodable` does. Keys are sorted so the
 * output is stable; imsg's own key order is random per process.
 */
type JSONObject = { [key: string]: unknown };

function compact(object: JSONObject): JSONObject {
  const result: JSONObject = {};
  for (const key of Object.keys(object).sort()) {
    const value = object[key];
    if (value !== null && value !== undefined) result[key] = value;
  }
  return result;
}

export function chatLine(chat: Chat, info: ChatInfo | null, participants: string[]): string {
  const identifier = info?.identifier ?? chat.identifier;
  const guid = info?.guid ?? "";
  return JSON.stringify(
    compact({
      id: chat.id,
      name: chat.name,
      identifier,
      service: info?.service ?? chat.service,
      last_message_at: formatAppleSeconds(chat.lastMessageAt),
      guid: guid === "" ? null : guid,
      display_name: info?.name,
      is_group: isGroupHandle(identifier, guid),
      participants,
      account_id: info?.accountID ?? chat.accountID,
      account_login: info?.accountLogin ?? chat.accountLogin,
      last_addressed_handle: info?.lastAddressedHandle ?? chat.lastAddressedHandle,
      unread_count: chat.unreadCount,
    }),
  );
}

function attachmentPayload(meta: AttachmentMeta): JSONObject {
  return compact({
    filename: meta.filename,
    transfer_name: meta.transferName,
    uti: meta.uti,
    mime_type: meta.mimeType,
    total_bytes: meta.totalBytes,
    is_sticker: meta.isSticker,
    original_path: meta.originalPath,
    missing: meta.missing,
  });
}

function reactionPayload(reaction: Reaction): JSONObject {
  return compact({
    id: reaction.rowID,
    type: reaction.type.name,
    emoji: reaction.type.emoji,
    sender: reaction.sender,
    is_from_me: reaction.isFromMe,
    created_at: formatAppleSeconds(reaction.date),
  });
}

function votePayload(vote: PollVote): JSONObject {
  return compact({
    option_id: vote.optionID,
    option_text: vote.optionText,
    participant: vote.participant,
    event_type: vote.eventType,
    server_time: vote.serverTime,
  });
}

const POLL_EVENTS = {
  created: "imessage.poll.created",
  vote: "imessage.poll.voted",
  unknown: "imessage.poll.unknown",
};

function pollPayload(poll: PollEvent): JSONObject {
  const metadata = poll.metadata;
  return compact({
    kind: poll.kind,
    event: POLL_EVENTS[poll.kind],
    poll_guid: poll.pollGUID,
    question: poll.question,
    options: poll.options?.map((option) => ({ id: option.id, text: option.text })),
    vote: poll.vote ? votePayload(poll.vote) : null,
    votes: poll.votes?.map(votePayload),
    original_guid: poll.originalGUID,
    creator: poll.creator,
    participants: poll.participants,
    metadata: metadata
      ? compact({
          bundle_id: metadata.bundleID,
          associated_message_type: metadata.associatedMessageType,
          payload_bytes: metadata.payloadBytes,
          summary_bytes: metadata.summaryBytes,
          url_scheme: metadata.urlScheme,
          url_host: metadata.urlHost,
          query_keys: metadata.queryKeys,
        })
      : null,
  });
}

export function messageLine(
  message: Message,
  info: ChatInfo | null,
  participants: string[],
  attachments: AttachmentMeta[],
  reactions: Reaction[],
): string {
  const identifier = info?.identifier ?? "";
  const guid = info?.guid ?? "";
  const unsent = message.unsentAt !== null;
  const read = message.isFromMe ? null : message.isRead;
  return JSON.stringify(
    compact({
      id: message.rowID,
      chat_id: message.chatID,
      guid: message.guid,
      reply_to_guid: message.replyToGUID,
      thread_originator_guid: message.threadOriginatorGUID,
      thread_originator_part: message.threadOriginatorPart,
      reply_to_text: message.replyToText,
      reply_to_sender: message.replyToSender,
      sender: message.sender,
      is_from_me: message.isFromMe,
      text: message.text,
      created_at: formatAppleSeconds(message.date),
      attachments: unsent ? [] : attachments.map(attachmentPayload),
      reactions: unsent ? [] : reactions.map(reactionPayload),
      destination_caller_id: message.destinationCallerID,
      balloon_bundle_id: message.balloonBundleID,
      url_preview: message.urlPreview
        ? {
            id: message.urlPreview.rowID,
            guid: message.urlPreview.guid,
            balloon_bundle_id: message.urlPreview.balloonBundleID,
            created_at: formatAppleSeconds(message.urlPreview.date),
          }
        : null,
      poll: message.poll ? pollPayload(message.poll) : null,
      is_read: read,
      date_read:
        read === true && message.dateRead !== null ? formatAppleSeconds(message.dateRead) : null,
      edited_at: message.editedAt === null ? null : formatAppleSeconds(message.editedAt),
      unsent_at: message.unsentAt === null ? null : formatAppleSeconds(message.unsentAt),
      chat_identifier: identifier,
      chat_guid: guid,
      chat_name: info?.name ?? "",
      participants,
      is_group: isGroupHandle(identifier, guid),
    }),
  );
}
