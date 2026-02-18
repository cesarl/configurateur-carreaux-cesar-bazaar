// CONFIGURATEUR CÉSAR BAZAAR - ALPHA V1
const REPO_URL = "."; // Pour GitHub Pages, "." suffit
let currentCollection = null;
let currentColors = {}; // Stocke l'état actuel { "zone-1": "#hex", ... }
let activeZone = null;  // La zone qu'on est en train de modifier
let nuancierData = [];

// Démarrage
document.addEventListener("DOMContentLoaded", async () => {
    await loadData();
    // On charge la collection "liz" par défaut pour la démo
    loadCollection("liz");
});

async function loadData() {
    try {
        const res = await fetch(`${REPO_URL}/data/nuancier.json`);
        nuancierData = await res.json();
        renderPalette(nuancierData);
    } catch (e) {
        console.error("Erreur chargement données", e);
    }
}

async function loadCollection(id) {
    // 1. Charger les infos de la collection
    const res = await fetch(`${REPO_URL}/data/collections.json`);
    const collections = await res.json();
    currentCollection = collections.find(c => c.id === id);

    if (!currentCollection) return alert("Collection introuvable");

    document.getElementById("collection-title").innerText = currentCollection.nom;

    // 2. Charger les SVGs (ROOT et VAR1)
    await loadSVG("ROOT", currentCollection.id);
    if (currentCollection.variations.includes("VAR1")) {
        await loadSVG("VAR1", currentCollection.id);
    }

    // 3. Afficher la grille par défaut
    setGridMode("solo");
}

// Cache pour stocker le code SVG texte et éviter de re-télécharger
const svgCache = {};

async function loadSVG(type, collectionId) {
    // 1. Gestion de la Casse (Case Insensitive)
    // On force tout en minuscule.
    // Donc si le JSON dit "Medina" et le type est "ROOT", on cherchera "medina-root.svg"
    const safeId = collectionId.toLowerCase().trim();
    const safeType = type.toLowerCase().trim();

    // 2. Construction du nouveau nom de fichier (Nom-Type.svg)
    const filename = `${safeId}-${safeType}.svg`;

    console.log(`Chargement du fichier : ${filename}`); // Petit log pour vérifier

    try {
        const res = await fetch(`${REPO_URL}/assets/svg/${filename}`);
        if (!res.ok) throw new Error(`Fichier introuvable : ${filename}`);
        
        const text = await res.text();
        
        // On stocke dans le cache avec la clé d'origine (ex: "ROOT") pour que le reste du script s'y retrouve
        svgCache[type] = text; 
    } catch (e) {
        console.error(`Erreur chargement SVG (${filename})`, e);
        // Optionnel : on pourrait charger un placeholder ici si le fichier manque
    }
}

function setGridMode(mode) {
    const container = document.getElementById("grid-container");
    container.innerHTML = ""; // Vider
    container.className = `grid-view ${mode}`;

    if (mode === "solo") {
        // Juste le ROOT
        container.innerHTML = prepareSVG(svgCache["ROOT"]);
    } else if (mode === "tapis") {
        // Un damier simple pour la démo (ROOT / VAR1 / VAR1 / ROOT)
        container.innerHTML += prepareSVG(svgCache["ROOT"]);
        container.innerHTML += prepareSVG(svgCache["VAR1"] || svgCache["ROOT"]);
        container.innerHTML += prepareSVG(svgCache["VAR1"] || svgCache["ROOT"]);
        container.innerHTML += prepareSVG(svgCache["ROOT"]);
    }
    
    // Une fois le SVG injecté, on scanne les zones
    scanZones();
    // On réapplique les couleurs choisies
    applyCurrentColors();
}

function prepareSVG(svgString) {
    // Nettoyage basique si besoin
    return `<div class="tile-wrapper">${svgString}</div>`;
}

// Détecte quelles zones (id="zone-X") existent dans le SVG
function scanZones() {
    const zonesFound = new Set();
    // On regarde dans le premier SVG affiché
    const rootSvg = document.querySelector("#grid-container svg");
    if(!rootSvg) return;

    // Cherche tous les groupes avec un ID commençant par 'zone-'
    rootSvg.querySelectorAll('g[id^="zone-"]').forEach(g => {
        zonesFound.add(g.id);
        // Ajout de l'interactivité (le Blop)
        makeZoneInteractive(g.id);
    });

    renderZoneSelector(Array.from(zonesFound).sort());
}

function makeZoneInteractive(zoneId) {
    // On cible toutes les occurrences de cette zone dans la grille
    const elements = document.querySelectorAll(`#${zoneId}`);
    elements.forEach(el => {
        // On permet le clic sur le groupe SVG
        el.style.cursor = "pointer";
        el.onclick = (e) => {
            e.stopPropagation();
            selectActiveZone(zoneId);
        };
        // Pour l'effet CSS
        el.querySelectorAll('path').forEach(p => p.setAttribute("data-active", "true"));
    });
}

function selectActiveZone(zoneId) {
    activeZone = zoneId;
    // Visuel UI
    document.querySelectorAll(".zone-btn").forEach(b => b.classList.remove("selected"));
    const btn = document.getElementById(`btn-zone-${zoneId}`);
    if(btn) btn.classList.add("selected");
    
    console.log("Zone active :", zoneId);
}

function renderZoneSelector(zones) {
    const container = document.getElementById("zones-list");
    container.innerHTML = "";
    zones.forEach(z => {
        const btn = document.createElement("button");
        btn.id = `btn-zone-${z}`;
        btn.className = "zone-btn secondary";
        btn.innerText = z.replace("zone-", "Zone ");
        btn.onclick = () => selectActiveZone(z);
        container.appendChild(btn);
    });
}

function renderPalette(colors) {
    const container = document.getElementById("color-palette");
    colors.forEach(c => {
        const div = document.createElement("div");
        div.className = "color-swatch";
        div.style.backgroundColor = c.hex;
        div.title = c.nom;
        div.onclick = () => applyColorToActiveZone(c.hex);
        container.appendChild(div);
    });
}

function applyColorToActiveZone(hexColor) {
    if (!activeZone) {
        alert("Sélectionnez d'abord une zone sur le dessin !");
        return;
    }
    
    // 1. Mettre à jour la variable CSS (Magie visuelle instantanée)
    // On cible --color-zone-1, --color-zone-2, etc.
    const cssVar = `--color-${activeZone}`;
    document.documentElement.style.setProperty(cssVar, hexColor);

    // 2. Stocker le choix
    currentColors[activeZone] = hexColor;

    // 3. Forcer la couleur sur les éléments SVG (au cas où le CSS ne suffise pas)
    // C'est la méthode "brute" qui garantit que ça marche
    document.querySelectorAll(`#${activeZone} path`).forEach(p => {
        p.style.fill = hexColor;
    });
}

function applyCurrentColors() {
    // Réapplique tout (utile quand on change de vue solo/tapis)
    for (const [zone, color] of Object.entries(currentColors)) {
        document.documentElement.style.setProperty(`--color-${zone}`, color);
        document.querySelectorAll(`#${zone} path`).forEach(p => {
            p.style.fill = color;
        });
    }
}