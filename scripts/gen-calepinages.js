// Generate damier_n, iflip_n, damier_n_random for n=2..16
const fs = require("fs");
const path = require("path");
const n = 16;
const out = [];

for (let size = 2; size <= n; size++) {
  const matrixDamier = [];
  const matrixIflip = [];
  const matrixRandom = [];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const tile = (x + y) % size + 1;
      matrixDamier.push({ x, y, tile, rot: 0 });
      matrixIflip.push({ x, y, tile, rot: (x + y) % 2 === 0 ? 0 : 180 });
      matrixRandom.push({ x, y, tile, rot: "random" });
    }
  }
  out.push({ id: "damier_" + size, nom: "Damier " + size + " motifs", block_size: [size, size], matrix: matrixDamier });
  out.push({ id: "iflip_" + size, nom: "Damier iflip " + size + " motifs", block_size: [size, size], matrix: matrixIflip });
  out.push({ id: "damier_" + size + "_random", nom: "Damier " + size + " motifs (rot. aléatoire)", block_size: [size, size], matrix: matrixRandom });
}

const outPath = path.join(__dirname, "..", "data", "calepinages-generated.json");
fs.writeFileSync(outPath, JSON.stringify(out), "utf8");
console.log("Wrote", out.length, "entries to", outPath);
