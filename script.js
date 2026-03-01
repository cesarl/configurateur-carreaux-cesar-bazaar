// CONFIGURATEUR CÉSAR BAZAAR - ALPHA V2 (TAPIS dynamique)
const REPO_URL = "."; // Pour GitHub Pages, "." suffit
let currentCollection = null;
let currentColors = {}; // Stocke l'état actuel { "zone-1": "#hex", ... }
let activeZone = null;  // La zone qu'on est en train de modifier
let nuancierData = [];  // Catalogue complet (brut)
let colorNameMap = {};  // Mapping de noms CSS -> hex (colorMatch.json)
let showAllColors = false; // true si ?nuancier=complet ou ?allColors=1
let currentLayout = "aleatoire"; // Layout de calepinage (id du calepinage ou "solo")
let calepinagesData = []; // Calepinages chargés depuis data/calepinages.json
let mockupsData = []; // Mockups en situation (data/mockups.json)
let carouselIndex = 0; // Index de la slide du carrousel (0 = grille plate)
let livePreviewRestoreHex = null; // Couleur à restaurer au mouseleave (live preview)
const SIMULATION_GRID_SIZE = 5;    // Fallback pour setGridMode / legacy
const CALEPINAGE_ZOOM_MIN = 2;     // Zoom max = 2×2 carreaux
const CALEPINAGE_ZOOM_MAX = 20;    // Zoom min = 20×20 carreaux
const CALEPINAGE_ZOOM_DEFAULT = 5;
const CALEPINAGE_ZOOM_STORAGE_KEY = "cesar-bazaar-calepinage-zoom";
const CALEPINAGE_JOINTS_STORAGE_KEY = "cesar-bazaar-calepinage-joints";
let calepinageZoom = CALEPINAGE_ZOOM_DEFAULT;  // Grille = calepinageZoom × calepinageZoom (persisté au changement)
let showJoints = false;  // Afficher les joints (1px trait gris pointillé autour des carreaux)
let gridCols = CALEPINAGE_ZOOM_DEFAULT;
let gridRows = CALEPINAGE_ZOOM_DEFAULT;

const DRAFT_STORAGE_KEY = "cesar-bazaar-drafts";

function loadCalepinageZoom() {
    try {
        const v = parseInt(localStorage.getItem(CALEPINAGE_ZOOM_STORAGE_KEY), 10);
        if (Number.isFinite(v) && v >= CALEPINAGE_ZOOM_MIN && v <= CALEPINAGE_ZOOM_MAX) {
            calepinageZoom = v;
            gridCols = gridRows = v;
        }
    } catch (e) {}
}
function saveCalepinageZoom() {
    try {
        localStorage.setItem(CALEPINAGE_ZOOM_STORAGE_KEY, String(calepinageZoom));
    } catch (e) {}
}
function loadCalepinageJoints() {
    try {
        const v = localStorage.getItem(CALEPINAGE_JOINTS_STORAGE_KEY);
        showJoints = v === "1" || v === "true";
    } catch (e) {}
}
function saveCalepinageJoints() {
    try {
        localStorage.setItem(CALEPINAGE_JOINTS_STORAGE_KEY, showJoints ? "1" : "0");
    } catch (e) {}
}

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

/** Retourne l'URL de restauration (collection + couleurs) pour partage / PDF. */
function getRestoreUrl() {
    applyConfigToUrl();
    return window.location.href;
}

/** True si la slide est une vue mockup en perspective 3D (html2canvas ne la restitue pas, on exclut de la capture). */
function slideHas3DPerspective(slideEl) {
    if (!slideEl || !slideEl.getAttribute) return false;
    const idx = parseInt(slideEl.getAttribute("data-slide-index"), 10);
    if (idx <= 0) return false;
    const mockup = mockupsData[idx - 1];
    return mockup && mockup.perspective === true;
}

/** Masque le bouton Partager quand la vue active est un mockup en perspective. */
function updateShareButtonVisibility() {
    const btn = document.getElementById("btn-share");
    if (!btn) return;
    const activeSlide = document.querySelector(".carousel-slide-active");
    if (slideHas3DPerspective(activeSlide)) {
        btn.style.display = "none";
        btn.setAttribute("aria-hidden", "true");
    } else {
        btn.style.display = "";
        btn.setAttribute("aria-hidden", "false");
    }
}

/** Retourne un nom de fichier sûr pour export (collection). */
function getExportBaseName() {
    const name = (currentCollection && currentCollection.nom) ? currentCollection.nom : "configuration";
    return name.replace(/[<>:"/\\|?*]/g, "").trim() || "configuration";
}

// ——— Export image (partage réseaux / WhatsApp) ———
/** Capture la slide active du carrousel en image, ajoute un watermark "César Bazaar", partage ou télécharge. (Vue en perspective non supportée : partage du lien.) */
async function shareCurrentViewAsImage() {
    const activeSlide = document.querySelector(".carousel-slide-active");
    const container = activeSlide ? activeSlide.closest(".carousel-track-container") : null;
    if (!activeSlide || !container) {
        fallbackShareLink();
        return;
    }
    if (slideHas3DPerspective(activeSlide)) {
        fallbackShareLink();
        return;
    }
    if (typeof html2canvas === "undefined") {
        fallbackShareLink();
        return;
    }
    showShareImageLoadingOverlay();
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    try {
        const canvas = await html2canvas(activeSlide, {
            scale: 2,
            useCORS: true,
            allowTaint: true,
            backgroundColor: "#ffffff",
            logging: false
        });
        const ctx = canvas.getContext("2d");
        if (ctx) {
            ctx.font = "14px sans-serif";
            ctx.fillStyle = "rgba(0,0,0,0.5)";
            ctx.textAlign = "right";
            ctx.textBaseline = "bottom";
            const pad = 8;
            ctx.fillText("César Bazaar", canvas.width - pad, canvas.height - pad);
        }
        const baseName = getExportBaseName() + " carreaux de ciment César Bazaar - personnalisation";
        canvas.toBlob(async (blob) => {
            hideShareImageLoadingOverlay();
            if (!blob) {
                fallbackShareLink();
                return;
            }
            const file = new File([blob], baseName + ".png", { type: "image/png" });
            const urlToShare = getRestoreUrl();
            if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
                try {
                    await navigator.share({
                        title: baseName,
                        text: currentCollection ? `Ma configuration ${currentCollection.nom}` : "",
                        url: urlToShare,
                        files: [file]
                    });
                } catch (e) {
                    if (e.name !== "AbortError") downloadImageFromBlob(blob, baseName);
                }
            } else {
                downloadImageFromBlob(blob, baseName);
                if (navigator.clipboard && navigator.clipboard.writeText) {
                    navigator.clipboard.writeText(urlToShare).then(() => {}).catch(() => {});
                }
            }
        }, "image/png");
    } catch (e) {
        hideShareImageLoadingOverlay();
        console.warn("Capture partage échouée", e);
        fallbackShareLink();
    }
}

function showShareImageLoadingOverlay() {
    const el = document.getElementById("share-image-loading-overlay");
    if (el) {
        el.style.display = "flex";
        el.setAttribute("aria-hidden", "false");
    }
}

function hideShareImageLoadingOverlay() {
    const el = document.getElementById("share-image-loading-overlay");
    if (el) {
        el.style.display = "none";
        el.setAttribute("aria-hidden", "true");
    }
}

function fallbackShareLink() {
    const url = getRestoreUrl();
    if (navigator.share) {
        navigator.share({
            title: document.title,
            url: url,
            text: currentCollection ? `Collection ${currentCollection.nom}` : ""
        }).catch(() => {});
    } else {
        navigator.clipboard.writeText(url).then(() => {
            if (typeof alert !== "undefined") alert("Lien copié dans le presse-papier.");
        }).catch(() => {});
    }
}

function downloadImageFromBlob(blob, baseName) {
    const name = (baseName != null ? baseName : getExportBaseName() + " carreaux de ciment César Bazaar - personnalisation");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name + ".png";
    a.click();
    URL.revokeObjectURL(a.href);
}

// ——— Export PDF ———
function showPdfLoadingOverlay() {
    const el = document.getElementById("pdf-loading-overlay");
    if (el) {
        el.style.display = "flex";
        el.setAttribute("aria-hidden", "false");
    }
}

function hidePdfLoadingOverlay() {
    const el = document.getElementById("pdf-loading-overlay");
    if (el) {
        el.style.display = "none";
        el.setAttribute("aria-hidden", "true");
    }
}

/** Génère et télécharge un PDF : page d'info (collection, couleurs, lien) + une page par vue (grille + mockups). */
async function exportPdf() {
    if (typeof html2canvas === "undefined" || typeof jspdf === "undefined") {
        if (typeof alert !== "undefined") alert("Export PDF indisponible (bibliothèques non chargées).");
        return;
    }
    if (!currentCollection) return;
    const track = document.getElementById("carousel-track");
    const slides = document.querySelectorAll(".carousel-slide");
    if (!track || !slides.length) {
        hidePdfLoadingOverlay();
        return;
    }
    const savedIndex = carouselIndex;
    showPdfLoadingOverlay();
    applyConfigToUrl();
    const restoreUrl = window.location.href;

    try {
        const { jsPDF } = jspdf;
        const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
        const pageW = doc.internal.pageSize.getWidth();
        const pageH = doc.internal.pageSize.getHeight();
        const margin = 15;
        let y = margin;

        const collectionTitle = (currentCollection.nom || "Configuration") + " carreaux de ciment César Bazaar";
        const docTitle = collectionTitle + " - personnalisation";
        if (typeof doc.setProperties === "function") {
            doc.setProperties({ title: docTitle });
        }

        doc.setFontSize(18);
        doc.text(collectionTitle, margin, y);
        y += 10;
        if (currentCollection.description) {
            doc.setFontSize(10);
            doc.text(currentCollection.description, margin, y);
            y += 8;
        }
        doc.setFontSize(12);
        doc.text("Couleurs choisies", margin, y);
        y += 6;
        const zoneIds = Object.keys(currentColors).sort();
        const circleRadius = 1.5;
        const circleX = margin + circleRadius + 0.5;
        const textStartX = margin + circleRadius * 2 + 2;
        zoneIds.forEach((zoneId) => {
            if (y > pageH - margin - 10) {
                doc.addPage();
                y = margin;
            }
            const hex = normalizeHex(currentColors[zoneId]);
            const colorInfo = nuancierData.find((c) => normalizeHex(c.hex) === hex);
            const line = colorInfo
                ? `${zoneId}: ${colorInfo.nom || ""} ${colorInfo.id || ""} ${colorInfo.pantone ? " Pantone " + colorInfo.pantone : ""} ${colorInfo.ral ? " RAL " + colorInfo.ral : ""} (${hex})`
                : `${zoneId}: ${hex}`;
            const r = parseInt(hex.slice(1, 3), 16);
            const g = parseInt(hex.slice(3, 5), 16);
            const b = parseInt(hex.slice(5, 7), 16);
            doc.setFillColor(r, g, b);
            doc.circle(circleX, y - 0.5, circleRadius, "F");
            doc.setTextColor(0, 0, 0);
            doc.setFontSize(9);
            doc.text(line, textStartX, y);
            y += 5;
        });
        y += 6;
        if (y > pageH - margin - 15) {
            doc.addPage();
            y = margin;
        }
        doc.setFontSize(10);
        const linkText = "Retrouvez ici la configuration que vous avez fait de la collection " + (currentCollection.nom || "cette collection");
        doc.setTextColor(0, 0, 255);
        doc.textWithLink(linkText, margin, y, { url: restoreUrl });
        doc.setTextColor(0, 0, 0);
        y += 15;

        if (y > pageH - 20) {
            doc.addPage();
            y = margin;
        }

        for (let i = 0; i < slides.length; i++) {
            if (slideHas3DPerspective(slides[i])) continue;
            setCarouselSlideForCapture(track, slides, i);
            await new Promise((r) => setTimeout(r, 150));
            try {
                const canvas = await html2canvas(slides[i], {
                    scale: 2,
                    useCORS: true,
                    allowTaint: true,
                    backgroundColor: "#ffffff",
                    logging: false
                });
                const imgW = canvas.width;
                const imgH = canvas.height;
                const ratio = imgH / imgW;
                const maxW = pageW - 2 * margin;
                const maxH = pageH - 2 * margin;
                let w = maxW;
                let h = w * ratio;
                if (h > maxH) {
                    h = maxH;
                    w = h / ratio;
                }
                if (y + h > pageH - margin) {
                    doc.addPage();
                    y = margin;
                }
                const imgData = canvas.toDataURL("image/png");
                doc.addImage(imgData, "PNG", margin, y, w, h);
                y += h + 10;
            } catch (e) {
                console.warn("Capture slide " + i + " échouée", e);
            }
        }

        restoreCarouselSlide(track, slides, savedIndex);
        const pdfFilename = getExportBaseName() + " carreaux de ciment César Bazaar - personnalisation.pdf";
        doc.save(pdfFilename);
    } catch (e) {
        console.error("Export PDF échoué", e);
        if (typeof alert !== "undefined") alert("Erreur lors de la génération du PDF.");
    } finally {
        hidePdfLoadingOverlay();
        restoreCarouselSlide(track, slides, savedIndex);
    }
}

function setCarouselSlideForCapture(track, slides, index) {
    if (!track || !slides[index]) return;
    track.style.transform = `translateX(-${index * 100}%)`;
    slides.forEach((s, i) => s.classList.toggle("carousel-slide-active", i === index));
}

function restoreCarouselSlide(track, slides, index) {
    if (!track || !slides.length) return;
    const i = Math.max(0, Math.min(index, slides.length - 1));
    track.style.transform = `translateX(-${i * 100}%)`;
    slides.forEach((s, idx) => s.classList.toggle("carousel-slide-active", idx === i));
    carouselIndex = i;
    const dotsContainer = document.getElementById("carousel-dots");
    if (dotsContainer) {
        dotsContainer.querySelectorAll(".carousel-dot").forEach((d, idx) => d.classList.toggle("active", idx === i));
    }
    updateShareButtonVisibility();
    if (i === 0 && typeof positionGridWatermark === "function") {
        requestAnimationFrame(() => positionGridWatermark());
    }
}

// Démarrage
document.addEventListener("DOMContentLoaded", async () => {
    loadCalepinageJoints();
    const { collection, colors } = parseConfigFromUrl(); // Doit être avant loadData pour showAllColors
    document.getElementById("view-gallery").style.display = "flex";
    document.getElementById("view-workspace").style.display = "none";
    await loadData();
    await renderGallery();
    setupNavigation();
    setupHeaderMenu();
    setupOptionsDrawer();
    setupWorkspaceHeaderScroll();
    if (collection) {
        showCollectionLoadingOverlay();
        try {
            await loadCollection(collection, colors);
            await waitForMockupOverlayImages();
            showWorkspace();
            refreshWorkspaceLayoutAfterVisible();
        } finally {
            hideCollectionLoadingOverlay();
        }
    }
    // Les brouillons sont conservés par collection (localStorage) : pas de clear pour ne pas perdre les éditions
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
    try {
        const res = await fetch(`${REPO_URL}/data/nuancier.json`);
        nuancierData = await res.json();
        try {
            const resColors = await fetch(`${REPO_URL}/data/colorMatch.json`);
            colorNameMap = await resColors.json();
        } catch (e) {
            console.warn("Impossible de charger colorMatch.json, fallback sur le navigateur pour les noms CSS.", e);
        }
        renderPalette(getVisibleNuancier());
        setupPaletteDrawer();
        try {
            const resCal = await fetch(`${REPO_URL}/data/calepinages.json`);
            if (resCal.ok) {
                const raw = await resCal.json();
                calepinagesData = Array.isArray(raw) ? raw : [];
            }
        } catch (e) {
            console.warn("Impossible de charger calepinages.json, calepinages désactivés.", e);
            calepinagesData = [];
        }
        try {
            const resMockups = await fetch(`${REPO_URL}/data/mockups.json`);
            if (resMockups.ok) {
                const raw = await resMockups.json();
                mockupsData = Array.isArray(raw) ? raw : [];
            }
        } catch (e) {
            console.warn("Impossible de charger mockups.json, mockups désactivés.", e);
            mockupsData = [];
        }
    } catch (e) {
        console.error("Erreur chargement données", e);
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
    const btnShare = document.getElementById("btn-share");
    if (btnShare) {
        btnShare.addEventListener("click", () => {
            shareCurrentViewAsImage();
        });
    }
    const btnExportPdf = document.getElementById("btn-export-pdf");
    if (btnExportPdf) {
        btnExportPdf.addEventListener("click", () => {
            exportPdf();
        });
    }
}

function setupHeaderMenu() {
    const trigger = document.getElementById("btn-header-menu");
    const dropdown = document.getElementById("header-menu-dropdown");
    const wrap = trigger && trigger.closest(".header-menu-wrap");
    if (!trigger || !dropdown || !wrap) return;

    function closeMenu() {
        if (document.activeElement && dropdown.contains(document.activeElement)) {
            trigger.focus({ preventScroll: true });
        }
        dropdown.classList.remove("is-open");
        trigger.setAttribute("aria-expanded", "false");
        dropdown.setAttribute("aria-hidden", "true");
    }

    function openMenu() {
        dropdown.classList.add("is-open");
        trigger.setAttribute("aria-expanded", "true");
        dropdown.setAttribute("aria-hidden", "false");
    }

    trigger.addEventListener("click", (e) => {
        e.stopPropagation();
        const isOpen = dropdown.classList.contains("is-open");
        if (isOpen) closeMenu();
        else openMenu();
    });

    document.addEventListener("click", (e) => {
        if (!dropdown.classList.contains("is-open")) return;
        if (wrap.contains(e.target)) return;
        closeMenu();
    });

    dropdown.querySelectorAll("button").forEach((btn) => {
        btn.addEventListener("click", () => closeMenu());
    });
}

function updateOptionsDrawerZoomVisibility() {
    const zoomBlock = document.getElementById("options-drawer-zoom");
    if (!zoomBlock) return;
    if (carouselIndex === 0) {
        zoomBlock.classList.remove("hidden");
    } else {
        zoomBlock.classList.add("hidden");
    }
}

function openOptionsDrawer() {
    const drawer = document.getElementById("options-drawer");
    const overlay = document.getElementById("options-drawer-overlay");
    const slider = document.getElementById("options-zoom-slider");
    if (drawer) {
        drawer.classList.add("open");
        drawer.setAttribute("aria-hidden", "false");
        if (overlay) {
            overlay.classList.add("visible");
            overlay.setAttribute("aria-hidden", "false");
        }
        if (slider) slider.value = String(calepinageZoom);
        const jointsCheckbox = document.getElementById("options-show-joints");
        if (jointsCheckbox) jointsCheckbox.checked = showJoints;
        updateOptionsDrawerZoomVisibility();
    }
}

function closeOptionsDrawer() {
    const drawer = document.getElementById("options-drawer");
    const overlay = document.getElementById("options-drawer-overlay");
    if (drawer) {
        drawer.classList.remove("open");
        drawer.setAttribute("aria-hidden", "true");
        if (overlay) {
            overlay.classList.remove("visible");
            overlay.setAttribute("aria-hidden", "true");
        }
    }
}

function applyShowJointsToGrid() {
    const gridContainer = document.getElementById("grid-container");
    if (gridContainer) {
        gridContainer.classList.toggle("show-joints", showJoints);
    }
    document.querySelectorAll(".mockup-tapis").forEach((el) => {
        el.classList.toggle("show-joints", showJoints);
    });
}

function setupOptionsDrawer() {
    const trigger = document.getElementById("btn-options-drawer");
    const overlay = document.getElementById("options-drawer-overlay");
    const slider = document.getElementById("options-zoom-slider");
    const jointsCheckbox = document.getElementById("options-show-joints");
    if (trigger) trigger.addEventListener("click", openOptionsDrawer);
    if (overlay) overlay.addEventListener("click", closeOptionsDrawer);
    if (slider) {
        slider.min = String(CALEPINAGE_ZOOM_MIN);
        slider.max = String(CALEPINAGE_ZOOM_MAX);
        slider.value = String(calepinageZoom);
        slider.addEventListener("input", () => {
            const v = parseInt(slider.value, 10);
            if (Number.isFinite(v)) setCalepinageZoom(v);
        });
    }
    if (jointsCheckbox) {
        jointsCheckbox.checked = showJoints;
        jointsCheckbox.addEventListener("change", () => {
            showJoints = jointsCheckbox.checked;
            saveCalepinageJoints();
            applyShowJointsToGrid();
        });
    }
}

function setupWorkspaceHeaderScroll() {
    const main = document.getElementById("workspace-main");
    const wrap = document.getElementById("workspace-header-wrap");
    const hint = document.getElementById("header-scroll-hint");
    if (!main || !wrap || !hint) return;
    let lastScrollTop = 0;
    const threshold = 40;
    const onScroll = () => {
        if (!window.matchMedia("(max-width: 900px)").matches) return;
        const st = main.scrollTop;
        if (st > threshold) {
            if (st > lastScrollTop) wrap.classList.add("header-retracted");
            else wrap.classList.remove("header-retracted");
        } else {
            wrap.classList.remove("header-retracted");
        }
        lastScrollTop = st;
        hint.setAttribute("aria-hidden", wrap.classList.contains("header-retracted") ? "false" : "true");
    };
    main.addEventListener("scroll", onScroll, { passive: true });
    hint.addEventListener("click", () => {
        wrap.classList.remove("header-retracted");
        hint.setAttribute("aria-hidden", "true");
    });
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
    variants.forEach((v) => extractDefaultColorsFromSvg(svgCache[v]));
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

function showCollectionLoadingOverlay() {
    const el = document.getElementById("collection-loading-overlay");
    if (el) el.setAttribute("aria-hidden", "false");
}

function hideCollectionLoadingOverlay() {
    const el = document.getElementById("collection-loading-overlay");
    if (el) el.setAttribute("aria-hidden", "true");
}

/** Attend que toutes les images .mockup-overlay soient chargées (après buildCarouselMockupSlides). */
function waitForMockupOverlayImages() {
    const imgs = document.querySelectorAll(".mockup-overlay");
    if (!imgs.length) return Promise.resolve();
    return Promise.all(Array.from(imgs).map((img) => {
        if (img.complete && img.naturalWidth > 0) return Promise.resolve();
        if (img.decode) return img.decode().catch(() => new Promise((r) => { img.onload = r; img.onerror = r; }));
        return new Promise((resolve) => { img.onload = resolve; img.onerror = resolve; });
    }));
}

async function renderGallery() {
    try {
        const res = await fetch(`${REPO_URL}/data/collections.json`);
        if (!res.ok) {
            console.error("Erreur HTTP:", res.status, res.statusText);
            return;
        }
        const collections = await res.json();
        const galleryGrid = document.getElementById("gallery-grid");
        if (!galleryGrid) {
            console.error("Élément #gallery-grid introuvable");
            return;
        }
        galleryGrid.innerHTML = "";
        if (collections.length === 0) {
            galleryGrid.innerHTML = "<p style='padding: 20px; text-align: center; color: #666;'>Aucune collection disponible</p>";
            return;
        }
        collections.forEach((collection) => {
            const card = document.createElement("div");
            card.className = "gallery-card";
            card.onclick = async () => {
                saveDraftToLocal(); // sauve la collection affichée avant d'ouvrir une autre (brouillon par collection)
                showCollectionLoadingOverlay();
                try {
                    await loadCollection(collection.id, getDraftForCollection(collection.id) || undefined);
                    await waitForMockupOverlayImages();
                    showWorkspace();
                    refreshWorkspaceLayoutAfterVisible();
                } finally {
                    hideCollectionLoadingOverlay();
                }
            };

            const imageUrl = collection.collection_image || "";
            const title = collection.nom || collection.id || "";

            // Créer l'élément image
            const imageDiv = document.createElement("div");
            imageDiv.className = "gallery-card-image";
            if (imageUrl) {
                imageDiv.style.backgroundImage = `url('${imageUrl}')`;
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
        });
    } catch (e) {
        console.error("Erreur lors de la génération de la Gallery", e);
    }
}

async function loadCollection(id, urlColors = null) {
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
        console.warn(`Collection "${id}" introuvable, chargement de "${collections[0].id}"`);
        currentCollection = collections[0];
    }
    const collectionLink = document.getElementById("collection-link");
    if (collectionLink) {
        collectionLink.textContent = currentCollection.nom;
        collectionLink.href = currentCollection.collection_url || "#";
    }

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

    // 3. Réinitialiser le cache et les couleurs
    Object.keys(svgCache).forEach(key => delete svgCache[key]);
    currentColors = {};
    activeZone = null;
    const layouts = Array.isArray(currentCollection.layouts) && currentCollection.layouts.length
        ? currentCollection.layouts
        : ["aleatoire"];
    currentLayout = currentCollection.defaut_layout && layouts.includes(currentCollection.defaut_layout)
        ? currentCollection.defaut_layout
        : layouts[0];
    updateSidebarVisibility();

    // 4. Charger uniquement les variations déclarées dans le JSON (plus de ROOT)
    for (const variant of variationsList) {
        if (variant) await loadSVG(variant, currentCollection.id);
    }
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
    try {
        const res = await fetch(`${REPO_URL}/assets/svg/${filename}`);
        if (!res.ok) {
            throw new Error(`Erreur 404 : Le fichier ${filename} n'existe pas.`);
        }
        const text = await res.text();
        svgCache[type] = text;
    } catch (e) {
        console.error("Échec chargement SVG", e);
        alert(`Impossible de trouver le fichier : ${filename}\nVérifie qu'il est bien dans le dossier /assets/svg/ sur GitHub et qu'il est bien en MAJUSCULES.`);
    }
}

/** Résolution (row, col) → { variantName, rotation } à partir d'un calepinage (block_size + matrix). */
function getCellSpec(calepinage, row, col, variantsList) {
    if (!variantsList.length) return { variantName: "VAR1", rotation: 0 };
    const [cols, rows] = calepinage.block_size;
    const bx = ((col % cols) + cols) % cols;
    const by = ((row % rows) + rows) % rows;
    const cell = calepinage.matrix.find((c) => c.x === bx && c.y === by);
    if (!cell) return { variantName: variantsList[0], rotation: 0 };

    let variantName;
    const tile = cell.tile;
    if (typeof tile === "number") {
        const index = Math.max(0, Math.min(tile - 1, variantsList.length - 1));
        variantName = variantsList[index];
    } else if (tile === "any") {
        variantName = variantsList[Math.floor(Math.random() * variantsList.length)];
    } else if (Array.isArray(tile)) {
        const choices = tile
            .map((n) => variantsList[Math.max(0, n - 1)])
            .filter(Boolean);
        variantName = choices.length ? choices[Math.floor(Math.random() * choices.length)] : variantsList[0];
    } else {
        variantName = variantsList[0];
    }

    let rotation = 0;
    const rot = cell.rot;
    if (rot === "random") {
        const angles = [0, 90, 180, 270];
        rotation = angles[Math.floor(Math.random() * angles.length)];
    } else if (typeof rot === "number" && [0, 90, 180, 270].includes(rot)) {
        rotation = rot;
    }

    return { variantName, rotation };
}

function setGridMode(mode) {
    const container = document.getElementById("grid-container");
    container.innerHTML = "";
    container.className = `grid-view ${mode}`;
    const variantes = getVariantsList();
    if (!variantes.length) return;

    if (mode === "solo") {
        container.innerHTML = prepareSVG(svgCache[variantes[0]], 0, variantes[0]);
    } else if (mode === "tapis" || mode === "simulation") {
        const calepinage = calepinagesData.find((c) => c.id === currentLayout);
        container.style.display = "grid";
        container.style.gridTemplateColumns = `repeat(${SIMULATION_GRID_SIZE}, 1fr)`;
        container.style.gridTemplateRows = `repeat(${SIMULATION_GRID_SIZE}, 1fr)`;
        if (calepinage) {
            for (let row = 0; row < SIMULATION_GRID_SIZE; row++) {
                for (let col = 0; col < SIMULATION_GRID_SIZE; col++) {
                    const { variantName, rotation } = getCellSpec(calepinage, row, col, variantes);
                    container.innerHTML += prepareSVG(svgCache[variantName], rotation, variantName, true, row, col);
                }
            }
        } else {
            for (let row = 0; row < SIMULATION_GRID_SIZE; row++) {
                for (let col = 0; col < SIMULATION_GRID_SIZE; col++) {
                    const index = (row * SIMULATION_GRID_SIZE + col) % variantes.length;
                    const variante = variantes[index];
                    const angles = [0, 90, 180, 270];
                    const rot = angles[Math.floor(Math.random() * angles.length)];
                    container.innerHTML += prepareSVG(svgCache[variante], rot, variante, true, row, col);
                }
            }
        }
    } else {
        // fallback
        container.innerHTML = "";
    }

    scanZones();
    applyCurrentColors();
}

/** Cache de tuiles préparées (variantName|rotation) -> HTML avec tapis-0-0-, vidé à chaque rendu. */
let preparedTileCache = {};

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
    // Remplir path, rect, circle, ellipse, polygon avec var(--color-zone-X) et classe zone-path.
    const fillableSelector = "path, rect, circle, ellipse, polygon";
    svg.querySelectorAll('g[id^="zone-"]').forEach(g => {
        const zoneId = g.id; // ID original (ex: zone-1)
        g.classList.add(`shared-zone-${zoneId}`);
        const varFill = `var(--color-${zoneId})`;
        g.querySelectorAll(fillableSelector).forEach(el => {
            el.setAttribute("fill", varFill);
            el.classList.add("zone-path");
        });
    });

    // Pour garantir unicité de l'id SVG (évite conflits d'id multiples dans le DOM).
    // En tapis : homothétie (scale uniforme) pour garder les carreaux carrés ; "slice" = couvrir la cellule sans déformer, overflow clippé par le wrapper.
    if (isTapisMode) {
        svg.setAttribute("preserveAspectRatio", "xMidYMid slice");
        let prefix = `tapis-${row}-${col}-`;
        svg.querySelectorAll('[id]').forEach(el => {
            const oldId = el.id;
            el.id = prefix + oldId;
        });
    }

    // Rotation : appliquée dans le SVG (évite décalages sous perspective CSS 3D) plutôt que sur le wrapper
    if (rotation !== 0) {
        const vb = svg.getAttribute("viewBox");
        let cx = 283.465, cy = 283.465; // défaut pour viewBox 0 0 566.93 566.93
        if (vb) {
            const p = vb.trim().split(/\s+/);
            if (p.length >= 4) {
                const w = parseFloat(p[2]), h = parseFloat(p[3]);
                cx = parseFloat(p[0]) + w / 2;
                cy = parseFloat(p[1]) + h / 2;
            }
        }
        const rotG = doc.createElementNS("http://www.w3.org/2000/svg", "g");
        rotG.setAttribute("transform", `rotate(${rotation},${cx},${cy})`);
        while (svg.firstChild) rotG.appendChild(svg.firstChild);
        svg.appendChild(rotG);
    }

    // Wrapper sans rotation (overflow hidden en tapis pour clipper le SVG "slice")
    const overflow = isTapisMode ? "hidden" : "visible";
    const rotStyle = `overflow:${overflow};`;

    return `<div class="tile-wrapper" style="${rotStyle}">${svg.outerHTML}</div>`;
}

/** Retourne le HTML d'une tuile pour (variantName, rotation, row, col) en réutilisant le cache. */
function getPreparedTileHTML(variantName, rotation, row, col) {
    const key = `${variantName}|${rotation}`;
    if (!preparedTileCache[key]) {
        preparedTileCache[key] = prepareSVG(svgCache[variantName], rotation, variantName, true, 0, 0);
    }
    return preparedTileCache[key].replace(/tapis-0-0-/g, `tapis-${row}-${col}-`);
}

/**
 * Calcule la matrice CSS matrix3d (homographie 2D) qui envoie le carré unité (0,0)-(1,1)
 * sur le quad défini par les 4 coins. corners = [topLeft, topRight, bottomRight, bottomLeft], chaque [x,y] en 0..1.
 */
function perspectiveMatrix3dFromCorners(corners) {
    const [[x0, y0], [x1, y1], [x2, y2], [x3, y3]] = corners;
    const A = [
        [1, 0, 0, 0, 0, 0, -x1, 0],
        [0, 0, 1, 0, 0, 0, 0, 0],
        [0, 1, 0, 0, 0, 0, 0, -x3],
        [0, 0, 0, 1, 0, 0, -y1, 0],
        [0, 0, 0, 0, 0, 1, 0, 0],
        [0, 0, 0, 0, 1, 0, 0, -y3],
        [1, 1, 0, 0, 0, 0, -x2, -x2],
        [0, 0, 0, 1, 1, 0, -y2, -y2]
    ];
    const b = [x1 - x0, x0, x3 - x0, y1 - y0, y0, y3 - y0, x2 - x0, y2 - y0];
    const x = solve8(A, b);
    if (!x) return "none";
    const [a, bVal, c, d, e, f, g, h] = x;
    return `matrix3d(${a},${d},0,${g}, ${bVal},${e},0,${h}, 0,0,0,0, ${c},${f},0,1)`;
}

/**
 * Homographie en espace pixels : map (0,0)-(sourceW,sourceH) vers les 4 coins en pixels.
 * On résout en coordonnées normalisées (0-1) pour la stabilité numérique, puis on met à l'échelle.
 */
function perspectiveMatrix3dFromPixelQuad(sourceW, sourceH, cornersPx) {
    const W = sourceW;
    const H = sourceH;
    if (W <= 0 || H <= 0) return "none";
    const corners01 = cornersPx.map(([x, y]) => [x / W, y / H]);
    const [[x0, y0], [x1, y1], [x2, y2], [x3, y3]] = corners01;
    const A = [
        [1, 0, 0, 0, 0, 0, -x1, 0],
        [0, 0, 1, 0, 0, 0, 0, 0],
        [0, 1, 0, 0, 0, 0, 0, -x3],
        [0, 0, 0, 1, 0, 0, -y1, 0],
        [0, 0, 0, 0, 0, 1, 0, 0],
        [0, 0, 0, 0, 1, 0, 0, -y3],
        [1, 1, 0, 0, 0, 0, -x2, -x2],
        [0, 0, 0, 1, 1, 0, -y2, -y2]
    ];
    const b = [x1 - x0, x0, x3 - x0, y1 - y0, y0, y3 - y0, x2 - x0, y2 - y0];
    const x = solve8(A, b);
    if (!x) return "none";
    const [a, bVal, c, d, e, f, g, h] = x;
    const A_ = a;
    const B_ = bVal * W / H;
    const C_ = c * W;
    const D_ = d * H / W;
    const E_ = e;
    const F_ = f * H;
    const G_ = g / W;
    const Hout = h / H;
    if ([A_, B_, C_, D_, E_, F_, G_, Hout].some(v => !Number.isFinite(v))) return "none";
    const nearAffine = Math.abs(G_) < 1e-6 && Math.abs(Hout) < 1e-6;
    if (nearAffine) {
        return `matrix(${A_},${D_},${B_},${E_},${C_},${F_})`;
    }
    return `matrix3d(${A_},${D_},0,${G_}, ${B_},${E_},0,${Hout}, 0,0,1,0, ${C_},${F_},0,1)`;
}

function solve8(A, b) {
    const n = 8;
    const M = A.map((row, i) => [...row, b[i]]);
    for (let col = 0; col < n; col++) {
        let pivot = col;
        for (let row = col + 1; row < n; row++) {
            if (Math.abs(M[row][col]) > Math.abs(M[pivot][col])) pivot = row;
        }
        [M[col], M[pivot]] = [M[pivot], M[col]];
        const pivotVal = M[col][col];
        const maxInCol = Math.max(...Array.from({ length: n }, (_, i) => Math.abs(M[i][col])));
        if (Math.abs(pivotVal) < Math.max(1e-10, maxInCol * 1e-8)) return null;
        const div = pivotVal;
        for (let j = 0; j <= n; j++) M[col][j] /= div;
        for (let i = 0; i < n; i++) {
            if (i === col) continue;
            const factor = M[i][col];
            for (let j = 0; j <= n; j++) M[i][j] -= factor * M[col][j];
        }
    }
    const x = M.map(row => row[n]);
    if (x.some(v => !Number.isFinite(v) || Math.abs(v) > 1e6)) return null;
    return x;
}

// Délégation d'événement : clic sur grille (vue plate ou mockup) pour sélectionner une zone.
function setupGridClickDelegation() {
    const carousel = document.getElementById("preview-carousel");
    if (!carousel || carousel._zoneClickDelegation) return;
    carousel._zoneClickDelegation = true;
    carousel.addEventListener("click", (e) => {
        const g = e.target.closest("g[id^='tapis-']");
        if (!g) return;
        const cleanZoneId = g.id.replace(/^tapis-\d+-\d+-/, "");
        if (cleanZoneId.startsWith("zone-")) {
            e.stopPropagation();
            selectActiveZone(cleanZoneId);
        }
    });
}

// Marque les groupes de zone comme cliquables (cursor). path, rect, etc. ont la classe zone-path (prepareSVG).
function scanZones() {
    const gridContainer = document.getElementById("grid-container");
    if (!gridContainer) return;
    const zoneGs = gridContainer.querySelectorAll("g[id^='tapis-']");
    for (let i = 0; i < zoneGs.length; i++) {
        if (zoneGs[i].id.includes("zone-")) zoneGs[i].style.cursor = "pointer";
    }
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

/** Convertit une valeur fill (hex, rgb, nom) en hex #rrggbb ou null. */
function parseFillToHex(fill) {
    if (!fill || String(fill).trim() === "" || String(fill).toLowerCase() === "none") return null;
    const s = String(fill).trim();
    if (s.startsWith("#")) return normalizeHex(s) || null;
    const nameKey = s.toLowerCase().replace(/\s+/g, "");
    if (colorNameMap && colorNameMap[nameKey]) return normalizeHex(colorNameMap[nameKey]);
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

/** Extrait les couleurs par défaut d'un SVG (une variante) et les fusionne dans currentColors. */
function extractDefaultColorsFromSvg(svgString) {
    if (!svgString) return;
    const parser = new DOMParser();
    const doc = parser.parseFromString(svgString, "image/svg+xml");
    const zones = doc.querySelectorAll("svg g[id^='zone-']");
    zones.forEach((g) => {
        const zoneId = g.id;
        const fillEl = g.querySelector("path, rect, circle, ellipse, polygon");
        const fillSource = fillEl ? (fillEl.getAttribute("fill") || "") : (g.getAttribute("fill") || "");
        const extractedHex = parseFillToHex(fillSource);
        if (!extractedHex) return;
        const normalized = normalizeHex(extractedHex);
        const inNuancier = nuancierData.find((c) => normalizeHex(c.hex) === normalized);
        currentColors[zoneId] = inNuancier ? inNuancier.hex : (findClosestNuancierHex(extractedHex) || extractedHex);
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

/** Remplit le sélecteur de calepinage (boutons pilules). Survol = preview, clic = valider. Sur mobile le tiroir ne se ferme qu'au clic en dehors. */
function renderLayoutSelector() {
    const layoutIds = Array.isArray(currentCollection.layouts) && currentCollection.layouts.length
        ? currentCollection.layouts
        : ["aleatoire"];
    const legacyLabels = { damier: "Damier", solo: "Grille plate" };
    const makePills = (container) => {
        if (!container) return;
        container.innerHTML = "";
        layoutIds.forEach((layoutId) => {
            const calepinage = calepinagesData.find((c) => c.id === layoutId);
            const label = calepinage ? calepinage.nom : (legacyLabels[layoutId] || layoutId);
            const btn = document.createElement("button");
            btn.type = "button";
            btn.className = "layout-pill" + (currentLayout === layoutId ? " active" : "");
            btn.textContent = label;
            btn.addEventListener("mouseenter", () => {
                renderCalepinageOnly(layoutId);
            });
            btn.addEventListener("mouseleave", () => {
                renderCalepinageOnly();
            });
            btn.onclick = () => {
                currentLayout = layoutId;
                renderLayoutSelector();
                renderCalepinageOnly();
                renderMockupSlides();
                if (window.matchMedia("(min-width: 901px)").matches) {
                    closeOptionsDrawer();
                }
            };
            container.appendChild(btn);
        });
    };
    makePills(document.getElementById("layout-selector"));
    makePills(document.getElementById("options-drawer-layout"));
}

/** Reconstruit uniquement le calepinage (grille). Si overrideLayout est fourni, l'utilise pour l'affichage sans modifier currentLayout (preview au survol). */
function renderCalepinageOnly(overrideLayout) {
    const gridContainer = document.getElementById("grid-container");
    if (!gridContainer) return;
    const layoutToUse = overrideLayout !== undefined ? overrideLayout : currentLayout;
    setupGridClickDelegation();
    const variants = getVariantsList();
    if (!variants.length) return;
    gridCols = calepinageZoom;
    gridRows = layoutToUse === "solo" ? calepinageZoom : getGridRowsForContainer();
    gridContainer.innerHTML = "";
    gridContainer.className = "grid-view " + (layoutToUse === "solo" ? "solo" : "tapis");

    if (layoutToUse === "solo") {
        gridContainer.style.display = "block";
        gridContainer.innerHTML = prepareSVG(svgCache[variants[0]], 0, variants[0]);
    } else {
        preparedTileCache = {};
        gridContainer.style.display = "grid";
        gridContainer.style.gridTemplateColumns = `repeat(${gridCols}, 1fr)`;
        gridContainer.style.gridTemplateRows = `repeat(${gridRows}, 1fr)`;
        const calepinage = calepinagesData.find((c) => c.id === layoutToUse);
        const parts = [];
        if (calepinage) {
            for (let row = 0; row < gridRows; row++) {
                for (let col = 0; col < gridCols; col++) {
                    const { variantName, rotation } = getCellSpec(calepinage, row, col, variants);
                    parts.push(getPreparedTileHTML(variantName, rotation, row, col));
                }
            }
        } else {
            for (let row = 0; row < gridRows; row++) {
                for (let col = 0; col < gridCols; col++) {
                    const variant = variants[(row * gridCols + col) % variants.length];
                    const angles = [0, 90, 180, 270];
                    const rot = angles[Math.floor(Math.random() * angles.length)];
                    parts.push(getPreparedTileHTML(variant, rot, row, col));
                }
            }
        }
        gridContainer.innerHTML = parts.join("");
        requestAnimationFrame(() => applyGridSizeFromContainer());
    }
    applyCurrentColors();
    if (overrideLayout === undefined) {
        renderActiveColorPills();
        updateMoldingWarning();
    }
    applyShowJointsToGrid();
    if (layoutToUse !== "solo") {
        requestAnimationFrame(() => positionGridWatermark());
    } else {
        requestAnimationFrame(() => requestAnimationFrame(() => positionGridWatermark()));
    }
    if (typeof requestIdleCallback !== "undefined") {
        requestIdleCallback(() => scanZones(), { timeout: 200 });
    } else {
        setTimeout(() => scanZones(), 0);
    }
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
                    const rect = this.getBoundingClientRect();
                    const nom = this.getAttribute("data-nom") || "";
                    const code = this.getAttribute("data-code") || "";
                    const pantone = this.getAttribute("data-pantone") || "";
                    const ral = this.getAttribute("data-ral") || "";
                    tooltipEl.innerHTML = `<span class="tooltip-name">${nom}</span><span class="tooltip-code">Code: ${code}</span>${pantone ? `<span class="tooltip-pantone">Pantone: ${pantone}</span>` : ""}${ral ? `<span class="tooltip-ral">RAL: ${ral}</span>` : ""}`;
                    tooltipEl.style.left = `${rect.left}px`;
                    tooltipEl.style.top = `${rect.top - 8}px`;
                    tooltipEl.style.transform = "translateY(-100%)";
                    tooltipEl.classList.add("visible");
                    if (activeZone) {
                        livePreviewRestoreHex = currentColors[activeZone] ? normalizeHex(currentColors[activeZone]) : null;
                        const hoverHex = (this.getAttribute("data-hex") || "").startsWith("#") ? this.getAttribute("data-hex") : "#" + (this.getAttribute("data-hex") || "");
                        document.documentElement.style.setProperty(`--color-${activeZone}`, hoverHex);
                    }
                });
                div.addEventListener("mouseleave", function () {
                    tooltipEl.classList.remove("visible");
                    if (activeZone && livePreviewRestoreHex != null) {
                        const restoreHex = livePreviewRestoreHex.startsWith("#") ? livePreviewRestoreHex : "#" + livePreviewRestoreHex;
                        document.documentElement.style.setProperty(`--color-${activeZone}`, restoreHex);
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
    livePreviewRestoreHex = null; // après validation, plus de restauration au survol
    renderActiveColorPills();
    updateSidebarRecap();
    updateMoldingWarning();
}

function applyCurrentColors() {
    for (const [zone, color] of Object.entries(currentColors)) {
        document.documentElement.style.setProperty(`--color-${zone}`, color);
    }
}

// Preview-first : calepinage seul, pastilles, sélecteur de layout (uniquement les variantes du JSON, plus de ROOT)
function renderInterface() {
    loadCalepinageZoom();
    loadCalepinageJoints();
    const variants = getVariantsList();
    if (!variants.length) {
        const gridContainer = document.getElementById("grid-container");
        if (gridContainer) gridContainer.innerHTML = "<p style='padding:20px;color:red;'>Erreur: aucune variante chargée. Vérifiez les fichiers SVG (VAR1, VAR2, …) dans assets/svg/.</p>";
        return;
    }
    currentColors = {};
    variants.forEach((v) => extractDefaultColorsFromSvg(svgCache[v]));
    renderCalepinageOnly();
    buildCarouselMockupSlides();
    renderMockupSlides();
    renderActiveColorPills();
    renderLayoutSelector();
    updatePaletteHighlight();
    updateSidebarRecap();
    updateSidebarVisibility();
    updateMoldingWarning();
    setupCarousel();
    setupCalepinageZoomControls();
    // Après changement de collection, la slide peut ne pas être encore dimensionnée : on recalcule la disposition dès que le layout est prêt (zoom conservé, max hauteur).
    if (currentLayout !== "solo") {
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                const newRows = getGridRowsForContainer();
                if (newRows !== gridRows) {
                    gridRows = newRows;
                    renderCalepinageOnly();
                } else {
                    applyGridSizeFromContainer();
                }
            });
        });
    }
}

/** Change le zoom calepinage (2–20), sauvegarde et re-rend. */
function setCalepinageZoom(newZoom) {
    const v = Math.max(CALEPINAGE_ZOOM_MIN, Math.min(CALEPINAGE_ZOOM_MAX, newZoom));
    if (v === calepinageZoom) return;
    calepinageZoom = v;
    saveCalepinageZoom();
    renderCalepinageOnly();
    updateCalepinageZoomUI();
}

function updateCalepinageZoomUI() {
    const wrap = document.getElementById("calepinage-zoom-wrap");
    if (wrap) {
        const label = wrap.querySelector(".calepinage-zoom-label");
        if (label) label.textContent = `${calepinageZoom}×${calepinageZoom}`;
        const btnIn = wrap.querySelector(".calepinage-zoom-in");
        const btnOut = wrap.querySelector(".calepinage-zoom-out");
        if (btnIn) btnIn.disabled = calepinageZoom <= CALEPINAGE_ZOOM_MIN;
        if (btnOut) btnOut.disabled = calepinageZoom >= CALEPINAGE_ZOOM_MAX;
    }
    const slider = document.getElementById("options-zoom-slider");
    if (slider) {
        slider.value = String(calepinageZoom);
    }
}

/** Marge autour de la grille calepinage dans la slide (évite le crop, centrage symétrique). */
const CALEPINAGE_GRID_MARGIN = 40;

/**
 * Nombre de lignes qui tiennent dans la hauteur disponible (carreaux carrés, largeur = 100% dispo).
 * Utilisé au rendu et au resize pour afficher plus de lignes quand il y a plus de place.
 */
function getGridRowsForContainer() {
    const slide0 = document.querySelector(".carousel-slide[data-slide-index='0']");
    if (!slide0) return gridCols || CALEPINAGE_ZOOM_DEFAULT;
    const slideW = slide0.clientWidth || 0;
    const slideH = slide0.clientHeight || 0;
    const cols = gridCols || 1;
    if (slideW <= 0 || slideH <= 0) return cols;
    const margin = CALEPINAGE_GRID_MARGIN;
    const availableW = Math.max(0, slideW - 2 * margin);
    const availableH = Math.max(0, slideH - 2 * margin);
    if (availableW <= 0) return cols;
    const cellWidth = availableW / cols;
    const rows = Math.max(1, Math.floor(availableH / cellWidth));
    return rows;
}

/**
 * Dimensionne la grille en JS : largeur = 100% dispo, hauteur = autant de lignes que possible,
 * carreaux carrés et collés.
 */
function applyGridSizeFromContainer() {
    const slide0 = document.querySelector(".carousel-slide[data-slide-index='0']");
    const gridContainer = document.getElementById("grid-container");
    if (!slide0 || !gridContainer || currentLayout === "solo") return;
    if (!gridContainer.classList.contains("tapis")) return;
    const slideW = slide0.clientWidth || 0;
    const slideH = slide0.clientHeight || 0;
    const cols = gridCols || 1;
    const rows = gridRows || 1;
    if (slideW <= 0 || slideH <= 0) return;
    const margin = CALEPINAGE_GRID_MARGIN;
    const availableW = Math.max(0, slideW - 2 * margin);
    const availableH = Math.max(0, slideH - 2 * margin);
    const cellSizePx = Math.floor(availableW / cols);
    if (cellSizePx <= 0) return;
    const gridW = cols * cellSizePx;
    const gridH = rows * cellSizePx;
    gridContainer.style.width = gridW + "px";
    gridContainer.style.height = gridH + "px";
    gridContainer.style.gridTemplateColumns = `repeat(${cols}, ${cellSizePx}px)`;
    gridContainer.style.gridTemplateRows = `repeat(${rows}, ${cellSizePx}px)`;
    positionGridWatermark();
}

/** Place le watermark de la vue grille en haut à gauche des carreaux (aligné sur la grille). */
function positionGridWatermark() {
    const slide0 = document.querySelector(".carousel-slide[data-slide-index='0']");
    const gridContainer = document.getElementById("grid-container");
    const watermark = slide0 ? slide0.querySelector(".visuel-watermark-grid") : null;
    if (!slide0 || !gridContainer || !watermark) return;
    const slideRect = slide0.getBoundingClientRect();
    const gridRect = gridContainer.getBoundingClientRect();
    const inset = 8;
    watermark.style.left = (gridRect.left - slideRect.left + inset) + "px";
    watermark.style.top = (gridRect.top - slideRect.top + inset) + "px";
}

/** Boutons zoom + molette + pinch sur la vue calepinage. */
function setupCalepinageZoomControls() {
    loadCalepinageZoom();
    const slide0 = document.querySelector(".carousel-slide[data-slide-index='0']");
    const gridContainer = document.getElementById("grid-container");
    if (!slide0 || !gridContainer) return;

    let resizeTimer = 0;
    window.addEventListener("resize", () => {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => {
            if (document.getElementById("view-workspace").style.display !== "flex") return;
            if (currentLayout !== "solo") {
                const newRows = getGridRowsForContainer();
                if (newRows !== gridRows) {
                    renderCalepinageOnly();
                } else {
                    applyGridSizeFromContainer();
                }
            }
            updateMockupPerspectives();
        }, 150);
    });
    if (document.getElementById("view-workspace").style.display === "flex" && currentLayout !== "solo") {
        setTimeout(() => applyGridSizeFromContainer(), 300);
    }

    const zoomWrap = document.getElementById("calepinage-zoom-wrap");
    if (zoomWrap) {
        const btnIn = zoomWrap.querySelector(".calepinage-zoom-in");
        const btnOut = zoomWrap.querySelector(".calepinage-zoom-out");
        if (btnIn) btnIn.onclick = () => setCalepinageZoom(calepinageZoom - 1);
        if (btnOut) btnOut.onclick = () => setCalepinageZoom(calepinageZoom + 1);
    }

    const zoomTarget = gridContainer;
    let lastWheelZoomTime = 0;
    const WHEEL_ZOOM_THROTTLE_MS = 120;
    zoomTarget.addEventListener("wheel", (e) => {
        if (carouselIndex !== 0) return;
        const now = Date.now();
        if (now - lastWheelZoomTime < WHEEL_ZOOM_THROTTLE_MS) return;
        lastWheelZoomTime = now;
        e.preventDefault();
        if (e.deltaY < 0) setCalepinageZoom(calepinageZoom - 1);
        else if (e.deltaY > 0) setCalepinageZoom(calepinageZoom + 1);
    }, { passive: false });

    let pinchStartDist = 0;
    let pinchStartZoom = 0;
    let lastPinchDist = 0;
    zoomTarget.addEventListener("touchstart", (e) => {
        if (e.touches.length === 2) {
            pinchStartDist = Math.hypot(e.touches[1].clientX - e.touches[0].clientX, e.touches[1].clientY - e.touches[0].clientY);
            lastPinchDist = pinchStartDist;
            pinchStartZoom = calepinageZoom;
        }
    }, { passive: true });
    zoomTarget.addEventListener("touchmove", (e) => {
        if (e.touches.length === 2 && pinchStartDist > 0) {
            lastPinchDist = Math.hypot(e.touches[1].clientX - e.touches[0].clientX, e.touches[1].clientY - e.touches[0].clientY);
            e.preventDefault();
        }
    }, { passive: false });
    zoomTarget.addEventListener("touchend", (e) => {
        if (e.touches.length < 2 && pinchStartDist > 0) {
            const ratio = lastPinchDist / pinchStartDist;
            if (ratio > 1.2) setCalepinageZoom(pinchStartZoom - 1);
            else if (ratio < 0.8) setCalepinageZoom(pinchStartZoom + 1);
            pinchStartDist = 0;
        }
    }, { passive: true });

    updateCalepinageZoomUI();
}

// ——— Carrousel (swipe + boutons + indicateurs points) ———
function setupCarousel() {
    const track = document.getElementById("carousel-track");
    const prevBtn = document.getElementById("carousel-prev");
    const nextBtn = document.getElementById("carousel-next");
    const dotsContainer = document.getElementById("carousel-dots");
    const slides = document.querySelectorAll(".carousel-slide");
    if (!track || !slides.length) return;

    function goTo(index) {
        carouselIndex = Math.max(0, Math.min(index, slides.length - 1));
        track.style.transform = `translateX(-${carouselIndex * 100}%)`;
        slides.forEach((s, i) => s.classList.toggle("carousel-slide-active", i === carouselIndex));
        if (dotsContainer) {
            dotsContainer.querySelectorAll(".carousel-dot").forEach((d, i) => d.classList.toggle("active", i === carouselIndex));
        }
        updateOptionsDrawerZoomVisibility();
        updateShareButtonVisibility();
        if (carouselIndex === 0) requestAnimationFrame(() => positionGridWatermark());
    }

    if (dotsContainer) {
        dotsContainer.innerHTML = "";
        slides.forEach((_, i) => {
            const dot = document.createElement("button");
            dot.type = "button";
            dot.className = "carousel-dot" + (i === 0 ? " active" : "");
            dot.setAttribute("aria-label", "Vue " + (i + 1));
            dot.setAttribute("aria-selected", i === 0 ? "true" : "false");
            dot.addEventListener("click", () => goTo(i));
            dotsContainer.appendChild(dot);
        });
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

// ——— Mockups en situation (sandwich : tapis déformé + overlay) ———
/** Construit les slides mockup dans le carrousel : conserve la slide 0, supprime les autres, ajoute une slide par mockup. */
function buildCarouselMockupSlides() {
    const track = document.getElementById("carousel-track");
    if (!track) return;
    while (track.children.length > 1) track.removeChild(track.lastChild);
    mockupsData.forEach((mockup, i) => {
        const slide = document.createElement("div");
        slide.className = "carousel-slide";
        slide.setAttribute("data-slide-index", String(i + 1));
        slide.innerHTML = `
            <div class="mockup-scene carousel-slide-mockup-content" style="aspect-ratio: ${mockup.sceneWidth}/${mockup.sceneHeight};">
                <img class="visuel-watermark" src="${REPO_URL}/assets/logo-cesar-bazaar-alpha.png" alt="" aria-hidden="true" />
                <div class="mockup-tapis" data-mockup-index="${i}"></div>
                <img class="mockup-overlay" src="${REPO_URL}/${mockup.overlayPath}" alt="${mockup.name}" />
            </div>`;
        track.appendChild(slide);
    });
}

/** Remplit chaque .mockup-tapis avec la grille (même calepinage que la vue plate) et applique la perspective. */
function renderMockupSlides() {
    const variants = getVariantsList();
    if (!variants.length) return;
    const calepinage = calepinagesData.find((c) => c.id === currentLayout);
    preparedTileCache = {};
    document.querySelectorAll(".mockup-tapis").forEach((tapisEl) => {
        const idx = parseInt(tapisEl.getAttribute("data-mockup-index"), 10);
        const mockup = mockupsData[idx];
        if (!mockup) return;
        const cols = mockup.gridCols || 8;
        // Plus de gridRows dans le mockup : on génère assez de lignes pour couvrir la hauteur (ratio scene)
        const maxRows = Math.ceil(((mockup.sceneHeight || 1080) / (mockup.sceneWidth || 720)) * cols) + 2;
        const rows = maxRows;
        tapisEl.className = "mockup-tapis grid-view tapis" + (showJoints ? " show-joints" : "");
        tapisEl.style.display = "grid";
        tapisEl.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
        tapisEl.style.gridTemplateRows = `repeat(${rows}, 1fr)`;
        const parts = [];
        if (calepinage) {
            for (let row = 0; row < rows; row++) {
                for (let col = 0; col < cols; col++) {
                    const { variantName, rotation } = getCellSpec(calepinage, row, col, variants);
                    parts.push(getPreparedTileHTML(variantName, rotation, row, col));
                }
            }
        } else {
            for (let row = 0; row < rows; row++) {
                for (let col = 0; col < cols; col++) {
                    const variant = variants[(row * cols + col) % variants.length];
                    const angles = [0, 90, 180, 270];
                    const rot = angles[Math.floor(Math.random() * angles.length)];
                    parts.push(getPreparedTileHTML(variant, rot, row, col));
                }
            }
        }
        tapisEl.innerHTML = parts.join("");
        tapisEl.querySelectorAll("g[id^='tapis-']").forEach((g) => {
            if (g.id.includes("zone-")) g.style.cursor = "pointer";
        });
        applyPerspectiveToMockupTapis(tapisEl, mockup);
    });
    applyCurrentColors();
    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            document.querySelectorAll(".mockup-tapis").forEach((tapisEl) => {
                const idx = parseInt(tapisEl.getAttribute("data-mockup-index"), 10);
                const mockup = mockupsData[idx];
                if (mockup) applyPerspectiveToMockupTapis(tapisEl, mockup);
            });
        });
    });
}

/** Retourne les dimensions d'une slide du carrousel (toutes les slides ont la même taille que le track). */
function getCarouselSlideSize() {
    const track = document.getElementById("carousel-track");
    if (!track) return { w: 0, h: 0 };
    const container = track.closest(".carousel-track-container") || track.parentElement;
    const w = container ? container.offsetWidth : track.offsetWidth;
    const h = container ? container.offsetHeight : track.offsetHeight;
    return { w: w || 0, h: h || 0 };
}

function isIdentityQuad(corners01) {
    if (!corners01 || corners01.length !== 4) return false;
    const [[a0, a1], [b0, b1], [c0, c1], [d0, d1]] = corners01;
    return Math.abs(a0) < 0.01 && Math.abs(a1) < 0.01 &&
           Math.abs(b0 - 1) < 0.01 && Math.abs(b1) < 0.01 &&
           Math.abs(c0 - 1) < 0.01 && Math.abs(c1 - 1) < 0.01 &&
           Math.abs(d0) < 0.01 && Math.abs(d1 - 1) < 0.01;
}

function applyPerspectiveToMockupTapis(tapisEl, mockup) {
    const scene = tapisEl.closest(".mockup-scene");
    // Réinitialiser la perspective CSS sur la scène (au cas où on bascule matrix → simple ou inverse)
    if (scene) {
        delete scene.dataset.perspectiveMode;
        scene.style.perspective = "";
        scene.style.perspectiveOrigin = "";
        scene.style.transformStyle = "";
    }
    tapisEl.style.transformStyle = "";
    let sceneW = scene ? scene.offsetWidth : 0;
    let sceneH = scene ? scene.offsetHeight : 0;
    const sceneRaw = { w: scene ? scene.offsetWidth : null, h: scene ? scene.offsetHeight : null };
    if (sceneW <= 0 || sceneH <= 0) {
        const slideSize = getCarouselSlideSize();
        sceneW = sceneW <= 0 ? (slideSize.w || mockup.sceneWidth || 800) : sceneW;
        sceneH = sceneH <= 0 ? (slideSize.h || mockup.sceneHeight || 600) : sceneH;
    }
    const corners = mockup.corners;
    const perspectiveDisabled = mockup.perspective === false;
    const perspectiveMode = mockup.perspectiveMode || "matrix";
    const hasMatrix3d = Array.isArray(mockup.matrix3d) && mockup.matrix3d.length === 16 && mockup.matrix3d.every(Number.isFinite);
    const corners01 = corners && corners.length === 4 ? corners.map(([x, y]) => [x / 100, y / 100]) : [];
    const identityQuad = isIdentityQuad(corners01);
    const hasCorners = corners && corners.length === 4 && !identityQuad;
    const useSimplePerspective = perspectiveMode === "simple" && !perspectiveDisabled;
    const noPerspective = perspectiveDisabled || (!useSimplePerspective && !hasMatrix3d && !hasCorners);

    tapisEl.style.transformOrigin = "0 0";
    tapisEl.dataset.mockupSceneW = String(sceneW);
    tapisEl.dataset.mockupSceneH = String(sceneH);

    if (noPerspective) {
        tapisEl.dataset.noPerspective = "true";
        const gridCols = Math.max(1, mockup.gridCols || 8);
        // Grille en pixels entiers pour éviter les espaces subpixel entre carreaux (surtout avec rotation).
        const s = Math.max(1, Math.floor(sceneW / gridCols));
        const cols = gridCols;
        const rows = Math.max(1, Math.floor(sceneH / s));
        const w = cols * s;
        const h = rows * s;
        tapisEl.style.transform = "none";
        tapisEl.style.left = "0";
        tapisEl.style.top = "0";
        tapisEl.style.width = w + "px";
        tapisEl.style.height = h + "px";
        tapisEl.style.gridTemplateColumns = `repeat(${cols}, ${s}px)`;
        tapisEl.style.gridTemplateRows = `repeat(${rows}, ${s}px)`;
        tapisEl.style.display = "grid";
        const inner = tapisEl.querySelector(".mockup-tapis-inner");
        if (inner) {
            while (inner.firstChild) tapisEl.appendChild(inner.firstChild);
            inner.remove();
        }
        const children = Array.from(tapisEl.children);
        children.forEach((child, i) => {
            child.style.display = i < cols * rows ? "" : "none";
        });
        return;
    }

    tapisEl.removeAttribute("data-no-perspective");
    tapisEl.querySelectorAll(".tile-wrapper").forEach((el) => { el.style.display = ""; });

    // Mode simple : perspective CSS + rotateX/rotateY + scaleX (sans matrix3d, moins de bugs visuels)
    // Grille en pixels entiers pour éviter chevauchements et variations au resize (1fr → tailles fractionnaires).
    if (useSimplePerspective) {
        const rotateX = mockup.rotateX ?? 25;
        const rotateY = mockup.rotateY ?? 0;
        const widthScale = mockup.widthScale ?? 1;
        const perspectivePx = mockup.perspectivePx ?? 1200;
        const gridCols = Math.max(1, mockup.gridCols || 8);
        const s = Math.max(1, Math.floor(sceneW / gridCols));
        const cols = gridCols;
        const rows = Math.max(1, Math.floor(sceneH / s));
        const w = cols * s;
        const h = rows * s;
        if (scene) {
            scene.dataset.perspectiveMode = "simple";
            scene.style.perspective = String(perspectivePx) + "px";
            scene.style.perspectiveOrigin = "center center";
            scene.style.transformStyle = "preserve-3d";
        }
        tapisEl.style.transformOrigin = "center bottom";
        tapisEl.style.transformStyle = "preserve-3d";
        tapisEl.style.transform = "rotateX(" + rotateX + "deg) rotateY(" + rotateY + "deg) scaleX(" + widthScale + ")";
        tapisEl.style.width = w + "px";
        tapisEl.style.height = h + "px";
        tapisEl.style.left = "0";
        tapisEl.style.top = "0";
        tapisEl.style.right = "auto";
        tapisEl.style.bottom = "auto";
        tapisEl.style.gridTemplateColumns = "repeat(" + cols + ", " + s + "px)";
        tapisEl.style.gridTemplateRows = "repeat(" + rows + ", " + s + "px)";
        tapisEl.style.display = "grid";
        const inner = tapisEl.querySelector(".mockup-tapis-inner");
        if (inner) {
            while (inner.firstChild) tapisEl.appendChild(inner.firstChild);
            inner.remove();
        }
        tapisEl.querySelectorAll(".tile-wrapper").forEach((el, i) => {
            el.style.display = i < cols * rows ? "" : "none";
        });
        return;
    }

    const refW = mockup.sceneWidth || 720;
    const refH = mockup.sceneHeight || 1080;
    const scaleToRef = (sceneW > 0 && sceneH > 0 && (sceneW !== refW || sceneH !== refH));
    const sx = scaleToRef ? refW / sceneW : 1;
    const sy = scaleToRef ? refH / sceneH : 1;

    let matrix = "none";
    const raw = mockup.matrix3d;
    if (Array.isArray(raw) && raw.length === 16 && raw.every(Number.isFinite)) {
        if (scaleToRef) {
            const m = raw;
            const scaled = [
                m[0] * sx, m[1] * sx, m[2] * sx, m[3] * sx,
                m[4] * sy, m[5] * sy, m[6] * sy, m[7] * sy,
                m[8], m[9], m[10], m[11],
                m[12], m[13], m[14], m[15]
            ];
            matrix = "matrix3d(" + scaled.join(",") + ")";
        } else {
            matrix = "matrix3d(" + raw.join(",") + ")";
        }
    } else if (corners01.length === 4) {
        const cornersPx = corners01.map(([x, y]) => [x * sceneW, y * sceneH]);
        matrix = perspectiveMatrix3dFromPixelQuad(sceneW, sceneH, cornersPx);
    }
    if (matrix === "none") {
        tapisEl.style.transform = "none";
        return;
    }

    tapisEl.style.width = "";
    tapisEl.style.height = "";
    tapisEl.style.display = "grid";
    const inner = tapisEl.querySelector(".mockup-tapis-inner");
    if (inner) {
        while (inner.firstChild) tapisEl.appendChild(inner.firstChild);
        inner.remove();
    }
    tapisEl.style.transform = matrix;
}

/** Recalcule et réapplique la transformation perspective sur chaque mockup (à appeler au resize). */
function updateMockupPerspectives() {
    document.querySelectorAll(".mockup-tapis").forEach((tapisEl) => {
        const idx = parseInt(tapisEl.getAttribute("data-mockup-index"), 10);
        const mockup = mockupsData[idx];
        if (mockup) applyPerspectiveToMockupTapis(tapisEl, mockup);
    });
}

/**
 * À appeler après avoir rendu le workspace visible (ex. après chargement dynamique).
 * Le layout est calculé alors que le workspace était masqué, donc dimensions à 0.
 * On recalcule grille calepinage et perspectives mockup une fois la vue affichée.
 */
function refreshWorkspaceLayoutAfterVisible() {
    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            if (document.getElementById("view-workspace").style.display !== "flex") return;
            if (currentLayout !== "solo") {
                const newRows = getGridRowsForContainer();
                if (newRows !== gridRows) {
                    gridRows = newRows;
                    renderCalepinageOnly();
                } else {
                    applyGridSizeFromContainer();
                }
            }
            updateMockupPerspectives();
            // Un second délai au cas où le navigateur n’a pas encore fini le layout (carreaux carrés, mockups).
            setTimeout(() => {
                if (document.getElementById("view-workspace").style.display !== "flex") return;
                if (currentLayout !== "solo") applyGridSizeFromContainer();
                updateMockupPerspectives();
            }, 100);
        });
    });
}