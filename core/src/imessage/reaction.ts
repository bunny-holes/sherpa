/**
 * Tapback mapping for `message.associated_message_type`: 2000-2006 add a
 * reaction, 3000-3006 remove it, and 2006 carries a custom emoji.
 */
export interface ReactionType {
  name: string;
  emoji: string;
}

const STANDARD: Record<number, ReactionType> = {
  2000: { name: "love", emoji: "❤️" },
  2001: { name: "like", emoji: "👍" },
  2002: { name: "dislike", emoji: "👎" },
  2003: { name: "laugh", emoji: "😂" },
  2004: { name: "emphasis", emoji: "‼️" },
  2005: { name: "question", emoji: "❓" },
};

export const isReactionAdd = (value: number): boolean => value >= 2000 && value <= 2006;
export const isReactionRemove = (value: number): boolean => value >= 3000 && value <= 3006;
export const isReaction = (value: number | null): boolean =>
  value !== null && (isReactionAdd(value) || isReactionRemove(value));

/** SQL predicate that matches reaction rows in the given column. */
export const reactionPredicate = (column: string): string =>
  `(${column} BETWEEN 2000 AND 2006 OR ${column} BETWEEN 3000 AND 3006)`;

export const nonReactionPredicate = (column: string): string =>
  `(${column} IS NULL OR NOT ${reactionPredicate(column)})`;

export function reactionType(rawValue: number, customEmoji: string | null): ReactionType | null {
  if (rawValue === 2006)
    return customEmoji === null ? null : { name: "custom", emoji: customEmoji };
  return STANDARD[rawValue] ?? null;
}

export const sameReactionType = (a: ReactionType | null, b: ReactionType | null): boolean =>
  a !== null && b !== null && a.name === b.name && a.emoji === b.emoji;

const graphemes = new Intl.Segmenter("en", { granularity: "grapheme" });
const EMOJI = /\p{Emoji}/u;

/** Emoji of a custom reaction from text like `Reacted 🎉 to "original message"`. */
export function extractCustomEmoji(text: string): string | null {
  const reacted = text.indexOf("Reacted ");
  if (reacted >= 0) {
    const start = reacted + "Reacted ".length;
    const to = text.indexOf(" to ", start);
    if (to >= 0) {
      const emoji = text.slice(start, to);
      if (emoji !== "") return emoji;
    }
  }
  for (const { segment } of graphemes.segment(text)) {
    if (EMOJI.test(segment)) return segment;
  }
  return null;
}
