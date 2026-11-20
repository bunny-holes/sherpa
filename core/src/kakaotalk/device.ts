import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { codes, SherpaError } from "../cli/errors.ts";
import { log } from "../log.ts";
import { runCommand } from "../process/runner.ts";
import { databaseName } from "./key-derivation.ts";
import { isDictionary, readPlistFile, type PlistValue } from "./plist.ts";

/**
 * What the local system says about the KakaoTalk Mac account, read from files
 * only: the app is never launched, activated or scripted.
 */

const containerData = () =>
  join(homedir(), "Library/Containers/com.kakao.KakaoTalkMac/Data/Library");
export const databaseDirectory = () =>
  join(containerData(), "Application Support/com.kakao.KakaoTalkMac");
const preferencesDirectory = () => join(containerData(), "Preferences");
const globalPreferences = () => join(homedir(), "Library/Preferences/com.kakao.KakaoTalkMac.plist");
const applicationInfo = "/Applications/KakaoTalk.app/Contents/Info.plist";

/** SHA-512("0"): the revision key KakaoTalk keeps for "no account". */
const emptyAccountHash =
  "31bca02094eb78126a517b206a88c73cfa9ec6f704c7030d18212cace820f025f00bf0ea68dbf3f3a5436ca63b53bf7bf80ad8d5de7d8359d0b7fed9dbc3ab99";
const revisionPrefix = "DESIGNATEDFRIENDSREVISION:";

/** The Mac's IOPlatformUUID, read from the I/O Registry. */
export async function platformUUID(): Promise<string> {
  const output = await runCommand("/usr/sbin/ioreg", ["-rd1", "-c", "IOPlatformExpertDevice"], {
    timeoutMs: 10_000,
  });
  const match =
    /"IOPlatformUUID" = "([0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12})"/.exec(
      new TextDecoder().decode(output.stdout),
    );
  if (!match) throw new SherpaError("kakaotalk.platform_uuid_unavailable");
  return match[1]!;
}

/**
 * Preference files in kakaocli's order: the hex-suffixed container plist(s), the
 * plain container plist, then the global one. Only existing files are returned.
 */
export function preferenceFiles(): string[] {
  const directory = preferencesDirectory();
  let suffixed: string[] = [];
  try {
    suffixed = readdirSync(directory)
      .filter((name) => /^com\.kakao\.KakaoTalkMac\.[0-9A-Fa-f]+\.plist$/.test(name))
      .sort()
      .map((name) => join(directory, name));
  } catch (error) {
    log.debug(
      `[adapter:kakaotalk:preferences] directory_readable=false error_type=${errorType(error)}`,
    );
  }
  return [...suffixed, join(directory, "com.kakao.KakaoTalkMac.plist"), globalPreferences()].filter(
    (path) => existsSync(path),
  );
}

export interface Preferences {
  /** Number of preference files that parsed as dictionaries. */
  fileCount: number;
  /** SHA-512 hex digests of the accounts whose revision value is non-zero. */
  activeAccountHashes: string[];
  /** Positive user ids a cheap strategy suggests, in kakaocli's strategy order. */
  candidateUserIds: string[];
}

export async function readPreferences(paths = preferenceFiles()): Promise<Preferences> {
  const dictionaries: { [key: string]: PlistValue }[] = [];
  for (const path of paths) {
    try {
      const value = await readPlistFile(path);
      if (isDictionary(value)) dictionaries.push(value);
    } catch (error) {
      log.warn(`[adapter:kakaotalk:preferences] parsed=false error_type=${errorType(error)}`);
    }
  }
  return preferencesFrom(dictionaries);
}

/** Extracts account hashes and cheap user-id candidates from parsed preference dictionaries. */
export function preferencesFrom(dictionaries: { [key: string]: PlistValue }[]): Preferences {
  const hashes = new Set<string>();
  const candidates: string[] = [];
  const addCandidate = (value: PlistValue | undefined) => {
    const id = positiveUserId(value);
    if (id && !candidates.includes(id)) candidates.push(id);
  };
  for (const plist of dictionaries) {
    for (const [key, value] of Object.entries(plist)) {
      if (!key.startsWith(revisionPrefix)) continue;
      const hash = key.slice(revisionPrefix.length).toLowerCase();
      if (!/^[0-9a-f]{128}$/.test(hash) || hash === emptyAccountHash) continue;
      if (
        typeof value === "number"
          ? Math.trunc(value) !== 0
          : typeof value === "bigint" && value !== 0n
      ) {
        hashes.add(hash);
      }
    }
    // kakaocli strategy 1: common suffix of FSChatWindowTransparency<userId> keys.
    addCandidate(commonSuffix(plist, "FSChatWindowTransparency"));
    // kakaocli strategy 2: direct keys.
    for (const key of ["userId", "user_id", "KAKAO_USER_ID", "userID"]) addCandidate(plist[key]);
    // kakaocli strategy 4: common suffix of FSChatWindowFrame_ window keys.
    addCandidate(commonSuffix(plist, "NSWindow Frame FSChatWindowFrame_"));
    // kakaocli fallback: AlertKakaoIDsList.
    const alertIDs = plist.AlertKakaoIDsList;
    if (Array.isArray(alertIDs)) alertIDs.forEach(addCandidate);
  }
  return {
    fileCount: dictionaries.length,
    activeAccountHashes: [...hashes].sort(),
    candidateUserIds: candidates,
  };
}

/** Canonical decimal text of a positive 64-bit user id, or null. */
export function positiveUserId(value: PlistValue | undefined): string | null {
  let text: string;
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) return null;
    text = String(value);
  } else if (typeof value === "bigint") {
    text = value.toString();
  } else if (typeof value === "string") {
    text = value.trim();
  } else {
    return null;
  }
  if (!/^[1-9][0-9]{0,18}$/.test(text) || BigInt(text) > 0x7fff_ffff_ffff_ffffn) return null;
  return text;
}

function commonSuffix(plist: { [key: string]: PlistValue }, prefix: string): string | null {
  const suffixes = Object.keys(plist)
    .filter((key) => key.startsWith(prefix))
    .map((key) => key.slice(prefix.length));
  if (suffixes.length < 2) return null;
  let length = 0;
  const first = suffixes[0]!;
  while (
    length < first.length &&
    suffixes.every(
      (suffix) => suffix.length > length && suffix.at(-1 - length) === first.at(-1 - length),
    )
  ) {
    length++;
  }
  return length > 0 ? first.slice(first.length - length) : null;
}

/** Encrypted database file names in the container: 78 lowercase hex characters, optionally `.db`. */
export function databaseFiles(directory = databaseDirectory()): string[] {
  try {
    return readdirSync(directory)
      .filter((name) => /^[0-9a-f]{78}(\.db)?$/.test(name))
      .sort()
      .map((name) => join(directory, name));
  } catch (error) {
    log.debug(
      `[adapter:kakaotalk:database-files] directory_readable=false error_type=${errorType(error)}`,
    );
    return [];
  }
}

/**
 * The database file for a user id: the derived name (or `.db`) when present,
 * otherwise the only 78-hex file in the container.
 */
export function databaseFile(
  userId: string,
  uuid: string,
  directory = databaseDirectory(),
): string | null {
  const name = databaseName(userId, uuid);
  for (const candidate of [join(directory, name), join(directory, `${name}.db`)]) {
    if (existsSync(candidate)) return candidate;
  }
  const files = databaseFiles(directory);
  return files.length === 1 ? files[0]! : null;
}

export function applicationInstalled(path = applicationInfo): boolean {
  return existsSync(path);
}

/** KakaoTalk.app's short version string from its Info.plist, or null when not installed. */
export async function applicationVersion(path = applicationInfo): Promise<string | null> {
  if (!existsSync(path)) return null;
  const info = await readPlistFile(path);
  if (!isDictionary(info)) throw new SherpaError(codes.failed);
  const version = info.CFBundleShortVersionString;
  return typeof version === "string" && /^[0-9A-Za-z.-]{1,32}$/.test(version) ? version : null;
}

export function errorType(error: unknown): string {
  if (error instanceof SherpaError) return error.code;
  return error instanceof Error ? error.name : typeof error;
}
