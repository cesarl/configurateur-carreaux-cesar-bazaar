// CONFIGURATEUR CÉSAR BAZAAR - ALPHA V2 (TAPIS dynamique)
const REPO_URL = "."; // Pour GitHub Pages, "." suffit
let currentCollection = null;
let currentColors = {}; // Stocke l'état actuel { "zone-1": "#hex", ... }
let activeZone = null;  // La zone qu'on est en train de modifier
let nuancierData = [];
const SIMULATION_GRID_SIZE = 5;    // Taille de la grille simulation (5x5)

const DRAFT_STORAGE_KEY = "cesar-bazaar-draft";

/** Sauvegarde le brouillon en cours en local (réutilisé si on rouvre la même collection sans recharger la page). */
function saveDraftToLocal() {
    if (!currentCollection) return;
    try {
        localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify({
            collectionId: currentCollection.id,
            colors: { ...currentColors }
        }));
    } catch (e) {
        console.warn("Impossible de sauvegarder le brouillon", e);
    }
}

/** Récupère le brouillon local pour une collection, ou null. */
function getDraftForCollection(collectionId) {
    try {
        const raw = localStorage.getItem(DRAFT_STORAGE_KEY);
        if (!raw) return null;
        const draft = JSON.parse(raw);
        return draft && draft.collectionId === collectionId ? draft.colors : null;
    } catch (e) {
        return null;
    }
}

/** Supprime le brouillon local (au chargement de la page sur la liste, pour que recharger = repartir de zéro). */
function clearDraftLocal() {
    try {
        localStorage.removeItem(DRAFT_STORAGE_KEY);
    } catch (e) {}
}

// ——— URL : sauvegarde / chargement de la config (collection + couleurs) ———
/** Lit les paramètres d'URL. Format human readable : ?collection=medina&zone-1=1d355f&zone-2=d9c4b8 */
function parseConfigFromUrl() {
    const params = new URLSearchParams(window.location.search);
    const collection = params.get("collection") || null;
    const colors = {};
    params.forEach((value, key) => {
        if (key.startsWith("zone-") && /^[0-9a-fA-F]{3,6}$/.test(value)) {
            colors[key] = value.startsWith("#") ? value : "#" + value;
        }
    });
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
    document.getElementById("view-gallery").style.display = "flex";
    document.getElementById("view-workspace").style.display = "none";
    await loadData();
    await renderGallery();
    setupNavigation();

    const { collection, colors } = parseConfigFromUrl();
    if (collection) {
        showWorkspace();
        await loadCollection(collection, colors);
    } else {
        // Arrivée sur la liste (URL propre ou rechargement) : on oublie le brouillon pour que recharger = modifs perdues
        clearDraftLocal();
    }
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

async function loadData() {
    console.log("📦 Chargement du nuancier...");
    try {
        const res = await fetch(`${REPO_URL}/data/nuancier.json`);
        nuancierData = await res.json();
        console.log(`✅ Nuancier chargé: ${nuancierData.length} couleurs disponibles`);
        renderPalette(nuancierData);
        setupPaletteDrawer();
        setupMobileViewBar();
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
    updateSidebarVisibility();

    // 4. Charger ROOT (obligatoire)
    await loadSVG("ROOT", currentCollection.id);
    
    // 5. Charger toutes les variations disponibles
    for (const variant of variationsList) {
        if (variant && variant !== "ROOT") {
            await loadSVG(variant, currentCollection.id);
        }
    }

    console.log(`📦 SVG chargés dans le cache:`, Object.keys(svgCache));

    renderInterface();

    if (urlColors && Object.keys(urlColors).length > 0) {
        Object.entries(urlColors).forEach(([zone, hex]) => {
            const normalized = hex.startsWith("#") ? hex : "#" + hex;
            if (/^#[0-9a-fA-F]{3,6}$/.test(normalized)) currentColors[zone] = normalized;
        });
        applyCurrentColors();
        updatePaletteHighlight();
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
    container.innerHTML = ""; // Vider
    container.className = `grid-view ${mode}`;

    if (mode === "solo") {
        // Juste le ROOT
        console.log("📐 Mode solo: affichage d'une seule tuile ROOT");
        container.innerHTML = prepareSVG(svgCache["ROOT"], 0, "ROOT");
    } else if (mode === "tapis" || mode === "simulation") {
        // Générer une vraie grille 5x5 pour la simulation
        console.log(`📐 Mode ${mode}: génération d'une grille ${SIMULATION_GRID_SIZE}x${SIMULATION_GRID_SIZE}`);
        // Set CSS grid dynamique
        container.style.display = "grid";
        container.style.gridTemplateColumns = `repeat(${SIMULATION_GRID_SIZE}, 1fr)`;
        container.style.gridTemplateRows = `repeat(${SIMULATION_GRID_SIZE}, 1fr)`;

        const variantes = [];
        if(svgCache["ROOT"]) variantes.push("ROOT");
        if(svgCache["VAR1"]) variantes.push("VAR1");
        if(svgCache["VAR2"]) variantes.push("VAR2");
        if(svgCache["VAR3"]) variantes.push("VAR3");

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
function prepareSVG(svgString, rotation = 0, varianteName = "ROOT", isTapisMode = false, row = 0, col = 0) {
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

// Détecte les zones existant dans le premier SVG affiché (dans Tapis, il y en a plusieurs!)
// On scanne TOUTES les zones de tous les SVG pour s'assurer d'interagir avec toutes.
function scanZones() {
    console.log("🔍 Scan des zones...");
    const zonesFound = new Set();
    
    // Scanner les zones dans l'éditeur (square 1)
    document.querySelectorAll("#editor-container svg g[id^='zone-']").forEach(g => {
        const zoneId = g.id;
        zonesFound.add(zoneId);
        makeZoneInteractive(zoneId);
        console.log(`  ✓ Zone trouvée dans l'éditeur: ${zoneId}`);
    });
    
    // Cherche tous les groupes G de zone dans tous les SVG visibles de la simulation
    document.querySelectorAll("#grid-container svg g[id^='zone-']").forEach(g => {
        const zoneId = g.id.replace(/^tapis-\d+-\d+-/, ""); // Ignorer le préfixe tapis
        zonesFound.add(zoneId);
        makeZoneInteractive(g.id);
        console.log(`  ✓ Zone trouvée dans la simulation: ${zoneId}`);
    });
    
    const zonesArray = Array.from(zonesFound).sort();
    console.log(`✅ Zones détectées (${zonesArray.length}):`, zonesArray);
}

// Rendez interactif toutes les zones sur tous les carreaux !
function makeZoneInteractive(zoneId) {
    // Cibler tous les groupes ayant la classe et l'id correspondants
    const fullZoneId = zoneId.includes('tapis-') ? zoneId : zoneId;
    const cleanZoneId = zoneId.replace(/^tapis-\d+-\d+-/, ""); // zone-X pur
    
    // Dans l'éditeur
    document.querySelectorAll(`#editor-container svg g#${cleanZoneId}`).forEach(el => {
        el.style.cursor = "pointer";
        el.onclick = (e) => {
            e.stopPropagation();
            selectActiveZone(cleanZoneId);
        };
        el.querySelectorAll('path').forEach(p => p.setAttribute("data-active", "true"));
    });
    
    // Dans la simulation
    document.querySelectorAll(`g[id$='${cleanZoneId}']`).forEach(el => {
        el.style.cursor = "pointer";
        el.onclick = (e) => {
            e.stopPropagation();
            selectActiveZone(cleanZoneId);
        };
        el.querySelectorAll('path').forEach(p => p.setAttribute("data-active", "true"));
    });
}

function updateSidebarVisibility() {
    const sidebar = document.getElementById("sidebar-palette-desktop");
    if (!sidebar) return;
    const hasZone = activeZone != null;
    sidebar.classList.toggle("sidebar-palette-desktop--no-zone", !hasZone);
    sidebar.setAttribute("aria-hidden", hasZone ? "false" : "true");
}

function selectActiveZone(zoneId) {
    console.log(`🎯 Sélection de la zone: ${zoneId}`);
    activeZone = zoneId;
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

/** Convertit une valeur fill (hex, rgb, nom) en hex #rrggbb ou null */
function parseFillToHex(fill) {
    if (!fill || String(fill).trim() === "" || String(fill).toLowerCase() === "none") return null;
    const s = String(fill).trim();
    if (s.startsWith("#")) return normalizeHex(s) || null;
    const rgbMatch = s.match(/rgba?\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
    if (rgbMatch) {
        const r = parseInt(rgbMatch[1], 10).toString(16).padStart(2, "0");
        const g = parseInt(rgbMatch[2], 10).toString(16).padStart(2, "0");
        const b = parseInt(rgbMatch[3], 10).toString(16).padStart(2, "0");
        return "#" + r + g + b;
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
        return "#" + r + g + b;
    }
    return null;
}

/** Magic Matching : extrait les couleurs par défaut du SVG ROOT et remplit currentColors */
function extractDefaultColors() {
    const zones = document.querySelectorAll("#editor-container svg g[id^='zone-']");
    if (!zones.length) return;
    console.log("🪄 Magic Matching: extraction des couleurs par défaut du SVG...");
    zones.forEach((g) => {
        const zoneId = g.id;
        const path = g.querySelector("path");
        const fillSource = path
            ? (path.getAttribute("fill") || getComputedStyle(path).fill)
            : (g.getAttribute("fill") || (g.style && g.style.fill) || "");
        const extractedHex = parseFillToHex(fillSource);
        if (!extractedHex) return;
        const normalized = normalizeHex(extractedHex);
        const inNuancier = nuancierData.find((c) => normalizeHex(c.hex) === normalized);
        if (inNuancier) {
            currentColors[zoneId] = inNuancier.hex;
            console.log(`  ✓ ${zoneId} → ${inNuancier.hex} (${inNuancier.nom})`);
        } else {
            console.warn(`Couleur ${extractedHex} non trouvée pour la zone ${zoneId}. Conservée pour le visuel.`);
            currentColors[zoneId] = extractedHex;
        }
    });
    console.log("✅ Magic Matching terminé. currentColors:", currentColors);
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
    console.log(`🎨 Rendu de la palette avec ${sorted.length} couleurs (ordre dégradé)`);

    const renderInto = (containerId) => {
        const container = document.getElementById(containerId);
        if (!container) return;
        container.innerHTML = "";
        sorted.forEach(c => {
            const div = document.createElement("div");
            div.className = "color-swatch";
            div.setAttribute("data-hex", normalizeHex(c.hex));
            div.style.backgroundColor = c.hex;
            div.title = c.nom;
            div.onclick = () => {
                applyColorToActiveZone(c.hex);
                if (window.matchMedia("(max-width: 900px)").matches) closePaletteDrawer();
            };
            container.appendChild(div);
        });
        updatePaletteHighlight();
    };
    renderInto("color-palette");
    renderInto("color-palette-drawer");
    console.log(`✅ Palette rendue (sidebar + drawer)`);
}

// Applique la couleur à tous les SVGs de TOUTES les cases du grid (utilise la classe partagée)
function applyColorToActiveZone(hexColor) {
    console.log(`🎨 Application de la couleur ${hexColor} à la zone ${activeZone}`);
    if (!activeZone) {
        alert("Sélectionnez d'abord une zone sur le dessin !");
        return;
    }
    // Mettre à jour la variable CSS pour le cas où tu as des styles CSS custom
    const cssVar = `--color-${activeZone}`;
    document.documentElement.style.setProperty(cssVar, hexColor);

    // 2. Stocker le choix
    currentColors[activeZone] = hexColor;
    console.log(`💾 Couleur sauvegardée: ${activeZone} = ${hexColor}`);
    updatePaletteHighlight();
    if (currentCollection) applyConfigToUrl();

    // 3. Appliquer sur l'éditeur (square 1)
    const editorPaths = document.querySelectorAll(`#editor-container svg g#${activeZone} path`);
    console.log(`  📝 Éditeur: ${editorPaths.length} path(s) trouvé(s)`);
    editorPaths.forEach(p => {
        p.style.fill = hexColor;
    });

    // 4. Par sécurité, force la couleur sur tous les paths correspondants sur tous les carreaux (class shared-zone-zone-X appliquée partout)
    const simulationPaths = document.querySelectorAll(`.shared-zone-${activeZone} path`);
    console.log(`  🎲 Simulation: ${simulationPaths.length} path(s) trouvé(s)`);
    simulationPaths.forEach(p => {
        p.style.fill = hexColor;
    });
    
    console.log(`✅ Couleur appliquée sur ${editorPaths.length + simulationPaths.length} path(s) au total`);
}

function applyCurrentColors() {
    console.log(`🔄 Réapplication des couleurs actuelles (${Object.keys(currentColors).length} zone(s))`);
    // Réapplique tout sur tous les SVG
    for (const [zone, color] of Object.entries(currentColors)) {
        console.log(`  🎨 Application ${zone} = ${color}`);
        document.documentElement.style.setProperty(`--color-${zone}`, color);
        
        // Appliquer sur l'éditeur
        const editorPaths = document.querySelectorAll(`#editor-container svg g#${zone} path`);
        editorPaths.forEach(p => {
            p.style.fill = color;
        });
        
        // Appliquer sur la simulation
        document.querySelectorAll(`.shared-zone-${zone} path`).forEach(p => {
            p.style.fill = color;
        });
    }
    console.log(`✅ Couleurs réappliquées`);
}

// Nouvelle fonction principale pour rendre l'interface Double Vue
function renderInterface() {
    console.log("🎨 Rendu de l'interface complète...");
    
    // 1. Injection du SVG éditeur (ROOT) dans #editor-container (SQUARE 1)
    console.log("📝 Square 1: Rendu de l'éditeur (ROOT)...");
    const editorContainer = document.getElementById("editor-container");
    if (!editorContainer) {
        console.error("❌ Élément #editor-container introuvable!");
        return;
    }
    editorContainer.innerHTML = ""; // Reset possible contents

    // Utiliser svgCache au lieu de SVGs
    if (!svgCache["ROOT"]) {
        console.error("❌ SVG ROOT non chargé dans le cache!");
        editorContainer.innerHTML = "<p style='padding: 20px; color: red;'>Erreur: SVG ROOT non chargé</p>";
        return;
    }

    // Préparer le SVG ROOT pour l'éditeur (sans préfixe tapis, sans rotation)
    const editorSVG = prepareSVG(svgCache["ROOT"], 0, "ROOT", false);
    editorContainer.innerHTML = editorSVG;
    console.log("✅ Éditeur (Square 1) rendu");

    extractDefaultColors();

    // 2. Générer la grille 5x5 dans #grid-container (SQUARE 2)
    console.log(`🎲 Square 2: Génération de la simulation ${SIMULATION_GRID_SIZE}x${SIMULATION_GRID_SIZE}...`);
    const gridContainer = document.getElementById("grid-container");
    if (!gridContainer) {
        console.error("❌ Élément #grid-container introuvable!");
        return;
    }
    gridContainer.innerHTML = ""; // Reset grille

    // Récupérer toutes les variantes disponibles
    const variants = [];
    if (svgCache["ROOT"]) variants.push("ROOT");
    if (svgCache["VAR1"]) variants.push("VAR1");
    if (svgCache["VAR2"]) variants.push("VAR2");
    if (svgCache["VAR3"]) variants.push("VAR3");
    
    console.log(`🎲 Variantes disponibles pour la simulation:`, variants);

    if (variants.length === 0) {
        console.error("❌ Aucune variante disponible!");
        gridContainer.innerHTML = "<p style='padding: 20px; color: red;'>Erreur: Aucune variante chargée</p>";
        return;
    }

    // Générer la grille 5x5 avec toutes les variantes
    gridContainer.style.display = "grid";
    gridContainer.style.gridTemplateColumns = `repeat(${SIMULATION_GRID_SIZE}, 1fr)`;
    gridContainer.style.gridTemplateRows = `repeat(${SIMULATION_GRID_SIZE}, 1fr)`;

    for (let row = 0; row < SIMULATION_GRID_SIZE; row++) {
        for (let col = 0; col < SIMULATION_GRID_SIZE; col++) {
            // Utiliser toutes les variantes de manière équilibrée
            const variantIndex = (row * SIMULATION_GRID_SIZE + col) % variants.length;
            const variant = variants[variantIndex];
            
            // Rotation aléatoire parmi 0, 90, 180, 270
            const angles = [0, 90, 180, 270];
            const rot = angles[Math.floor(Math.random() * angles.length)];
            
            // Préparer le SVG avec le préfixe tapis pour éviter les conflits d'ID
            const tileSVG = prepareSVG(svgCache[variant], rot, variant, true, row, col);
            gridContainer.innerHTML += tileSVG;
        }
    }
    console.log(`✅ Simulation ${SIMULATION_GRID_SIZE}x${SIMULATION_GRID_SIZE} générée avec ${variants.length} variante(s)`);

    // 3. Scanner les zones éditables
    scanZones();
    
    // 4. Réappliquer les couleurs (éditeur + simulation) et mettre à jour le nuancier
    applyCurrentColors();
    updatePaletteHighlight();
    
    console.log("✅ Interface complète rendue");
}