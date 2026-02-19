const fs = require("fs");
const path = require("path");

const dataDir = path.join(__dirname, "..", "data");
const existingPath = path.join(dataDir, "calepinages.json");
const generatedPath = path.join(dataDir, "calepinages-generated.json");

let existing = JSON.parse(fs.readFileSync(existingPath, "utf8"));

// 1. Replace "tapis" by "aleatoire" (remove tapis, ensure aleatoire exists)
const aleatoireMatrix = [{ x: 0, y: 0, tile: "any", rot: "random" }];
const aleatoireBlock = [1, 1];
existing = existing.filter((entry) => entry.id !== "tapis");
if (!existing.some((e) => e.id === "aleatoire")) {
  existing.push({
    id: "aleatoire",
    nom: "Aléatoire",
    block_size: aleatoireBlock,
    matrix: aleatoireMatrix,
  });
}

// 2. Load generated and fix encoding in noms
let generated = JSON.parse(fs.readFileSync(generatedPath, "utf8"));
generated = generated.map((entry) => {
  if (entry.nom && entry.nom.includes("rot. al")) {
    entry.nom = entry.nom.replace(/rot\. al.*toire\)?/, "rot. aléatoire)");
  }
  return entry;
});

// 3. Merge: existing first, then generated (avoid duplicate ids: keep existing damier_2_motifs, damier, etc.)
const existingIds = new Set(existing.map((e) => e.id));
const toAdd = generated.filter((e) => !existingIds.has(e.id));
existingIds.forEach((id) => {});
toAdd.forEach((e) => existingIds.add(e.id));
const merged = [...existing, ...toAdd];

fs.writeFileSync(existingPath, JSON.stringify(merged, null, 2), "utf8");
console.log("Merged", existing.length, "+", toAdd.length, "=", merged.length);
