import chalk from "chalk";

const LOGO_RAW = [
  " ██████╗ ██████╗  █████╗  ██████╗ ███████╗███╗   ██╗████████╗",
  "██╔════╝██╔═══██╗██╔══██╗██╔════╝ ██╔════╝████╗  ██║╚══██╔══╝",
  "██║     ██║   ██║███████║██║  ███╗█████╗  ██╔██╗ ██║   ██║   ",
  "██║     ██║   ██║██╔══██║██║   ██║██╔══╝  ██║╚██╗██║   ██║   ",
  "╚██████╗╚██████╔╝██║  ██║╚██████╔╝███████╗██║ ╚████║   ██║   ",
  " ╚═════╝ ╚═════╝ ╚═╝  ╚═╝ ╚═════╝ ╚══════╝╚═╝  ╚═══╝   ╚═╝   ",
];

const LOGO_COLORS: ((s: string) => string)[] = [
  chalk.cyan,
  chalk.cyan,
  chalk.magenta,
  chalk.magenta,
  chalk.green,
  chalk.green,
];

export function displayWidth(str: string): number {
  let w = 0;
  for (const ch of str) {
    const cp = ch.codePointAt(0)!;
    if (cp >= 0x1100 && (
      cp <= 0x115f || cp === 0x2329 || cp === 0x232a ||
      (cp >= 0x2e80 && cp <= 0xa4cf && cp !== 0x303f) ||
      (cp >= 0xac00 && cp <= 0xd7a3) ||
      (cp >= 0xf900 && cp <= 0xfaff) ||
      (cp >= 0xfe10 && cp <= 0xfe19) ||
      (cp >= 0xfe30 && cp <= 0xfe6f) ||
      (cp >= 0xff01 && cp <= 0xff60) ||
      (cp >= 0xffe0 && cp <= 0xffe6) ||
      (cp >= 0x1f300 && cp <= 0x1f9ff) ||
      (cp >= 0x20000 && cp <= 0x2fffd) ||
      (cp >= 0x30000 && cp <= 0x3fffd)
    )) {
      w += 2;
    } else {
      w += 1;
    }
  }
  return w;
}

export function buildLogoLines(termWidth: number): string[] {
  const maxLineW = Math.max(...LOGO_RAW.map(displayWidth));
  const pad = Math.max(0, Math.floor((termWidth - maxLineW) / 2));
  const padStr = " ".repeat(pad);
  const lines: string[] = [""];
  for (let i = 0; i < LOGO_RAW.length; i++) {
    lines.push(padStr + LOGO_COLORS[i]!(LOGO_RAW[i]!));
  }
  lines.push("");
  const tagline = "◈ Collaborative Agent Framework";
  const version = "v0.2.0";
  const taglineW = displayWidth(tagline) + 1 + version.length;
  const taglinePad = Math.max(0, Math.floor((termWidth - taglineW) / 2));
  lines.push(" ".repeat(taglinePad) + chalk.white(tagline) + " " + chalk.gray(version));
  lines.push("");
  return lines;
}
