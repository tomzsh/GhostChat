/**
 * Animated ASCII emote frame catalog (terminal vibe).
 * Wire only carries the emote id — frames are local.
 */
import type { AsciiEmojiId } from "@ghostchat/shared";
import { ASCII_EMOJI_IDS } from "@ghostchat/shared";

export type AsciiEmojiDef = {
  id: AsciiEmojiId;
  label: string;
  /** Short chip label in picker */
  chip: string;
  frames: string[];
  /** ms per frame */
  tickMs: number;
};

const catalog: Record<AsciiEmojiId, AsciiEmojiDef> = {
  wave: {
    id: "wave",
    label: "wave",
    chip: "👋",
    tickMs: 140,
    frames: [
      "  (·_·)  \n  <)  )╯ \n  /   \\  ",
      "  (·_·)  \n  <)  )╮ \n  /   \\  ",
      "  (·_·)  \n  <)  )╯ \n  /   \\  ",
      "  (·o·)  \n  <)  )╮ \n  /   \\  ",
    ],
  },
  heart: {
    id: "heart",
    label: "heart",
    chip: "♥",
    tickMs: 160,
    frames: [
      "  .::.  .::.  \n ::::::::::::::\n '::::::::::::'\n   '::::::::'  \n     '::::'    \n       ''      ",
      "  .::.  .::.  \n ::::♥:::::::::\n '::::::::::::'\n   '::::::::'  \n     '::::'    \n       ''      ",
      "  .♥.  .♥.    \n ::::::::::::::\n '::::♥:::::::'\n   '::::::::'  \n     '::::'    \n       ''      ",
      "  .::.  .::.  \n ::::::::::::::\n '::::::::::::'\n   '::♥:::::'  \n     '::::'    \n       ''      ",
    ],
  },
  fire: {
    id: "fire",
    label: "fire",
    chip: "🔥",
    tickMs: 120,
    frames: [
      "    )    \n   ) \\   \n  /   \\  \n (  ^  ) \n  \\___/  ",
      "   (     \n  / (    \n  \\   \\  \n (  ^  ) \n  \\___/  ",
      "    )    \n   / )   \n  /   \\  \n (  *  ) \n  \\___/  ",
      "   (     \n  ( \\    \n  \\   /  \n (  ^  ) \n  \\___/  ",
    ],
  },
  ghost: {
    id: "ghost",
    label: "ghost",
    chip: "👻",
    tickMs: 150,
    frames: [
      "   .-.   \n  (o o)  \n  | O |  \n  |   |  \n  '~~~'  ",
      "   .-.   \n  (o o)  \n  | O |  \n  |   |  \n  '~~~'  ",
      "   .-.   \n  (- -)  \n  | O |  \n  |   |  \n  '~~~'  ",
      "  .-.    \n (o o)   \n | O |   \n |   |   \n '~~~'   ",
    ],
  },
  lol: {
    id: "lol",
    label: "lol",
    chip: "lol",
    tickMs: 130,
    frames: [
      "  (＾▽＾)  \n  L O L   ",
      "  (＾▽＾)  \n   LOL    ",
      "  (*▽*)   \n  L O L   ",
      "  (＾▽＾)  \n  ha ha   ",
    ],
  },
  thumbsup: {
    id: "thumbsup",
    label: "thumbs up",
    chip: "+1",
    tickMs: 160,
    frames: [
      "   _    \n  ( )   \n  /|\\   \n   |    \n  / \\   ",
      "   _    \n  (•)   \n  /|\\👍 \n   |    \n  / \\   ",
      "   _    \n  (^)   \n  /|\\   \n   |    \n  / \\   ",
      "   _    \n  (•)   \n  /|\\ + \n   |    \n  / \\   ",
    ],
  },
  party: {
    id: "party",
    label: "party",
    chip: "🎉",
    tickMs: 110,
    frames: [
      " \\(^o^)/ \n  party! \n *  *  * ",
      " \\(^o^)/ \n  PARTY! \n  * * *  ",
      " \\(^O^)/ \n  party! \n *  *  * ",
      "  (^o^)  \n \\|||||/ \n  * * *  ",
    ],
  },
  skull: {
    id: "skull",
    label: "skull",
    chip: "☠",
    tickMs: 180,
    frames: [
      "  .----.  \n / o  o \\ \n |  __  | \n  \\----/  \n  /|/\\|\\  ",
      "  .----.  \n / -  - \\ \n |  __  | \n  \\----/  \n  /|/\\|\\  ",
      "  .----.  \n / o  o \\ \n |  ~~  | \n  \\----/  \n  /|/\\|\\  ",
      "  .----.  \n / o  o \\ \n |  __  | \n  \\----/  \n  \\/  \\/  ",
    ],
  },
  coffee: {
    id: "coffee",
    label: "coffee",
    chip: "☕",
    tickMs: 170,
    frames: [
      "   (  )   \n    ) (   \n  ....... \n  |     |]\n  \\_____/ ",
      "    ) (   \n   (  )   \n  ....... \n  |     |]\n  \\_____/ ",
      "   (  )   \n    )(    \n  ....... \n  |     |]\n  \\_____/ ",
      "   (   )  \n    ) (   \n  ....... \n  | ~~~ |]\n  \\_____/ ",
    ],
  },
  cry: {
    id: "cry",
    label: "cry",
    chip: ";;",
    tickMs: 150,
    frames: [
      "  (；_；)  \n   /||\\   \n   /  \\   ",
      "  (；ω；)  \n   /||\\   \n   /  \\   ",
      "  (T_T)   \n   /||\\   \n  ~/  \\~  ",
      "  (；_；)  \n   /||\\   \n   /  \\   ",
    ],
  },
  cool: {
    id: "cool",
    label: "cool",
    chip: "B-)",
    tickMs: 160,
    frames: [
      "  (•_•)   \n  <)  )╯  \n  /   \\   ",
      "  (•_•)>⌐■-■\n  (⌐■_■)  \n  /   \\   ",
      "  (⌐■_■)  \n  <)  )╯  \n  /   \\   ",
      "  (⌐■_■)  \n  deal    \n  /   \\   ",
    ],
  },
  think: {
    id: "think",
    label: "think",
    chip: "hmm",
    tickMs: 200,
    frames: [
      "  (・_・;)  \n    hmm    ",
      "  (・_・?)  \n   hmm.    ",
      "  (・_・…)  \n   hmm..   ",
      "  (・_・?)  \n  hmm...?  ",
    ],
  },
};

export function getAsciiEmoji(id: string): AsciiEmojiDef | null {
  if (id in catalog) return catalog[id as AsciiEmojiId];
  return null;
}

export function listAsciiEmojis(): AsciiEmojiDef[] {
  return ASCII_EMOJI_IDS.map((id) => catalog[id]);
}
