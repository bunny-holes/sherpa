import {
  isBinaryPlist,
  isPlistDictionary,
  PlistUID,
  type PlistValue,
  tryParseBinaryPlist,
} from "../plist/plist.ts";

/**
 * Native iMessage polls (`com.apple.messages.Polls`). The poll itself sits in
 * a `data:` URL inside the message's keyed-archive `payload_data`; this scans
 * the payload the way imsg 0.21.1 does and reports what it finds.
 */
export const POLLS_BUNDLE_IDENTIFIER = "com.apple.messages.Polls";
export const UPDATE_ASSOCIATED_MESSAGE_TYPE = 2;
export const VOTE_ASSOCIATED_MESSAGE_TYPE = 4000;

export interface PollOption {
  id: string;
  text: string;
}

export interface PollVote {
  optionID: string;
  optionText: string | null;
  participant: string | null;
  eventType: string | null;
  serverTime: string | null;
}

export interface PollMetadata {
  bundleID: string | null;
  associatedMessageType: number | null;
  payloadBytes: number | null;
  summaryBytes: number | null;
  urlScheme: string | null;
  urlHost: string | null;
  queryKeys: string[] | null;
}

export type PollKind = "created" | "vote" | "unknown";

export interface PollEvent {
  kind: PollKind;
  pollGUID: string | null;
  question: string | null;
  options: PollOption[] | null;
  vote: PollVote | null;
  votes: PollVote[] | null;
  originalGUID: string | null;
  creator: string | null;
  participants: string[] | null;
  metadata: PollMetadata | null;
}

export function isPollsBalloonBundleID(value: string): boolean {
  if (value === "") return false;
  return value === POLLS_BUNDLE_IDENTIFIER || value.split(":").at(-1) === POLLS_BUNDLE_IDENTIFIER;
}

export function isPollCandidate(
  balloonBundleID: string,
  associatedMessageType: number | null,
): boolean {
  return (
    isPollsBalloonBundleID(balloonBundleID) ||
    associatedMessageType === VOTE_ASSOCIATED_MESSAGE_TYPE
  );
}

export function normalizedAssociatedGUID(guid: string): string | null {
  if (guid === "") return null;
  const slash = guid.lastIndexOf("/");
  if (slash < 0 || slash === guid.length - 1) return guid;
  return guid.slice(slash + 1);
}

function pollEvent(kind: PollKind, fields: Partial<Omit<PollEvent, "kind">> = {}): PollEvent {
  const options = fields.options?.length ? fields.options : null;
  const votes = fields.votes?.length ? fields.votes : null;
  const participants = fields.participants?.length ? fields.participants : null;
  return {
    kind,
    pollGUID: fields.pollGUID ?? null,
    question: fields.question ?? null,
    options,
    vote: fields.vote ?? null,
    votes,
    originalGUID: fields.originalGUID ?? null,
    creator: fields.creator ?? null,
    participants,
    metadata: fields.metadata ?? null,
  };
}

export const pollWithQuestion = (poll: PollEvent, question: string): PollEvent =>
  pollEvent(poll.kind, { ...poll, question });

export function resolveVoteOptionTexts(poll: PollEvent, texts: Map<string, string>): PollEvent {
  if (poll.kind !== "vote" || texts.size === 0) return poll;
  const resolve = (vote: PollVote): PollVote => {
    const text = texts.get(vote.optionID);
    return vote.optionText === null && text ? { ...vote, optionText: text } : vote;
  };
  return pollEvent(poll.kind, {
    ...poll,
    vote: poll.vote ? resolve(poll.vote) : null,
    votes: poll.votes?.map(resolve) ?? null,
  });
}

export function resolvePollReference(
  poll: PollEvent,
  pollGUID: string | null,
  originalGUID: string | null,
): PollEvent {
  if (poll.pollGUID === pollGUID && poll.originalGUID === originalGUID) return poll;
  return pollEvent(poll.kind, { ...poll, pollGUID, originalGUID });
}

const trim = (value: string): string => value.replace(/^\p{White_Space}+|\p{White_Space}+$/gu, "");

const firstNonEmpty = (...values: (string | null | undefined)[]): string | null =>
  values.find((value): value is string => typeof value === "string" && value !== "") ?? null;

function sortedUnique(values: string[]): string[] | null {
  const filtered = values.map(trim).filter((value) => value !== "");
  if (filtered.length === 0) return null;
  return [...new Set(filtered)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

export interface PollRow {
  balloonBundleID: string;
  payloadData: Uint8Array;
  messageSummaryInfo: Uint8Array;
  associatedMessageType: number | null;
  associatedMessageGUID: string;
  messageGUID: string;
  sender: string;
}

export function decodePoll(row: PollRow): PollEvent | null {
  const isPollBundle = isPollsBalloonBundleID(row.balloonBundleID);
  const isVoteAssociation = row.associatedMessageType === VOTE_ASSOCIATED_MESSAGE_TYPE;
  if (!isPollBundle && !isVoteAssociation) return null;

  const scan = scanPayload(row.payloadData, row.messageSummaryInfo);
  const facts = collectFacts(scan.objects);
  const hasPollURLHint = [scan.urlScheme, scan.urlHost].some((value) =>
    value?.toLowerCase().includes("poll"),
  );
  const hasEvidence = facts.votes.length > 0 || facts.hasEmptyVotes || hasPollURLHint;
  if (!isPollBundle && !hasEvidence) return null;

  const metadata: PollMetadata = {
    bundleID: row.balloonBundleID === "" ? null : row.balloonBundleID,
    associatedMessageType: row.associatedMessageType,
    payloadBytes: row.payloadData.byteLength === 0 ? null : row.payloadData.byteLength,
    summaryBytes:
      row.messageSummaryInfo.byteLength === 0 ? null : row.messageSummaryInfo.byteLength,
    urlScheme: scan.urlScheme,
    urlHost: scan.urlHost,
    queryKeys:
      scan.queryKeys.size === 0
        ? null
        : [...scan.queryKeys].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)),
  };
  const originalGUID = normalizedAssociatedGUID(row.associatedMessageGUID);
  const senderHandle = row.sender === "" ? null : row.sender;
  const votes = facts.votes.map((vote) => ({
    ...vote,
    participant: vote.participant ?? senderHandle,
  }));
  const participantHandles = [...facts.participants];
  if (facts.creator !== null) participantHandles.push(facts.creator);
  for (const vote of votes)
    if (vote.participant !== null) participantHandles.push(vote.participant);
  const participants = sortedUnique(participantHandles);

  if (isVoteAssociation || votes.length > 0) {
    return pollEvent(votes.length === 0 && !facts.hasEmptyVotes ? "unknown" : "vote", {
      pollGUID: firstNonEmpty(facts.pollGUID, originalGUID, row.messageGUID),
      question: facts.question,
      options: facts.options,
      vote: votes[0] ?? null,
      votes,
      originalGUID,
      creator: facts.creator,
      participants,
      metadata,
    });
  }
  if (facts.question !== null || facts.options.length > 0) {
    const creator = facts.creator ?? senderHandle;
    const creationParticipants = [...participantHandles];
    if (creator !== null) creationParticipants.push(creator);
    return pollEvent("created", {
      pollGUID: firstNonEmpty(facts.pollGUID, row.messageGUID),
      question: facts.question,
      options: facts.options,
      originalGUID:
        row.associatedMessageType === UPDATE_ASSOCIATED_MESSAGE_TYPE ? originalGUID : null,
      creator,
      participants: sortedUnique(creationParticipants),
      metadata,
    });
  }
  return pollEvent("unknown", {
    pollGUID: firstNonEmpty(facts.pollGUID, originalGUID, row.messageGUID),
    originalGUID,
    creator: facts.creator,
    participants,
    metadata,
  });
}

// MARK: payload scan

type Scanned = unknown;

interface ParsedURL {
  raw: string;
  scheme: string;
  host: string | null;
  query: string | null;
}

const MAX_DEPTH = 32;
const MAX_NODES = 20_000;

function scanPayload(payloadData: Uint8Array, summaryData: Uint8Array) {
  const objects: Scanned[] = [...objectsFrom(payloadData), ...objectsFrom(summaryData)];
  const facts = {
    strings: [] as string[],
    urls: [] as ParsedURL[],
    data: [] as Uint8Array[],
    visited: 0,
  };

  const collect = (value: Scanned, depth: number): void => {
    if (depth >= MAX_DEPTH || facts.visited >= MAX_NODES) return;
    facts.visited += 1;
    if (typeof value === "string") facts.strings.push(value);
    else if (value instanceof Uint8Array) facts.data.push(value);
    else if (Array.isArray(value)) for (const child of value) collect(child, depth + 1);
    else if (isPlistDictionary(value))
      for (const child of Object.values(value)) collect(child, depth + 1);
  };

  for (const object of objects) collect(object, 0);
  const nested = facts.data.flatMap((data) => objectsFrom(data));
  objects.push(...nested);
  for (const object of nested) collect(object, 0);
  for (const string of facts.strings) {
    const url = parseURL(string);
    if (url) facts.urls.push(url);
  }

  let urlScheme: string | null = null;
  let urlHost: string | null = null;
  const queryKeys = new Set<string>();
  for (const url of facts.urls) {
    urlScheme ??= url.scheme;
    urlHost ??= url.host;
    const payload = dataURLPayload(url);
    if (payload !== null) objects.push(...embeddedObjects(payload));
    if (url.query === null) continue;
    for (const item of url.query.split("&")) {
      const equals = item.indexOf("=");
      const name = equals < 0 ? item : item.slice(0, equals);
      queryKeys.add(removingPercentEncoding(name) ?? name);
      if (equals < 0) continue;
      const value = item.slice(equals + 1);
      objects.push(...embeddedObjects(removingPercentEncoding(value) ?? value));
    }
  }
  return { objects, urlScheme, urlHost, queryKeys };
}

function objectsFrom(data: Uint8Array): Scanned[] {
  if (data.byteLength === 0) return [];
  const objects: Scanned[] = [];
  if (isBinaryPlist(data)) {
    const plist = tryParseBinaryPlist(data);
    if (plist !== undefined) {
      objects.push(plist);
      const resolved = resolveKeyedArchive(plist);
      if (resolved !== undefined) objects.push(resolved);
    }
  }
  let text: string | null = null;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(data);
  } catch {
    text = null;
  }
  if (text !== null) {
    const json = parseJSONContainer(text);
    if (json !== undefined) objects.push(json);
    objects.push(text, ...embeddedObjects(text));
  }
  return objects;
}

function embeddedObjects(value: string): Scanned[] {
  const decoded = removingPercentEncoding(value) ?? value;
  const objects: Scanned[] = [];
  const json = parseJSONContainer(decoded);
  if (json !== undefined) objects.push(json);
  const data = base64Data(decoded);
  if (data) objects.push(...objectsFrom(data));
  return objects;
}

/** JSONSerialization without fragments: only an object or array at the top. */
function parseJSONContainer(text: string): unknown {
  const start = text.trimStart()[0];
  if (start !== "{" && start !== "[") return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

const graphemes = new Intl.Segmenter("en", { granularity: "grapheme" });

/** Swift `String.count`: extended grapheme clusters. */
function graphemeCount(value: string): number {
  let count = 0;
  for (const _ of graphemes.segment(value)) count += 1;
  return count;
}

function base64Data(value: string): Uint8Array | null {
  const compact = trim(value);
  if (graphemeCount(compact) < 8 || !/^[A-Za-z0-9+/_=-]+$/.test(compact)) return null;
  let normalized = compact.replaceAll("-", "+").replaceAll("_", "/");
  if (normalized.length % 4 > 0) normalized += "=".repeat(4 - (normalized.length % 4));
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(normalized)) return null;
  return new Uint8Array(Buffer.from(normalized, "base64"));
}

/** `String.removingPercentEncoding`: null when a sequence is malformed or not UTF-8. */
export function removingPercentEncoding(value: string): string | null {
  if (!value.includes("%")) return value;
  const bytes: number[] = [];
  const encoder = new TextEncoder();
  for (let index = 0; index < value.length;) {
    if (value[index] === "%") {
      const hex = value.slice(index + 1, index + 3);
      if (!/^[0-9A-Fa-f]{2}$/.test(hex)) return null;
      bytes.push(Number.parseInt(hex, 16));
      index += 3;
      continue;
    }
    const codePoint = value.codePointAt(index)!;
    const char = String.fromCodePoint(codePoint);
    bytes.push(...encoder.encode(char));
    index += char.length;
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(new Uint8Array(bytes));
  } catch {
    return null;
  }
}

function parseURL(value: string): ParsedURL | null {
  const trimmed = trim(value);
  if (graphemeCount(trimmed) > 65_536) return null;
  const match = /^([A-Za-z][A-Za-z0-9+.-]*):(.*)$/s.exec(trimmed);
  if (!match) return null;
  const rest = match[2]!;
  let host: string | null = null;
  if (rest.startsWith("//")) {
    const authority = rest.slice(2).split(/[/?#]/, 1)[0]!;
    const hostPort = authority.slice(authority.lastIndexOf("@") + 1);
    const name = hostPort.startsWith("[")
      ? hostPort.slice(1, hostPort.indexOf("]"))
      : hostPort.replace(/:\d*$/, "");
    host = name === "" ? null : (removingPercentEncoding(name) ?? name);
  }
  const hash = rest.indexOf("#");
  const beforeFragment = hash < 0 ? rest : rest.slice(0, hash);
  const question = beforeFragment.indexOf("?");
  return {
    raw: trimmed,
    scheme: match[1]!,
    host,
    query: question < 0 ? null : beforeFragment.slice(question + 1),
  };
}

function dataURLPayload(url: ParsedURL): string | null {
  if (url.scheme.toLowerCase() !== "data") return null;
  const comma = url.raw.indexOf(",");
  if (comma < 0) return null;
  const tail = url.raw.slice(comma + 1);
  const end = tail.search(/[?#]/);
  const payload = end < 0 ? tail : tail.slice(0, end);
  if (payload === "") return null;
  return removingPercentEncoding(payload) ?? payload;
}

/** Flattens an NSKeyedArchiver plist into plain values, as imsg's resolver does. */
function resolveKeyedArchive(plist: PlistValue): PlistValue | undefined {
  if (!isPlistDictionary(plist)) return undefined;
  const objects = plist.$objects;
  const top = plist.$top;
  if (!Array.isArray(objects) || !isPlistDictionary(top)) return undefined;
  const rootUID =
    top.root instanceof PlistUID
      ? top.root.value
      : (Object.values(top).find((value): value is PlistUID => value instanceof PlistUID)?.value ??
        null);
  if (rootUID === null) return undefined;
  const seen = new Set<number>();

  const resolveObject = (index: number, depth: number): PlistValue | undefined => {
    if (index <= 0 || index >= objects.length || depth >= MAX_DEPTH || seen.has(index))
      return undefined;
    seen.add(index);
    try {
      return resolveValue(objects[index]!, depth + 1);
    } finally {
      seen.delete(index);
    }
  };

  const resolveValue = (value: PlistValue, depth: number): PlistValue | undefined => {
    if (value instanceof PlistUID) return resolveObject(value.value, depth + 1);
    if (!isPlistDictionary(value)) {
      if (Array.isArray(value)) {
        return value
          .map((child) => resolveValue(child, depth + 1))
          .filter((child) => child !== undefined);
      }
      return value;
    }
    if ("NS.relative" in value) {
      const relative = resolveValue(value["NS.relative"]!, depth + 1);
      const resolvedRelative = typeof relative === "string" ? relative : undefined;
      const base = "NS.base" in value ? resolveValue(value["NS.base"]!, depth + 1) : undefined;
      if (typeof base === "string" && resolvedRelative !== undefined && URL.canParse(base)) {
        return URL.canParse(resolvedRelative, base)
          ? new URL(resolvedRelative, base).href
          : resolvedRelative;
      }
      return resolvedRelative;
    }
    const keys = value["NS.keys"];
    const values = value["NS.objects"];
    if (Array.isArray(keys) && Array.isArray(values)) {
      const result: { [key: string]: PlistValue } = {};
      for (let index = 0; index < Math.min(keys.length, values.length); index += 1) {
        const key = resolveValue(keys[index]!, depth + 1);
        if (typeof key !== "string") continue;
        const resolved = resolveValue(values[index]!, depth + 1);
        if (resolved !== undefined) result[key] = resolved;
      }
      return result;
    }
    if (Array.isArray(values)) {
      return values
        .map((child) => resolveValue(child, depth + 1))
        .filter((child) => child !== undefined);
    }
    const result: { [key: string]: PlistValue } = {};
    for (const [key, child] of Object.entries(value)) {
      if (key === "$class" || key === "$classes" || key === "$classname") continue;
      const resolved = resolveValue(child, depth + 1);
      if (resolved !== undefined) result[key] = resolved;
    }
    return result;
  };

  return resolveObject(rootUID, 0);
}

// MARK: facts

interface Facts {
  question: string | null;
  options: PollOption[];
  votes: PollVote[];
  hasEmptyVotes: boolean;
  pollGUID: string | null;
  creator: string | null;
  participants: string[];
}

type Dictionary = { [key: string]: unknown };

const isDictionary = (value: unknown): value is Dictionary => isPlistDictionary(value);

/** `NSNumber.stringValue` for the number shapes JSON and plists produce. */
function numberString(value: unknown): string | null {
  if (typeof value === "boolean") return value ? "1" : "0";
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : null;
  return null;
}

function stringValue(dict: Dictionary, keys: string[]): string | null {
  for (const key of keys) {
    if (!(key in dict)) continue;
    const value = dict[key];
    if (typeof value === "string") {
      const trimmed = trim(value);
      if (trimmed !== "") return trimmed;
      continue;
    }
    const number = numberString(value);
    if (number !== null) return number;
  }
  return null;
}

function firstArray(dict: Dictionary, keys: string[]): unknown[] | null {
  for (const key of keys) {
    const value = dict[key];
    if (Array.isArray(value) && value.length > 0) return value;
  }
  return null;
}

function stringArrayValue(dict: Dictionary, keys: string[]): string[] | null {
  for (const key of keys) {
    const value = dict[key];
    if (!Array.isArray(value)) continue;
    const strings = value
      .filter((item): item is string => typeof item === "string")
      .map(trim)
      .filter(Boolean);
    if (strings.length > 0) return strings;
  }
  return null;
}

function option(value: unknown): PollOption | null {
  if (typeof value === "string") {
    const trimmed = trim(value);
    return trimmed === "" ? null : { id: trimmed, text: trimmed };
  }
  if (!isDictionary(value)) return null;
  const text = stringValue(value, ["pollOptionText", "text", "title", "label", "value"]);
  const identifier = stringValue(value, [
    "optionIdentifier",
    "identifier",
    "id",
    "optionID",
    "optionId",
    "option_id",
  ]);
  if (text === null) return null;
  return { id: identifier ?? text, text };
}

function vote(value: unknown): PollVote | null {
  if (!isDictionary(value)) return null;
  const optionID = stringValue(value, [
    "voteOptionIdentifier",
    "optionID",
    "optionId",
    "option_id",
  ]);
  if (optionID === null) return null;
  let removal: string | null = null;
  for (const key of ["removed", "isRemoved", "isRemoval"]) {
    const flag = value[key];
    if (
      flag === true ||
      (typeof flag === "number" && flag !== 0) ||
      (typeof flag === "bigint" && flag !== 0n)
    ) {
      removal = "removed";
      break;
    }
  }
  return {
    optionID,
    optionText: null,
    participant: stringValue(value, [
      "participantHandle",
      "participant",
      "participantIdentifier",
      "handle",
      "sender",
    ]),
    eventType: stringValue(value, ["eventType", "type", "action"]) ?? removal ?? "selected",
    serverTime: stringValue(value, ["serverVoteTime", "serverTime", "timestamp"]),
  };
}

function collectFacts(objects: Scanned[]): Facts {
  const facts: Facts = {
    question: null,
    options: [],
    votes: [],
    hasEmptyVotes: false,
    pollGUID: null,
    creator: null,
    participants: [],
  };
  const optionIDs = new Set<string>();
  const voteKeys = new Set<string>();
  let visited = 0;

  const visit = (value: unknown, depth: number): void => {
    if (depth >= MAX_DEPTH || visited >= MAX_NODES) return;
    visited += 1;
    if (isDictionary(value)) {
      facts.question ??= stringValue(value, ["question", "title", "prompt", "pollQuestion"]);
      facts.pollGUID ??= stringValue(value, [
        "pollGUID",
        "pollGuid",
        "pollIdentifier",
        "pollID",
        "pollId",
        "poll_guid",
      ]);
      facts.creator ??= stringValue(value, [
        "creatorHandle",
        "creator",
        "creatorIdentifier",
        "createdBy",
      ]);
      if (facts.creator !== null) facts.participants.push(facts.creator);
      const list = stringArrayValue(value, [
        "participants",
        "participantHandles",
        "participantIdentifiers",
      ]);
      if (list) facts.participants.push(...list);

      const rawOptions = firstArray(value, [
        "orderedPollOptions",
        "pollOptions",
        "options",
        "choices",
      ]);
      for (const item of rawOptions ?? []) {
        const parsed = option(item);
        if (parsed && !optionIDs.has(parsed.id)) {
          optionIDs.add(parsed.id);
          facts.options.push(parsed);
        }
      }

      const rawVotes = firstArray(value, ["votes", "pollVotes", "responses"]);
      let parsedVotes: PollVote[] = [];
      if (rawVotes)
        parsedVotes = rawVotes.map(vote).filter((item): item is PollVote => item !== null);
      else if ("voteOptionIdentifier" in value) {
        const single = vote(value);
        if (single) parsedVotes = [single];
      }
      if (parsedVotes.length > 0) {
        for (const item of parsedVotes) {
          const key = `${item.optionID}\u001f${item.participant ?? ""}`;
          if (voteKeys.has(key)) continue;
          voteKeys.add(key);
          facts.votes.push(item);
        }
        for (const item of parsedVotes)
          if (item.participant !== null) facts.participants.push(item.participant);
      } else if (
        ["votes", "pollVotes", "responses"].some(
          (key) => Array.isArray(value[key]) && (value[key] as unknown[]).length === 0,
        )
      ) {
        facts.hasEmptyVotes = true;
      }

      for (const child of Object.values(value)) visit(child, depth + 1);
      return;
    }
    if (Array.isArray(value)) for (const child of value) visit(child, depth + 1);
  };

  for (const object of objects) visit(object, 0);
  return facts;
}
