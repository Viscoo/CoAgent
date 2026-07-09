// Generate CoAgent logo pixel art in OpenCode's format
// Run: node logo-gen.js

// Block-letter definitions (4 wide, 3 tall)
var FONT = {
  C: ["█▀▀▀", "█   ", "▀▀▀▀"],
  O: ["█▀▀█", "█  █", "▀▀▀▀"],
  A: ["█▀▀█", "█▀▀▀", "▀  ▀"],
  G: ["█▀▀▀", "█  ▀", "▀▀▀▀"],
  E: ["█▀▀▀", "█▀▀ ", "▀▀▀▀"],
  N: ["█▀  █", "█▀▀▀█", "▀  ▀"],
  T: ["▀▀█▀▀", "  █  ", "  ▀  "],
};

var TEXT = "COAGENT";

function buildRow(rowIndex) {
  var parts = TEXT.split("").map(function(ch) {
    var glyph = FONT[ch];
    if (!glyph) return "    ";
    return glyph[rowIndex];
  });
  return parts.join(" ");
}

var rows = [0, 1, 2].map(buildRow);

console.log("=== LEFT (new CoAgent logo) ===");
console.log(JSON.stringify([
  "                   ",
  rows[0],
  rows[1],
  rows[2],
]));

console.log("\n=== RIGHT (decorative) ===");
console.log(JSON.stringify([
  "              ▄    ",
  "▀▀▀ ▀▀▀ ▀▀▀ ▀▀▀▄ ▀▀▀ ▀▀▀ ▀▀▀ ▀▀▀▀",
  "  ▀   ▀   ▀   ▀ ▀ ▀   ▀   ▀   ▀  ",
  "▀▀▀  ▀   ▀▀▀ ▀▀▀▀ ▀▀▀ ▀▀▀ ▀▀▀  ▀",
]));

console.log("\n=== LEFT (original) ===");
console.log(JSON.stringify([
  "                   ",
  "█▀▀█ █▀▀█ █▀▀█ █▀▀▄ █▀▀▀ █▀▀█ █▀▀█ █▀▀█",
  "█  █ █  █ █▀▀▀ █  █ █    █  █ █  █ █▀▀▀",
  "▀▀▀▀ █▀▀▀ ▀▀▀▀ ▀  ▀ ▀▀▀▀ ▀▀▀▀ ▀▀▀▀ ▀▀▀▀",
]));
