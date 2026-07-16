/**
 * Terminal styling for GhostChat CLI — zero deps, pure ANSI.
 */

const useColor =
  process.stdout.isTTY !== false && process.env.NO_COLOR === undefined;

const esc = (code: string, s: string) =>
  useColor ? `\x1b[${code}m${s}\x1b[0m` : s;

export const c = {
  reset: (s: string) => esc("0", s),
  dim: (s: string) => esc("2", s),
  bold: (s: string) => esc("1", s),
  italic: (s: string) => esc("3", s),
  green: (s: string) => esc("32", s),
  brightGreen: (s: string) => esc("92", s),
  red: (s: string) => esc("31", s),
  yellow: (s: string) => esc("33", s),
  cyan: (s: string) => esc("36", s),
  magenta: (s: string) => esc("35", s),
  white: (s: string) => esc("97", s),
  gray: (s: string) => esc("90", s),
  bgDark: (s: string) => esc("40", s),
};

const W = 48;

export function line(ch = "─", width = W): string {
  return ch.repeat(width);
}

export function banner(): string {
  // Fixed-width block (42 cols inside) so borders stay aligned
  const art = [
    c.brightGreen("  ╔════════════════════════════════════════╗"),
    c.brightGreen("  ║") +
      c.bold(c.white("          ╔═╗╦ ╦╔═╗╔═╗╔╦╗╔═╗╦ ╦╔═╗         ")) +
      c.brightGreen("║"),
    c.brightGreen("  ║") +
      c.bold(c.white("          ║ ╦╠═╣║ ║╚═╗ ║ ║  ╠═╣╠═╣         ")) +
      c.brightGreen("║"),
    c.brightGreen("  ║") +
      c.bold(c.white("          ╚═╝╩ ╩╚═╝╚═╝ ╩ ╚═╝╩ ╩╩ ╩         ")) +
      c.brightGreen("║"),
    c.brightGreen("  ║") +
      c.dim("       anonymous · e2ee · ephemeral        ") +
      c.brightGreen("║"),
    c.brightGreen("  ║") +
      c.dim("     .---.              .---.              ") +
      c.brightGreen("║"),
    c.brightGreen("  ║") +
      c.dim("    ( o_o )  ~~~~~~~~  ( ^_^ )             ") +
      c.brightGreen("║"),
    c.brightGreen("  ║") +
      c.dim("     /| |\\              /| |\\              ") +
      c.brightGreen("║"),
    c.brightGreen("  ╚════════════════════════════════════════╝"),
  ];
  return "\n" + art.join("\n") + "\n";
}

function stripAnsi(s: string): string {
  return s.replace(/\x1b\[[0-9;]*m/g, "");
}

export function box(title: string, rows: string[]): string {
  const inner = W - 4;
  const titleBit = ` ${title} `;
  const fill = Math.max(0, W - 3 - titleBit.length);
  const top =
    c.brightGreen("┌─") +
    c.bold(c.white(titleBit)) +
    c.brightGreen("─".repeat(fill) + "┐");
  const body = rows.map((r) => {
    const pad = Math.max(0, inner - stripAnsi(r).length);
    return c.brightGreen("│ ") + r + " ".repeat(pad) + c.brightGreen(" │");
  });
  const bot = c.brightGreen("└" + "─".repeat(W - 2) + "┘");
  return [top, ...body, bot].join("\n");
}

export function clearLine(): void {
  process.stdout.write("\r\x1b[K");
}

export function printLine(text: string): void {
  clearLine();
  process.stdout.write(text + "\n");
}

export function sys(text: string): void {
  printLine(c.dim("  · " + text));
}

export function ok(text: string): void {
  printLine(c.brightGreen("  ✓ ") + text);
}

export function warn(text: string): void {
  printLine(c.yellow("  ! ") + text);
}

export function err(text: string): void {
  printLine(c.red("  ✗ ") + text);
}

export function statusBar(opts: {
  roomId: string;
  myId: string;
  peerId: string | null;
  peerOnline: boolean;
  ttl: string;
}): string {
  const peer = opts.peerOnline
    ? c.brightGreen("● ") + c.white(opts.peerId ?? "peer")
    : c.gray("○ waiting");
  return (
    c.dim("  room ") +
    c.bold(c.brightGreen(opts.roomId)) +
    c.dim("  you ") +
    c.cyan(opts.myId) +
    c.dim("  peer ") +
    peer +
    c.dim("  burn ") +
    c.yellow(opts.ttl)
  );
}

export function msgYou(text: string, ttl: string): void {
  printLine(
    c.brightGreen("  you ") +
      c.dim("┌") +
      c.dim("─".repeat(Math.min(40, text.length + 2)))
  );
  printLine(c.brightGreen("      ") + c.dim("│ ") + c.white(text));
  printLine(
    c.brightGreen("      ") +
      c.dim("└ ") +
      c.dim(`burn:${ttl}`)
  );
}

export function msgPeer(from: string, text: string, ttl: string): void {
  printLine(
    c.cyan(`  ${from} `) +
      c.dim("┌") +
      c.dim("─".repeat(Math.min(40, text.length + 2)))
  );
  printLine(c.cyan("      ") + c.dim("│ ") + c.white(text));
  printLine(c.cyan("      ") + c.dim("└ ") + c.dim(`burn:${ttl}`));
}

export function burned(id: string): void {
  printLine(c.dim(c.italic(`  ∿ burned ${id.slice(0, 10)}…`)));
}

export function typingLine(who: string): void {
  clearLine();
  process.stdout.write(
    c.magenta("  ") +
      c.dim("⌨  ") +
      c.magenta(who) +
      c.dim(" is typing") +
      c.brightGreen(" ···")
  );
}

export function promptStr(opts: {
  ttl: string;
  ready: boolean;
}): string {
  const lock = opts.ready ? "" : c.yellow(" locked");
  return (
    c.brightGreen("╭") +
    c.dim(" burn:") +
    c.yellow(opts.ttl) +
    lock +
    "\n" +
    c.brightGreen("╰▸ ")
  );
}

export function helpInline(): string {
  return c.dim(
    "  commands  /ttl on_read|10s|60s   /who   /safety   /quit"
  );
}

export function roomCreatedCard(roomId: string, link: string): string {
  return (
    "\n" +
    box("ROOM READY", [
      c.dim("code   ") + c.bold(c.brightGreen(roomId)),
      c.dim("link   ") + c.cyan(link),
      "",
      c.dim("share the code or QR (web) with your peer"),
    ]) +
    "\n"
  );
}

export function sessionHeader(roomId: string): string {
  return (
    "\n" +
    c.brightGreen("═".repeat(W)) +
    "\n" +
    c.bold(c.white("  GhostChat")) +
    c.dim("  room ") +
    c.brightGreen(roomId) +
    "\n" +
    c.brightGreen("═".repeat(W)) +
    "\n" +
    helpInline() +
    "\n"
  );
}

export function safetyCard(number: string): string {
  return (
    "\n" +
    box("SAFETY NUMBER", [
      c.bold(c.white(number)),
      "",
      c.dim("compare with peer — must match"),
    ]) +
    "\n"
  );
}

export function goodbye(): void {
  printLine("");
  printLine(c.dim("  ── connection sealed. nothing remains. ──"));
  printLine("");
}
