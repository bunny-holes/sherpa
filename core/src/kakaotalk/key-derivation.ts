import { createHash, pbkdf2Sync } from "node:crypto";

/**
 * KakaoTalk Mac database name and SQLCipher passphrase derivation, ported from
 * kakaocli 0.6.0 `KeyDerivation` (itself based on a public gist). Both depend
 * only on the account's user id and the Mac's IOPlatformUUID.
 */

function pbkdf2(password: string, salt: string): Buffer {
  return pbkdf2Sync(
    Buffer.from(password, "utf8"),
    Buffer.from(salt, "utf8"),
    100_000,
    128,
    "sha256",
  );
}

function reversed(value: string): string {
  return Array.from(value).reverse().join("");
}

/** Base64 of SHA-1 followed by SHA-256 of the UUID text. */
export function hashedDeviceUUID(uuid: string): string {
  const sha1 = createHash("sha1").update(uuid, "utf8").digest();
  const sha256 = createHash("sha256").update(uuid, "utf8").digest();
  return Buffer.concat([sha1, sha256]).toString("base64");
}

/** The 78-hex-character file name of the encrypted database, without extension. */
export function databaseName(userId: string, uuid: string): string {
  const password = [".", "F", userId, "A", "F", reversed(uuid), ".", "|"].join(".");
  const salt = reversed(hashedDeviceUUID(uuid));
  return pbkdf2(password, salt)
    .toString("hex")
    .slice(28, 28 + 78);
}

/** The SQLCipher passphrase (256 hex characters) passed to `PRAGMA key`. */
export function secureKey(userId: string, uuid: string): string {
  const characters = Array.from(uuid);
  const parts = [
    "A",
    hashedDeviceUUID(uuid),
    "|",
    "F",
    characters.slice(0, 5).join(""),
    "H",
    userId,
    "|",
    characters.slice(7).join(""),
  ];
  const salt = characters.slice(Math.trunc(characters.length * 0.3)).join("");
  return pbkdf2(reversed(parts.join("F")), salt).toString("hex");
}

/** Lowercase hex SHA-512 of the decimal user id: the form KakaoTalk keeps in its preferences. */
export function accountHash(userId: string): string {
  return createHash("sha512").update(userId, "utf8").digest("hex");
}
