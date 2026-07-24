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
      "   _    \n  (•)   \n  /|\\ + \n   |    \n  / \\   ",
      "   _    \n  (^)   \n  /|\\   \n   |    \n  / \\   ",
      "   _    \n  (•)   \n  /|\\++ \n   |    \n  / \\   ",
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
  rocket: {
    id: "rocket",
    label: "rocket",
    chip: "🚀",
    tickMs: 100,
    frames: [
      "    /\\    \n   |==|   \n   |  |   \n   |  |   \n  /____\\  \n   ^^^^   ",
      "    /\\    \n   |==|   \n   |  |   \n   |  |   \n  /____\\  \n  ^^^^^^  ",
      "    /\\    \n   |##|   \n   |  |   \n   |  |   \n  /____\\  \n   ^^^^   ",
      "    /\\    \n   |==|   \n   |**|   \n   |  |   \n  /____\\  \n  *^^^^*  ",
    ],
  },
  matrix: {
    id: "matrix",
    label: "matrix",
    chip: "01",
    tickMs: 90,
    frames: [
      " 1 0 1 0 \n  0 1 0  \n 1 0 1 0 \n  0 1 0  ",
      " 0 1 0 1 \n  1 0 1  \n 0 1 0 1 \n  1 0 1  ",
      " 1 1 0 0 \n  0 0 1  \n 1 0 1 1 \n  0 1 0  ",
      " 0 0 1 1 \n  1 1 0  \n 0 1 0 0 \n  1 0 1  ",
    ],
  },
  glitch: {
    id: "glitch",
    label: "glitch",
    chip: "⚡",
    tickMs: 80,
    frames: [
      "  ▓▒░ERR░▒▓  \n  (x_x)      \n  /|\\|\\      ",
      "  ░▒▓ERR▓▒░  \n  (X_X)      \n  \\|/|/      ",
      "  ▒▓░###░▓▒  \n  (#_#)      \n  /|\\|\\      ",
      "  ▓░░OK?░░▓  \n  (o_o)      \n  /   \\      ",
    ],
  },
  dance: {
    id: "dance",
    label: "dance",
    chip: "♪",
    tickMs: 120,
    frames: [
      "  \\(^o^)/  \n   / \\    \n  ♪   ♫   ",
      "  \\(^o^)   \n   /|     \n ♫     ♪  ",
      "   (^o^)/  \n    |\\    \n  ♪   ♫   ",
      "  \\(^O^)/  \n   / \\    \n ♫  *  ♪  ",
    ],
  },
  shrug: {
    id: "shrug",
    label: "shrug",
    chip: "¯\\_/",
    tickMs: 220,
    frames: [
      " ¯\\_(ツ)_/¯ ",
      " ¯\\_(ツ)_/¯ ",
      " ¯\\_(·_·)_/¯",
      " ¯\\_(ツ)_/¯ ",
    ],
  },
  rage: {
    id: "rage",
    label: "rage",
    chip: ">",
    tickMs: 110,
    frames: [
      "  (╬ಠ益ಠ)  \n   /||\\    \n   /  \\    ",
      "  (╬◣_◢)   \n   /||\\    \n   /  \\    ",
      "  (╬ಠ益ಠ)  \n  //||\\\\   \n   /  \\    ",
      "  (╯°□°)╯  \n  ┻━┻      ",
    ],
  },
  robot: {
    id: "robot",
    label: "robot",
    chip: "🤖",
    tickMs: 140,
    frames: [
      "   [o_o]   \n  /|:::|\\  \n   d   b   ",
      "   [o_o]   \n  /|:::|\\  \n   b   d   ",
      "   [-_-]   \n  /|:::|\\  \n   d   b   ",
      "   [o_0]   \n  /|###|\\  \n   d   b   ",
    ],
  },
  cat: {
    id: "cat",
    label: "cat",
    chip: "猫",
    tickMs: 150,
    frames: [
      "  /\\_/\\  \n ( o.o ) \n  > ^ <  ",
      "  /\\_/\\  \n ( -.- ) \n  > ^ <  ",
      "  /\\_/\\  \n ( o.o ) \n  > ^ <  ",
      "  /\\_/\\  \n ( ^.^ ) \n  > ^ <  ",
    ],
  },
  star: {
    id: "star",
    label: "star",
    chip: "★",
    tickMs: 130,
    frames: [
      "    *     \n   ***    \n  *****   \n   ***    \n    *     ",
      "   \\*/    \n  --*--   \n   /*\\    ",
      "    ✦     \n   ✦✦✦    \n  ✦✦✦✦✦   \n   ✦✦✦    \n    ✦     ",
      "   \\|/    \n  --✦--   \n   /|\\    ",
    ],
  },
  moon: {
    id: "moon",
    label: "moon",
    chip: "☾",
    tickMs: 180,
    frames: [
      "    .  *  \n  *  ☾    \n   .   *  ",
      "  *  .    \n    ☾  *  \n  .    *  ",
      "   *   .  \n  .  ☾    \n *    .   ",
      "  . *  .  \n    ☾  *  \n  *  .    ",
    ],
  },
  rain: {
    id: "rain",
    label: "rain",
    chip: "☔",
    tickMs: 100,
    frames: [
      "  /   /  / \n /  /   /  \n/  /  /    \n  ~~~~     ",
      " /  /  /   \n/  /  /  / \n  /  /  /  \n  ~~~~     ",
      "  / /  / / \n /  / /  / \n/ /  /  /  \n  ~~~~     ",
      " / / /  /  \n/  /  / /  \n  / /  /   \n  ~~~~     ",
    ],
  },
  boom: {
    id: "boom",
    label: "boom",
    chip: "💥",
    tickMs: 100,
    frames: [
      "    .     \n   ***    \n  *****   ",
      "  \\ | /   \n --***--  \n  / | \\   ",
      " * \\|/ *  \n-- BOOM --\n * /|\\ *  ",
      "  . * .   \n *  +  *  \n  . * .   ",
    ],
  },
  ninja: {
    id: "ninja",
    label: "ninja",
    chip: "忍",
    tickMs: 130,
    frames: [
      "   .-.    \n  (\\ /)   \n  /| |\\   \n   | |    \n  /   \\   ",
      "   .-.    \n  (\\ /)   \n  /| | >  \n   | |    \n  /   \\   ",
      "   .-.    \n  (\\ /)   \n  /| |\\   \n   | |    \n  /   \\   ",
      "   .-.    \n  (-_-)   \n  /| |\\   \n   | |    \n  /   \\   ",
    ],
  },
  alien: {
    id: "alien",
    label: "alien",
    chip: "👽",
    tickMs: 140,
    frames: [
      "   .-.    \n  (o o)   \n   \\_/    \n  /| |\\   ",
      "   .-.    \n  (O O)   \n   \\_/    \n  /| |\\   ",
      "  .-.     \n (o o)    \n  \\_/     \n /| |\\    ",
      "   .-.    \n  (- -)   \n   \\_/    \n  /| |\\   ",
    ],
  },
  bongo: {
    id: "bongo",
    label: "bongo cat",
    chip: "🥁",
    tickMs: 110,
    frames: [
      "  /\\_/\\  \n ( o.o ) \n  > ^ <  \n  ||||||  ",
      "  /\\_/\\  \n ( o.o ) \n  > ^ <  \n  ||||||  ",
      "  /\\_/\\  \n ( -.- ) \n  > ^ <  \n  |▓▓|  ",
      "  /\\_/\\  \n ( o.o ) \n  > ^ <  \n  ||||||  ",
    ],
  },
  spinner: {
    id: "spinner",
    label: "spinner",
    chip: "↻",
    tickMs: 90,
    frames: ["   |    ", "   /    ", "   -    ", "   \\    "],
  },
  ok: {
    id: "ok",
    label: "ok",
    chip: "OK",
    tickMs: 150,
    frames: [
      "  ┌────┐  \n  │ OK │  \n  └────┘  ",
      "  ┌────┐  \n  │ ok │  \n  └────┘  ",
      "  ┌────┐  \n  │ ✓  │  \n  └────┘  ",
      "  ┌────┐  \n  │ OK │  \n  └────┘  ",
    ],
  },
  nope: {
    id: "nope",
    label: "nope",
    chip: "NO",
    tickMs: 140,
    frames: [
      "  ┌────┐  \n  │ NO │  \n  └────┘  ",
      "  ┌────┐  \n  │nope│  \n  └────┘  ",
      "  ┌────┐  \n  │ ✕  │  \n  └────┘  ",
      "  ┌────┐  \n  │ NO │  \n  └────┘  ",
    ],
  },
  sparkle: {
    id: "sparkle",
    label: "sparkle",
    chip: "✦",
    tickMs: 120,
    frames: [
      "  .  *  .  \n *  ✦  *  \n  .  *  .  ",
      " *  .  *  \n  . ✦ .   \n *  .  *  ",
      "  . * .   \n*   ✦   * \n  . * .   ",
      " * . * .  \n  . ✦ .   \n . * . *  ",
    ],
  },
  eyes: {
    id: "eyes",
    label: "eyes",
    chip: "👀",
    tickMs: 200,
    frames: [
      "  (•_•) (•_•) ",
      "  (•_•)> (•_•)",
      "  ( •_•) (•_•)",
      "  (•_•) <(•_•)",
    ],
  },
  clap: {
    id: "clap",
    label: "clap",
    chip: "👏",
    tickMs: 120,
    frames: [
      "  \\o/  \\o/  \n   |    |   \n  / \\  / \\  ",
      "  \\o\\  /o/  \n   |    |   \n  / \\  / \\  ",
      "  \\o/  \\o/  \n   |    |   \n  / \\  / \\  ",
      "  clap clap \n  \\o/  \\o/  ",
    ],
  },
  facepalm: {
    id: "facepalm",
    label: "facepalm",
    chip: "🤦",
    tickMs: 180,
    frames: [
      "  ( -_-)  \n   /||\\   \n   /  \\   ",
      "  ( >_>)  \n   /||\\   \n   /  \\   ",
      "  ( -_-)z \n  _/||\\   \n   /  \\   ",
      "  ( -_-)  \n   /||\\   \n   /  \\   ",
    ],
  },
  wink: {
    id: "wink",
    label: "wink",
    chip: ";)",
    tickMs: 160,
    frames: [
      "  (•_•)   \n  <)  )╯  \n  /   \\   ",
      "  (•_•)>⌐ \n  (⌐■_■)  \n  /   \\   ",
      "  (•_•)   \n  wink    \n  /   \\   ",
      "  (;¬_¬)  \n  <)  )╯  \n  /   \\   ",
    ],
  },
  sleepy: {
    id: "sleepy",
    label: "sleepy",
    chip: "Zz",
    tickMs: 220,
    frames: [
      "  (-_-) z  \n   /||\\    \n   /  \\    ",
      "  (-_-) zZ \n   /||\\    \n   /  \\    ",
      "  (-.-) Zz \n   /||\\    \n   /  \\    ",
      "  (-_-) zzZ\n   /||\\    \n   /  \\    ",
    ],
  },
  money: {
    id: "money",
    label: "money",
    chip: "$",
    tickMs: 140,
    frames: [
      "  [$$$]   \n  ($_$)   \n  /| |\\   ",
      "  [$ $]   \n  ($_$)   \n  /| |\\   ",
      "  [$$$]   \n  (o_o)   \n  /| |\\   ",
      "  [$$]    \n  ($_$)   \n  cha-ching",
    ],
  },
  pizza: {
    id: "pizza",
    label: "pizza",
    chip: "🍕",
    tickMs: 160,
    frames: [
      "    /\\    \n   /..\\   \n  /....\\  \n /______\\ ",
      "    /\\    \n   /o.\\   \n  /..o.\\  \n /______\\ ",
      "    /\\    \n   /.o\\   \n  /o....\\ \n /______\\ ",
      "    /\\    \n   /..\\   \n  /..o.\\  \n /__yum_\\ ",
    ],
  },
  hacker: {
    id: "hacker",
    label: "hacker",
    chip: ">_ ",
    tickMs: 100,
    frames: [
      "  >_      \n  hacking \n  ####..  ",
      "  >_      \n  hacking \n  #####.  ",
      "  >_      \n  hacking \n  ######  ",
      "  >_      \n  root#   \n  done.   ",
    ],
  },
  terminal: {
    id: "terminal",
    label: "terminal",
    chip: "$",
    tickMs: 160,
    frames: [
      " ┌────────┐ \n │ $ _    │ \n └────────┘ ",
      " ┌────────┐ \n │ $ █    │ \n └────────┘ ",
      " ┌────────┐ \n │ $ ghost│ \n └────────┘ ",
      " ┌────────┐ \n │ $ _    │ \n └────────┘ ",
    ],
  },
  love: {
    id: "love",
    label: "love",
    chip: "♡",
    tickMs: 150,
    frames: [
      "  (´∀｀)♡  \n   love    ",
      "  (´ω｀)♡  \n   LOVE    ",
      "  (´∀｀)♥  \n   love    ",
      "  ♡(´∀｀)  \n   love    ",
    ],
  },
  zombie: {
    id: "zombie",
    label: "zombie",
    chip: "🧟",
    tickMs: 170,
    frames: [
      "  (x_x)   \n  /| |\\   \n   | |    \n  /   \\   ",
      "  (x_x)   \n  /| |\\   \n   | |    \n  /   \\   ",
      "  (o_o)   \n  /| |\\   \n   | |    \n  brains  ",
      "  (x_x)   \n  /| |\\   \n   | |    \n  /   \\   ",
    ],
  },
  wizard: {
    id: "wizard",
    label: "wizard",
    chip: "✧",
    tickMs: 140,
    frames: [
      "    /\\    \n   /  \\   \n  (o_o)   \n  /| |\\ * \n   | |    ",
      "    /\\    \n   /##\\   \n  (o_o)   \n  /| |\\✧  \n   | |    ",
      "    /\\    \n   /  \\   \n  (0_0)   \n  /| |\\ * \n   | |    ",
      "    /\\    \n   /##\\   \n  (o_o)   \n  /| |\\✦  \n   | |    ",
    ],
  },
  keyboard: {
    id: "keyboard",
    label: "keyboard",
    chip: "⌨",
    tickMs: 100,
    frames: [
      " [q][w][e] \n [a][s][d] \n  clack    ",
      " [Q][w][e] \n [a][S][d] \n  clack    ",
      " [q][W][e] \n [A][s][D] \n  click    ",
      " [q][w][E] \n [a][s][d] \n  clack    ",
    ],
  },
};

export function getAsciiEmoji(id: string): AsciiEmojiDef | null {
  if (id in catalog) return catalog[id as AsciiEmojiId];
  return null;
}

export function listAsciiEmojis(): AsciiEmojiDef[] {
  return ASCII_EMOJI_IDS.map((id) => catalog[id]).filter(Boolean);
}
