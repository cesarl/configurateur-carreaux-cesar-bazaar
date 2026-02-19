// CONFIGURATEUR CÉSAR BAZAAR - ALPHA V2 (TAPIS dynamique)
const REPO_URL = "."; // Pour GitHub Pages, "." suffit
let currentCollection = null;
let currentColors = {}; // Stocke l'état actuel { "zone-1": "#hex", ... }
let activeZone = null;  // La zone qu'on est en train de modifier
let nuancierData = [];  // Catalogue complet (brut)
let colorNameMap = {};  // Mapping de noms CSS -> hex (colorMatch.json)
let showAllColors = false; // true si ?nuancier=complet ou ?allColors=1
let currentLayout = "tapis"; // Layout de calepinage (tapis, damier, etc.)
let carouselIndex = 0; // Index de la slide du carrousel (0 = grille plate)
let livePreviewRestoreHex = null; // Couleur à restaurer au mouseleave (live preview)
const SIMULATION_GRID_SIZE = 5;    // Taille de la grille simulation (5x5)

const DRAFT_STORAGE_KEY = "cesar-bazaar-drafts";

/** Retourne tous les brouillons (par collection). */
function getAllDrafts() {
    try {
        const raw = localStorage.getItem(DRAFT_STORAGE_KEY);
        return raw ? JSON.parse(raw) : {};
    } catch (e) {
        return {};
    }
}

/** Sauvegarde le brouillon de la collection en cours (un brouillon par collection, on ne perd pas en changeant de collection). */
function saveDraftToLocal() {
    if (!currentCollection) return;
    try {
        const drafts = getAllDrafts();
        drafts[currentCollection.id] = { colors: { ...currentColors } };
        localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(drafts));
    } catch (e) {
        console.warn("Impossible de sauvegarder le brouillon", e);
    }
}

/** Récupère le brouillon local pour une collection, ou null. */
function getDraftForCollection(collectionId) {
    const drafts = getAllDrafts();
    const draft = drafts[collectionId];
    return draft && draft.colors ? draft.colors : null;
}

/** Supprime le brouillon d'une collection (ex. au reset pour repartir du SVG). */
function clearDraftForCollection(collectionId) {
    try {
        const drafts = getAllDrafts();
        delete drafts[collectionId];
        localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(drafts));
    } catch (e) {
        console.warn("Impossible de supprimer le brouillon", e);
    }
}

/** Supprime tous les brouillons (ex. au rechargement de la page sur la liste). */
function clearDraftLocal() {
    try {
        localStorage.removeItem(DRAFT_STORAGE_KEY);
    } catch (e) {}
}

// ——— URL : sauvegarde / chargement de la config (collection + couleurs) ———
/** Lit les paramètres d'URL. Format human readable : ?collection=medina&zone-1=1d355f&zone-2=d9c4b8 ; ?nuancier=complet ou ?allColors=1 pour toutes les couleurs */
function parseConfigFromUrl() {
    const params = new URLSearchParams(window.location.search);
    const collection = params.get("collection") || null;
    const colors = {};
    params.forEach((value, key) => {
        if (key.startsWith("zone-") && /^[0-9a-fA-F]{3,6}$/.test(value)) {
            colors[key] = value.startsWith("#") ? value : "#" + value;
        }
    });
    const nuancierParam = (params.get("nuancier") || "").toLowerCase();
    const allColorsParam = params.get("allColors");
    showAllColors = nuancierParam === "complet" || allColorsParam === "1" || allColorsParam === "true";
    return { collection, colors };
}

/** Met à jour l'URL avec la collection et les couleurs (sans # pour lisibilité). */
function applyConfigToUrl() {
    if (!currentCollection) return;
    const params = new URLSearchParams();
    params.set("collection", currentCollection.id);
    Object.entries(currentColors).forEach(([zone, hex]) => {
        const clean = (hex || "").replace(/^#/, "");
        if (clean) params.set(zone, clean.toLowerCase());
    });
    const newSearch = params.toString();
    const url = newSearch ? `${window.location.pathname}?${newSearch}` : window.location.pathname;
    window.history.replaceState({ collection: currentCollection.id, colors: currentColors }, "", url);
}

// Démarrage
document.addEventListener("DOMContentLoaded", async () => {
    console.log("🚀 Initialisation de l'application...");
    const { collection, colors } = parseConfigFromUrl(); // Doit être avant loadData pour showAllColors
    document.getElementById("view-gallery").style.display = "flex";
    document.getElementById("view-workspace").style.display = "none";
    await loadData();
    await renderGallery();
    setupNavigation();
    if (collection) {
        showWorkspace();
        await loadCollection(collection, colors);
    }
    // Les brouillons sont conservés par collection (localStorage) : pas de clear pour ne pas perdre les éditions
    console.log("✅ Application initialisée");
});

/** Trie les couleurs pour un ordre progressif type dégradé (HSL : teinte puis luminosité) */
function sortColorsForGradient(colors) {
    const hexToHsl = (hex) => {
        const n = hex.replace("#", "");
        const r = parseInt(n.slice(0, 2), 16) / 255;
        const g = parseInt(n.slice(2, 4), 16) / 255;
        const b = parseInt(n.slice(4, 6), 16) / 255;
        const max = Math.max(r, g, b), min = Math.min(r, g, b);
        let h = 0, s = 0, l = (max + min) / 2;
        if (max !== min) {
            const d = max - min;
            s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
            switch (max) {
                case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
                case g: h = ((b - r) / d + 2) / 6; break;
                case b: h = ((r - g) / d + 4) / 6; break;
            }
        }
        return [h * 360, s * 100, l * 100];
    };
    return [...colors].sort((a, b) => {
        const [h1, s1, l1] = hexToHsl(a.hex);
        const [h2, s2, l2] = hexToHsl(b.hex);
        if (Math.abs(h1 - h2) > 1) return h1 - h2;
        return l1 - l2;
    });
}

/** Retourne la liste des couleurs à afficher dans le nuancier (publiques seules sauf si showAllColors). */
function getVisibleNuancier() {
    if (showAllColors) return nuancierData;
    return nuancierData.filter(c => c.publique !== false);
}

async function loadData() {
    console.log("📦 Chargement du nuancier...");
    try {
        const res = await fetch(`${REPO_URL}/data/nuancier.json`);
        nuancierData = await res.json();
        // Charger le mapping des noms de couleurs CSS -> hex (ex: "sienna" -> "#a0522d")
        try {
            const resColors = await fetch(`${REPO_URL}/data/colorMatch.json`);
            colorNameMap = await resColors.json();
            console.log("🎨 colorMatch chargé (noms CSS -> hex).");
        } catch (e) {
            console.warn("⚠️ Impossible de charger colorMatch.json, fallback sur le navigateur pour les noms CSS.", e);
        }
        console.log(`✅ Nuancier chargé: ${nuancierData.length} couleurs (affichées: ${getVisibleNuancier().length})`);
        renderPalette(getVisibleNuancier());
        setupPaletteDrawer();
    } catch (e) {
        console.error("❌ Erreur chargement données", e);
    }
}

// Navigation entre Gallery et Workspace
function setupNavigation() {
    const btnBack = document.getElementById("btn-back");
    if (btnBack) {
        btnBack.addEventListener("click", () => {
            showGallery();
        });
    }
    const btnReset = document.getElementById("btn-reset-collection");
    if (btnReset) {
        btnReset.addEventListener("click", () => {
            resetCollectionToDefault();
        });
    }
}

/** Réinitialise les couleurs de la collection courante aux valeurs par défaut du SVG. */
function resetCollectionToDefault() {
    if (!currentCollection) return;
    const variants = getVariantsList();
    if (!variants.length) return;
    // 1. Supprimer le brouillon de cette collection du localStorage pour ne plus restaurer l'ancien état
    clearDraftForCollection(currentCollection.id);
    // 2. Repartir de zéro : re-parse le SVG (toutes variantes) et remplit currentColors
    currentColors = {};
    const name = currentCollection.name || currentCollection.id || "?";
    console.log(`[Reset] Extraction couleurs par défaut — ${name}`);
    variants.forEach((v) => extractDefaultColorsFromSvg(svgCache[v], `[reset ${name}] ${v}`));
    // 3. Appliquer sur le calepinage et mettre à jour toute l'interface
    applyCurrentColors();
    renderActiveColorPills();
    updateSidebarRecap();
    updatePaletteHighlight();
    updateMoldingWarning();
    applyConfigToUrl();
    // 4. Sauvegarder cet état "défaut SVG" comme nouveau brouillon
    saveDraftToLocal();
}

function setupMobileViewBar() {
    const workspace = document.getElementById("workspace");
    const btnEditor = document.getElementById("mobile-btn-editor");
    const btnSimulation = document.getElementById("mobile-btn-simulation");
    const bar = document.getElementById("mobile-view-bar");
    if (!workspace || !bar) return;

    const setView = (view) => {
        workspace.classList.remove("mobile-view-editor", "mobile-view-simulation");
        workspace.classList.add(view === "editor" ? "mobile-view-editor" : "mobile-view-simulation");
        bar.setAttribute("aria-hidden", "false");
        if (btnEditor) btnEditor.classList.toggle("active", view === "editor");
        if (btnSimulation) btnSimulation.classList.toggle("active", view === "simulation");
    };

    if (btnEditor) btnEditor.addEventListener("click", () => setView("editor"));
    if (btnSimulation) btnSimulation.addEventListener("click", () => setView("simulation"));
}

function showGallery() {
    // Sauvegarder le brouillon en local pour restaurer si on rouvre la même collection (sans recharger)
    saveDraftToLocal();
    // Nettoyer l'URL pour que un rechargement ramène bien sur la liste des collections
    window.history.replaceState({}, "", window.location.pathname || "/");
    document.getElementById("view-gallery").style.display = "flex";
    document.getElementById("view-workspace").style.display = "none";
}

function showWorkspace() {
    document.getElementById("view-gallery").style.display = "none";
    document.getElementById("view-workspace").style.display = "flex";
}

// Générer la Gallery avec les collections
async function renderGallery() {
    console.log("🖼️ Génération de la Gallery...");
    try {
        const res = await fetch(`${REPO_URL}/data/collections.json`);
        if (!res.ok) {
            console.error(`❌ Erreur HTTP: ${res.status} ${res.statusText}`);
            return;
        }
        const collections = await res.json();
        console.log(`📚 Collections chargées: ${collections.length}`, collections);

        const galleryGrid = document.getElementById("gallery-grid");
        if (!galleryGrid) {
            console.error("❌ Élément #gallery-grid introuvable!");
            return;
        }

        galleryGrid.innerHTML = "";
        
        if (collections.length === 0) {
            console.warn("⚠️ Aucune collection trouvée dans le JSON");
            galleryGrid.innerHTML = "<p style='padding: 20px; text-align: center; color: #666;'>Aucune collection disponible</p>";
            return;
        }

        collections.forEach((collection) => {
            console.log(`  📦 Création de la carte pour: ${collection.nom || collection.id}`);
            const card = document.createElement("div");
            card.className = "gallery-card";
            card.onclick = () => {
                saveDraftToLocal(); // sauve la collection affichée avant d'ouvrir une autre (brouillon par collection)
                showWorkspace();
                const draftColors = getDraftForCollection(collection.id);
                loadCollection(collection.id, draftColors || undefined);
            };

            const imageUrl = collection.collection_image || "";
            const title = collection.nom || collection.id || "";

            // Créer l'élément image
            const imageDiv = document.createElement("div");
            imageDiv.className = "gallery-card-image";
            if (imageUrl) {
                imageDiv.style.backgroundImage = `url('${imageUrl}')`;
                console.log(`    🖼️ Image URL: ${imageUrl}`);
            } else {
                console.warn(`    ⚠️ Pas d'image pour ${title}`);
            }

            // Créer l'overlay avec le titre
            const overlayDiv = document.createElement("div");
            overlayDiv.className = "gallery-card-overlay";
            
            const titleElement = document.createElement("h3");
            titleElement.className = "gallery-card-title";
            titleElement.textContent = title;
            
            overlayDiv.appendChild(titleElement);
            imageDiv.appendChild(overlayDiv);
            card.appendChild(imageDiv);

            galleryGrid.appendChild(card);
            console.log(`    ✅ Carte créée pour: ${title}`);
        });

        console.log(`✅ Gallery générée avec ${collections.length} collection(s)`);
    } catch (e) {
        console.error("❌ Erreur lors de la génération de la Gallery", e);
    }
}

async function loadCollection(id, urlColors = null) {
    console.log(`📚 Chargement de la collection: ${id}`);
    
    const res = await fetch(`${REPO_URL}/data/collections.json`);
    const collections = await res.json();
    currentCollection = collections.find(c => c.id.toLowerCase() === String(id).toLowerCase()) || collections.find(c => c.id === id);

    // Si la collection n'est pas trouvée, charger la première disponible
    if (!currentCollection) {
        if (collections.length === 0) {
            alert("Aucune collection disponible");
            showGallery();
            return;
        }
        console.warn(`⚠️ Collection "${id}" introuvable. Chargement de la première collection disponible : "${collections[0].id}"`);
        currentCollection = collections[0];
    }

    console.log(`✅ Collection trouvée: ${currentCollection.nom}`);
    console.log(`📋 Variations déclarées:`, currentCollection.variations);

    document.getElementById("collection-title").innerText = currentCollection.nom;

    // 2. Parser les variations (peut être une chaîne "VAR1, VAR2, VAR3" ou un tableau)
    let variationsList = [];
    if (Array.isArray(currentCollection.variations)) {
        // Si c'est un tableau, vérifier si c'est une chaîne unique ou plusieurs éléments
        if (currentCollection.variations.length === 1 && typeof currentCollection.variations[0] === 'string' && currentCollection.variations[0].includes(',')) {
            // Parser la chaîne "VAR1, VAR2, VAR3"
            variationsList = currentCollection.variations[0].split(',').map(v => v.trim().toUpperCase());
        } else {
            // Tableau normal
            variationsList = currentCollection.variations.map(v => typeof v === 'string' ? v.trim().toUpperCase() : v);
        }
    } else if (typeof currentCollection.variations === 'string') {
        variationsList = currentCollection.variations.split(',').map(v => v.trim().toUpperCase());
    }

    console.log(`🔄 Variations parsées:`, variationsList);

    // 3. Réinitialiser le cache et les couleurs
    Object.keys(svgCache).forEach(key => delete svgCache[key]);
    currentColors = {};
    activeZone = null;
    const layouts = Array.isArray(currentCollection.layouts) && currentCollection.layouts.length
        ? currentCollection.layouts
        : ["tapis"];
    currentLayout = currentCollection.defaut_layout && layouts.includes(currentCollection.defaut_layout)
        ? currentCollection.defaut_layout
        : layouts[0];
    updateSidebarVisibility();

    // 4. Charger uniquement les variations déclarées dans le JSON (plus de ROOT)
    for (const variant of variationsList) {
        if (variant) await loadSVG(variant, currentCollection.id);
    }

    console.log(`📦 SVG chargés dans le cache:`, Object.keys(svgCache));

    renderInterface();

    if (urlColors && Object.keys(urlColors).length > 0) {
        Object.entries(urlColors).forEach(([zone, hex]) => {
            const normalized = hex.startsWith("#") ? hex : "#" + hex;
            if (/^#[0-9a-fA-F]{3,6}$/.test(normalized)) currentColors[zone] = normalized;
        });
        applyCurrentColors();
        renderActiveColorPills();
        updateSidebarRecap();
        updatePaletteHighlight();
        updateMoldingWarning();
    }
    applyConfigToUrl();
}


// Cache pour stocker le code SVG texte et éviter de re-télécharger
const svgCache = {};

async function loadSVG(type, collectionId) {
    // 1. ON FORCE TOUT EN MAJUSCULE
    const safeId = collectionId.toUpperCase().trim();
    const safeType = type.toUpperCase().trim();
    const filename = `${safeId}-${safeType}.svg`;

    console.log(`🔍 Tentative de chargement : ${filename}`); 

    try {
        const res = await fetch(`${REPO_URL}/assets/svg/${filename}`);
        if (!res.ok) {
            throw new Error(`Erreur 404 : Le fichier ${filename} n'existe pas.`);
        }
        const text = await res.text();
        svgCache[type] = text; 
        console.log(`✅ Succès : ${filename} chargé.`);
    } catch (e) {
        console.error(`❌ Échec chargement SVG`, e);
        alert(`Impossible de trouver le fichier : ${filename}\nVérifie qu'il est bien dans le dossier /assets/svg/ sur GitHub et qu'il est bien en MAJUSCULES.`);
    }
}

function setGridMode(mode) {
    console.log(`🎨 setGridMode appelé avec mode: ${mode}`);
    const container = document.getElementById("grid-container");
    container.innerHTML = "";
    container.className = `grid-view ${mode}`;
    const variantes = getVariantsList();
    if (!variantes.length) return;

    if (mode === "solo") {
        console.log("📐 Mode solo: affichage d'une seule tuile (première variante)");
        container.innerHTML = prepareSVG(svgCache[variantes[0]], 0, variantes[0]);
    } else if (mode === "tapis" || mode === "simulation") {
        console.log(`📐 Mode ${mode}: génération d'une grille ${SIMULATION_GRID_SIZE}x${SIMULATION_GRID_SIZE}`);
        container.style.display = "grid";
        container.style.gridTemplateColumns = `repeat(${SIMULATION_GRID_SIZE}, 1fr)`;
        container.style.gridTemplateRows = `repeat(${SIMULATION_GRID_SIZE}, 1fr)`;

        console.log(`🎲 Variantes disponibles pour la grille:`, variantes);

        // Alternance ou random possible. Ici : alternance sur damier (ligne+col pair/impair)
        for (let row = 0; row < SIMULATION_GRID_SIZE; row++) {
            for (let col = 0; col < SIMULATION_GRID_SIZE; col++) {
                // Choix du SVG (alterné ou random)
                let variante;
                if(variantes.length > 1) {
                    // Utiliser toutes les variantes de manière équilibrée
                    const index = (row * SIMULATION_GRID_SIZE + col) % variantes.length;
                    variante = variantes[index];
                } else {
                    variante = variantes[0];
                }
                // Rotation aléatoire parmi 0, 90, 180, 270
                const angles = [0, 90, 180, 270];
                const rot = angles[Math.floor(Math.random() * angles.length)];
                // Pour garantir appli couleur, on injecte une "zone-générale" (shared)
                container.innerHTML += prepareSVG(svgCache[variante], rot, variante, true, row, col);
            }
        }
        console.log(`✅ Grille ${SIMULATION_GRID_SIZE}x${SIMULATION_GRID_SIZE} générée avec ${variantes.length} variante(s)`);
    } else {
        // fallback
        container.innerHTML = "";
    }

    scanZones();
    applyCurrentColors();
}

// Ajoute une classe partagée pour chaque zone-id trouvée dans le SVG pour garantir l'appli des couleurs sur tous les carreaux
function prepareSVG(svgString, rotation = 0, varianteName = "VAR1", isTapisMode = false, row = 0, col = 0) {
    if (!svgString) {
        console.warn(`⚠️ prepareSVG: svgString vide pour ${varianteName}`);
        return "";
    }
    
    // Crée un DOM temporaire pour manipuler le SVG
    const parser = new DOMParser();
    const doc = parser.parseFromString(svgString, "image/svg+xml");
    const svg = doc.querySelector('svg');
    if (!svg) {
        console.warn(`⚠️ prepareSVG: aucun élément <svg> trouvé pour ${varianteName}`);
        return '';
    }

    // IMPORTANT: ajouter les classes shared-zone AVANT le préfixe tapis
    // car après le préfixe, les ids commencent par "tapis-", pas "zone-"
    svg.querySelectorAll('g[id^="zone-"]').forEach(g => {
        const zoneId = g.id; // ID original (ex: zone-1)
        g.classList.add(`shared-zone-${zoneId}`);
    });

    // Pour garantir unicité de l'id SVG (évite conflits d'id multiples dans le DOM).
    // Ajoute un préfixe unique selon la position dans la grille (tapis only)
    if (isTapisMode) {
        let prefix = `tapis-${row}-${col}-`;
        svg.querySelectorAll('[id]').forEach(el => {
            const oldId = el.id;
            el.id = prefix + oldId;
        });
    }

    // Ajoute une rotation au niveau du wrapper
    // le style overflow: visible évite que la rotation coupe le SVG
    const rotStyle = `transform: rotate(${rotation}deg);overflow:visible;`;

    // Donne un index pour debug si besoin
    return `<div class="tile-wrapper" style="${rotStyle}">${svg.outerHTML}</div>`;
}

// Détecte les zones dans le calepinage (#grid-container) uniquement (preview-first : plus d'éditeur)
function scanZones() {
    console.log("🔍 Scan des zones...");
    const zonesFound = new Set();
    const gridContainer = document.getElementById("grid-container");
    if (!gridContainer) return;
    gridContainer.querySelectorAll("svg g[id^='zone-'], svg g[id^='tapis-']").forEach(g => {
        const zoneId = g.id.replace(/^tapis-\d+-\d+-/, "");
        if (zoneId.startsWith("zone-")) {
            zonesFound.add(zoneId);
            makeZoneInteractive(g.id);
        }
    });
    console.log(`✅ Zones détectées (${zonesFound.size}):`, [...zonesFound].sort());
}

// Rendez interactif les zones du calepinage (preview-first : uniquement #grid-container)
function makeZoneInteractive(zoneId) {
    const cleanZoneId = zoneId.replace(/^tapis-\d+-\d+-/, "");
    document.querySelectorAll(`#grid-container g[id$='${cleanZoneId}']`).forEach(el => {
        el.style.cursor = "pointer";
        el.onclick = (e) => {
            e.stopPropagation();
            selectActiveZone(cleanZoneId);
        };
        el.querySelectorAll("path").forEach(p => p.setAttribute("data-active", "true"));
    });
}

// Preview-first : sidebar toujours visible sur desktop ; on affiche/masque le message "aucune zone"
function updateSidebarVisibility() {
    const msg = document.getElementById("sidebar-no-zone-msg");
    const palette = document.getElementById("color-palette");
    if (msg) msg.style.display = activeZone ? "none" : "block";
    if (palette) palette.style.display = activeZone ? "grid" : "none";
}

function selectActiveZone(zoneId) {
    activeZone = zoneId;
    renderActiveColorPills();
    updateSidebarVisibility();
    updatePaletteHighlight();
    if (window.matchMedia("(max-width: 900px)").matches) openPaletteDrawer();
}

function openPaletteDrawer() {
    const drawer = document.getElementById("palette-drawer");
    const overlay = document.getElementById("palette-drawer-overlay");
    if (drawer) {
        drawer.classList.add("open");
        drawer.setAttribute("aria-hidden", "false");
        if (overlay) {
            overlay.classList.add("visible");
            overlay.setAttribute("aria-hidden", "false");
        }
        updatePaletteHighlight();
        // Scroll vers la couleur active après que le tiroir soit visible
        if (window.matchMedia("(max-width: 900px)").matches) {
            setTimeout(() => updatePaletteHighlight(), 400);
        }
    }
}

function closePaletteDrawer() {
    const drawer = document.getElementById("palette-drawer");
    const overlay = document.getElementById("palette-drawer-overlay");
    if (drawer) {
        drawer.classList.remove("open");
        drawer.setAttribute("aria-hidden", "true");
        if (overlay) {
            overlay.classList.remove("visible");
            overlay.setAttribute("aria-hidden", "true");
        }
    }
}

function setupPaletteDrawer() {
    const overlay = document.getElementById("palette-drawer-overlay");
    if (overlay) overlay.addEventListener("click", closePaletteDrawer);
}

/** Normalise un hex pour comparaison (minuscules, 6 caractères, # préfixe) */
function normalizeHex(hex) {
    if (!hex || typeof hex !== "string") return "";
    const h = hex.replace(/#/g, "").trim().toLowerCase();
    if (h.length === 6) return "#" + h;
    if (h.length === 3) return "#" + h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    return "#" + h;
}

/** Convertit une valeur fill (hex, rgb, nom) en hex #rrggbb ou null. Optionnel: log détaillé. */
function parseFillToHex(fill, logContext = null) {
    if (!fill || String(fill).trim() === "" || String(fill).toLowerCase() === "none") {
        if (logContext) console.log(`  [parseFill] ${logContext} fill vide ou "none" → null`);
        return null;
    }
    const s = String(fill).trim();
    if (s.startsWith("#")) {
        const hex = normalizeHex(s) || null;
        if (logContext) console.log(`  [parseFill] ${logContext} type=hex raw="${s}" → ${hex}`);
        return hex;
    }
    const nameKey = s.toLowerCase().replace(/\s+/g, "");
    if (colorNameMap && colorNameMap[nameKey]) {
        const hex = normalizeHex(colorNameMap[nameKey]);
        if (logContext) console.log(`  [parseFill] ${logContext} type=string raw="${s}" → colorMatch.json["${nameKey}"] = ${hex}`);
        return hex;
    }
    const rgbMatch = s.match(/rgba?\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
    if (rgbMatch) {
        const r = parseInt(rgbMatch[1], 10).toString(16).padStart(2, "0");
        const g = parseInt(rgbMatch[2], 10).toString(16).padStart(2, "0");
        const b = parseInt(rgbMatch[3], 10).toString(16).padStart(2, "0");
        const hex = "#" + r + g + b;
        if (logContext) console.log(`  [parseFill] ${logContext} type=rgb raw="${s}" → ${hex}`);
        return hex;
    }
    const div = document.createElement("div");
    div.style.color = s;
    div.style.display = "none";
    document.body.appendChild(div);
    const computed = getComputedStyle(div).color;
    document.body.removeChild(div);
    const m = computed.match(/rgba?\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
    if (m) {
        const r = parseInt(m[1], 10).toString(16).padStart(2, "0");
        const g = parseInt(m[2], 10).toString(16).padStart(2, "0");
        const b = parseInt(m[3], 10).toString(16).padStart(2, "0");
        const hex = "#" + r + g + b;
        if (logContext) console.log(`  [parseFill] ${logContext} type=string (navigateur) raw="${s}" → ${hex}`);
        return hex;
    }
    if (logContext) console.warn(`  [parseFill] ${logContext} type=string raw="${s}" → non trouvé (ni colorMatch.json, ni rgb, ni navigateur)`);
    return null;
}

/** Retourne la nuance du nuancier la plus proche d'un hex (distance RGB). */
function findClosestNuancierHex(hex) {
    if (!hex || !nuancierData.length) return null;
    const norm = normalizeHex(hex);
    const exact = nuancierData.find((c) => normalizeHex(c.hex) === norm);
    if (exact) return exact.hex;
    const hexToRgb = (h) => {
        const x = h.replace(/^#/, "");
        const n = x.length === 3 ? x[0] + x[0] + x[1] + x[1] + x[2] + x[2] : x;
        return [parseInt(n.slice(0, 2), 16), parseInt(n.slice(2, 4), 16), parseInt(n.slice(4, 6), 16)];
    };
    const [r0, g0, b0] = hexToRgb(norm);
    let best = null;
    let bestDist = Infinity;
    nuancierData.forEach((c) => {
        const [r, g, b] = hexToRgb(normalizeHex(c.hex));
        const d = (r - r0) ** 2 + (g - g0) ** 2 + (b - b0) ** 2;
        if (d < bestDist) {
            bestDist = d;
            best = c.hex;
        }
    });
    return best;
}

/** Extrait les couleurs par défaut d'un SVG (une variante) et les fusionne dans currentColors. logPrefix optionnel pour la console. */
function extractDefaultColorsFromSvg(svgString, logPrefix = "") {
    if (!svgString) return;
    const parser = new DOMParser();
    const doc = parser.parseFromString(svgString, "image/svg+xml");
    const zones = doc.querySelectorAll("svg g[id^='zone-']");
    zones.forEach((g) => {
        const zoneId = g.id;
        const path = g.querySelector("path");
        const fillSource = path ? (path.getAttribute("fill") || "") : (g.getAttribute("fill") || "");
        const ctx = logPrefix ? `${logPrefix} ${zoneId} fill="${fillSource}"` : "";
        const extractedHex = parseFillToHex(fillSource, ctx || undefined);
        if (!extractedHex) {
            if (logPrefix) console.log(`  [extract] ${logPrefix} ${zoneId} ignoré (parseFillToHex → null)`);
            return;
        }
        const normalized = normalizeHex(extractedHex);
        let inNuancier = nuancierData.find((c) => normalizeHex(c.hex) === normalized);
        if (!inNuancier) {
            const closest = findClosestNuancierHex(extractedHex);
            if (logPrefix) console.log(`  [extract] ${logPrefix} ${zoneId} hex=${extractedHex} pas dans nuancier → plus proche: ${closest || "aucun"}`);
            currentColors[zoneId] = closest || extractedHex;
        } else {
            if (logPrefix) console.log(`  [extract] ${logPrefix} ${zoneId} hex=${extractedHex} trouvé dans nuancier`);
            currentColors[zoneId] = inNuancier.hex;
        }
    });
}

/** Retourne la liste des variantes à utiliser : celles du JSON collection présentes dans le cache (plus de ROOT) */
function getVariantsList() {
    if (!currentCollection || !currentCollection.variations) return [];
    let list = [];
    if (Array.isArray(currentCollection.variations)) {
        if (currentCollection.variations.length === 1 && typeof currentCollection.variations[0] === "string" && currentCollection.variations[0].includes(",")) {
            list = currentCollection.variations[0].split(",").map((v) => v.trim().toUpperCase());
        } else {
            list = currentCollection.variations.map((v) => (typeof v === "string" ? v.trim().toUpperCase() : v));
        }
    } else if (typeof currentCollection.variations === "string") {
        list = currentCollection.variations.split(",").map((v) => v.trim().toUpperCase());
    }
    return list.filter((v) => v && svgCache[v]);
}

/** Remplit la rangée de pastilles "couleurs actives" (une par zone) */
function renderActiveColorPills() {
    const row = document.getElementById("active-colors-row");
    if (!row) return;
    row.innerHTML = "";
    const zoneIds = Object.keys(currentColors).sort();
    zoneIds.forEach((zoneId) => {
        const pill = document.createElement("button");
        pill.type = "button";
        pill.className = "active-color-pill" + (activeZone === zoneId ? " active" : "");
        pill.style.backgroundColor = currentColors[zoneId] || "#ccc";
        pill.setAttribute("aria-label", `Zone ${zoneId} : choisir couleur`);
        pill.onclick = () => selectActiveZone(zoneId);
        row.appendChild(pill);
    });
}

/** Remplit le sélecteur de calepinage (boutons pilules Tapis, Damier, etc.) */
function renderLayoutSelector() {
    const container = document.getElementById("layout-selector");
    if (!container) return;
    const layouts = Array.isArray(currentCollection.layouts) && currentCollection.layouts.length
        ? currentCollection.layouts
        : ["tapis"];
    container.innerHTML = "";
    const labels = { tapis: "Tapis", damier: "Damier", solo: "Grille plate" };
    layouts.forEach((layoutId) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "layout-pill" + (currentLayout === layoutId ? " active" : "");
        btn.textContent = labels[layoutId] || layoutId;
        btn.onclick = () => {
            currentLayout = layoutId;
            renderLayoutSelector();
            renderCalepinageOnly();
        };
        container.appendChild(btn);
    });
}

/** Reconstruit uniquement le calepinage (grille) selon currentLayout — appelé au changement de layout */
function renderCalepinageOnly() {
    const gridContainer = document.getElementById("grid-container");
    if (!gridContainer) return;
    const variants = getVariantsList();
    if (!variants.length) return;
    gridContainer.innerHTML = "";
    gridContainer.style.display = "grid";
    gridContainer.style.gridTemplateColumns = `repeat(${SIMULATION_GRID_SIZE}, 1fr)`;
    gridContainer.style.gridTemplateRows = `repeat(${SIMULATION_GRID_SIZE}, 1fr)`;
    for (let row = 0; row < SIMULATION_GRID_SIZE; row++) {
        for (let col = 0; col < SIMULATION_GRID_SIZE; col++) {
            const variant = variants[(row * SIMULATION_GRID_SIZE + col) % variants.length];
            const angles = [0, 90, 180, 270];
            const rot = angles[Math.floor(Math.random() * angles.length)];
            gridContainer.innerHTML += prepareSVG(svgCache[variant], rot, variant, true, row, col);
        }
    }
    scanZones();
    applyCurrentColors();
    renderActiveColorPills();
    updateMoldingWarning();
}

/** Récapitulatif sidebar : pastille + Nom, Code, Pantone, RAL par zone */
function updateSidebarRecap() {
    const list = document.getElementById("sidebar-recap-list");
    if (!list) return;
    list.innerHTML = "";
    const zoneIds = Object.keys(currentColors).sort();
    zoneIds.forEach((zoneId) => {
        const hex = normalizeHex(currentColors[zoneId]);
        const colorInfo = nuancierData.find((c) => normalizeHex(c.hex) === hex);
        const row = document.createElement("div");
        row.className = "sidebar-recap-row";
        row.innerHTML = `
            <span class="sidebar-recap-pill" style="background:${currentColors[zoneId]}"></span>
            <span class="sidebar-recap-info">
                <span class="recap-name">${colorInfo ? colorInfo.nom : "—"}</span>
                <span class="recap-code">${colorInfo ? colorInfo.id : ""} ${colorInfo && colorInfo.pantone ? " · Pantone " + colorInfo.pantone : ""} ${colorInfo && colorInfo.ral ? " · RAL " + colorInfo.ral : ""}</span>
            </span>`;
        list.appendChild(row);
    });
}

/** Affiche ou masque la bannière warning si deux zones ont la même couleur */
function updateMoldingWarning() {
    const banner = document.getElementById("molding-warning-banner");
    if (!banner) return;
    const hexValues = Object.values(currentColors).map(normalizeHex).filter(Boolean);
    const hasDuplicates = hexValues.length !== new Set(hexValues).size;
    if (hasDuplicates) {
        banner.textContent = "⚠️ Attention : ce motif est conçu pour des couleurs distinctes par zone. Si deux zones partagent la même couleur, une légère trace peut apparaître sur le carreau final.";
        banner.style.display = "block";
    } else {
        banner.style.display = "none";
    }
}

/** Met à jour la surbrillance du nuancier (couleur de la zone active) et scroll mobile vers cette couleur */
function updatePaletteHighlight() {
    const hex = activeZone ? normalizeHex(currentColors[activeZone]) : null;
    const swatches = document.querySelectorAll("#color-palette .color-swatch, #color-palette-drawer .color-swatch");
    let found = false;
    swatches.forEach(el => {
        const elHex = normalizeHex(el.getAttribute("data-hex") || "");
        const isSelected = !!hex && elHex === hex;
        if (isSelected) found = true;
        el.classList.toggle("selected", isSelected);
    });
    if (hex && !found) {
        const drawerHexes = Array.from(document.querySelectorAll("#color-palette-drawer .color-swatch"))
            .map(el => el.getAttribute("data-hex"));
        console.error(
            "[Nuancier] Couleur active non trouvée dans la liste.",
            { zone: activeZone, recherché: hex, dansLeTiroir: drawerHexes }
        );
    }
    // Desktop : scroll de la sidebar pour mettre la couleur sélectionnée au plus haut
    if (window.matchMedia("(min-width: 901px)").matches && hex) {
        const sidebar = document.querySelector(".sidebar");
        const selectedSwatch = document.querySelector("#color-palette .color-swatch.selected");
        if (sidebar && selectedSwatch) {
            requestAnimationFrame(() => {
                const sidebarRect = sidebar.getBoundingClientRect();
                const swatchRect = selectedSwatch.getBoundingClientRect();
                const swatchTopRelative = swatchRect.top - sidebarRect.top + sidebar.scrollTop;
                sidebar.scrollTop = Math.max(0, swatchTopRelative - 20);
            });
        }
    }
    // Mobile : scroll du tiroir pour amener la couleur sélectionnée au centre
    if (window.matchMedia("(max-width: 900px)").matches && hex) {
        const drawerBody = document.querySelector(".palette-drawer-body");
        const selectedSwatch = document.querySelector("#color-palette-drawer .color-swatch.selected");
        if (drawerBody && selectedSwatch) {
            requestAnimationFrame(() => {
                const bodyRect = drawerBody.getBoundingClientRect();
                const swatchRect = selectedSwatch.getBoundingClientRect();
                const centerOffset = (bodyRect.width - swatchRect.width) / 2;
                const newScroll = drawerBody.scrollLeft + (swatchRect.left - bodyRect.left) - centerOffset;
                drawerBody.scrollLeft = Math.max(0, newScroll);
            });
        }
    }
}

function renderPalette(colors) {
    const sorted = sortColorsForGradient(colors);
    let tooltipEl = document.getElementById("color-swatch-tooltip");
    if (!tooltipEl && document.getElementById("color-palette")) {
        tooltipEl = document.createElement("div");
        tooltipEl.id = "color-swatch-tooltip";
        tooltipEl.className = "color-swatch-tooltip";
        tooltipEl.setAttribute("role", "tooltip");
        document.body.appendChild(tooltipEl);
    }

    const renderInto = (containerId, isDesktopSidebar) => {
        const container = document.getElementById(containerId);
        if (!container) return;
        container.innerHTML = "";
        sorted.forEach(c => {
            const div = document.createElement("div");
            div.className = "color-swatch";
            div.setAttribute("data-hex", normalizeHex(c.hex));
            div.style.backgroundColor = c.hex;
            div.title = c.nom;
            div.setAttribute("data-nom", c.nom || "");
            div.setAttribute("data-code", c.id || "");
            div.setAttribute("data-pantone", c.pantone || "");
            div.setAttribute("data-ral", c.ral || "");
            div.onclick = () => {
                applyColorToActiveZone(c.hex);
                if (window.matchMedia("(max-width: 900px)").matches) closePaletteDrawer();
            };
            if (isDesktopSidebar && tooltipEl) {
                div.addEventListener("mouseenter", function () {
                    const nom = this.getAttribute("data-nom") || "";
                    const code = this.getAttribute("data-code") || "";
                    const pantone = this.getAttribute("data-pantone") || "";
                    const ral = this.getAttribute("data-ral") || "";
                    tooltipEl.innerHTML = `<span class="tooltip-name">${nom}</span><span class="tooltip-code">Code: ${code}</span>${pantone ? `<span class="tooltip-pantone">Pantone: ${pantone}</span>` : ""}${ral ? `<span class="tooltip-ral">RAL: ${ral}</span>` : ""}`;
                    const rect = this.getBoundingClientRect();
                    tooltipEl.style.left = `${rect.left}px`;
                    tooltipEl.style.top = `${rect.top - 8}px`;
                    tooltipEl.style.transform = "translateY(-100%)";
                    tooltipEl.classList.add("visible");
                    if (activeZone) {
                        livePreviewRestoreHex = currentColors[activeZone] ? normalizeHex(currentColors[activeZone]) : null;
                        const hoverHex = (this.getAttribute("data-hex") || "").startsWith("#") ? this.getAttribute("data-hex") : "#" + (this.getAttribute("data-hex") || "");
                        document.querySelectorAll(`.shared-zone-${activeZone} path`).forEach(p => { p.style.fill = hoverHex; });
                    }
                });
                div.addEventListener("mouseleave", function () {
                    tooltipEl.classList.remove("visible");
                    if (activeZone && livePreviewRestoreHex != null) {
                        const restoreHex = livePreviewRestoreHex.startsWith("#") ? livePreviewRestoreHex : "#" + livePreviewRestoreHex;
                        document.querySelectorAll(`.shared-zone-${activeZone} path`).forEach(p => { p.style.fill = restoreHex; });
                        livePreviewRestoreHex = null;
                    }
                });
            }
            container.appendChild(div);
        });
        updatePaletteHighlight();
    };
    renderInto("color-palette", true);
    renderInto("color-palette-drawer", false);
    console.log(`✅ Palette rendue (sidebar + drawer)`);
}

// Applique la couleur au calepinage (preview-first : uniquement #grid-container)
function applyColorToActiveZone(hexColor) {
    if (!activeZone) {
        alert("Sélectionnez d'abord une zone sur le dessin ou une pastille !");
        return;
    }
    document.documentElement.style.setProperty(`--color-${activeZone}`, hexColor);
    currentColors[activeZone] = hexColor;
    updatePaletteHighlight();
    if (currentCollection) applyConfigToUrl();
    const paths = document.querySelectorAll(`.shared-zone-${activeZone} path`);
    paths.forEach(p => { p.style.fill = hexColor; });
    livePreviewRestoreHex = null; // après validation, plus de restauration au survol
    renderActiveColorPills();
    updateSidebarRecap();
    updateMoldingWarning();
}

function applyCurrentColors() {
    for (const [zone, color] of Object.entries(currentColors)) {
        document.documentElement.style.setProperty(`--color-${zone}`, color);
        document.querySelectorAll(`.shared-zone-${zone} path`).forEach(p => { p.style.fill = color; });
    }
}

// Preview-first : calepinage seul, pastilles, sélecteur de layout (uniquement les variantes du JSON, plus de ROOT)
function renderInterface() {
    const variants = getVariantsList();
    if (!variants.length) {
        const gridContainer = document.getElementById("grid-container");
        if (gridContainer) gridContainer.innerHTML = "<p style='padding:20px;color:red;'>Erreur: aucune variante chargée. Vérifiez les fichiers SVG (VAR1, VAR2, …) dans assets/svg/.</p>";
        return;
    }
    currentColors = {};
    const collName = currentCollection?.name || currentCollection?.id || "?";
    console.log(`[Ouverture SVG] Extraction couleurs par défaut — ${collName}`);
    variants.forEach((v) => extractDefaultColorsFromSvg(svgCache[v], `[${collName}] ${v}`));
    console.log(`[Ouverture SVG] Couleurs extraites:`, Object.keys(currentColors).sort(), currentColors);
    renderCalepinageOnly();
    renderActiveColorPills();
    renderLayoutSelector();
    updatePaletteHighlight();
    updateSidebarRecap();
    updateSidebarVisibility();
    updateMoldingWarning();
    setupCarousel();
}

// ——— Carrousel (swipe + boutons) ———
function setupCarousel() {
    const track = document.getElementById("carousel-track");
    const prevBtn = document.getElementById("carousel-prev");
    const nextBtn = document.getElementById("carousel-next");
    const slides = document.querySelectorAll(".carousel-slide");
    if (!track || !slides.length) return;

    function goTo(index) {
        carouselIndex = Math.max(0, Math.min(index, slides.length - 1));
        track.style.transform = `translateX(-${carouselIndex * 100}%)`;
        slides.forEach((s, i) => s.classList.toggle("carousel-slide-active", i === carouselIndex));
    }

    if (prevBtn) prevBtn.onclick = () => goTo(carouselIndex - 1);
    if (nextBtn) nextBtn.onclick = () => goTo(carouselIndex + 1);

    let touchStartX = 0;
    let touchEndX = 0;
    track.addEventListener("touchstart", (e) => { touchStartX = e.changedTouches[0].screenX; }, { passive: true });
    track.addEventListener("touchend", (e) => {
        touchEndX = e.changedTouches[0].screenX;
        const diff = touchStartX - touchEndX;
        if (Math.abs(diff) > 50) goTo(diff > 0 ? carouselIndex + 1 : carouselIndex - 1);
    }, { passive: true });

    document.addEventListener("keydown", (e) => {
        if (document.getElementById("view-workspace").style.display !== "flex") return;
        if (e.key === "ArrowLeft") goTo(carouselIndex - 1);
        if (e.key === "ArrowRight") goTo(carouselIndex + 1);
    });
    goTo(carouselIndex);
}