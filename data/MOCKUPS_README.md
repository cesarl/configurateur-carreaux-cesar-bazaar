# Mockups en situation — Configuration `mockups.json`

Ce fichier décrit comment configurer les mockups (vues en situation : cuisine, salle de bain, etc.) et comment fonctionne la déformation en perspective.

---

## Rôle de `mockups.json`

Le configurateur charge `data/mockups.json` au démarrage. Chaque entrée définit une vue "mockup" affichée dans le carrousel après la vue à plat. Pour chaque mockup, on affiche :

1. **En arrière-plan** : la grille de carreaux (calepinage) déformée pour épouser la perspective du sol ou du mur.
2. **Par-dessus** : une image PNG (overlay) de la pièce, avec la zone du sol/mur **transparente** et les ombres en noir semi-transparent.

Les carreaux sont donc visibles dans la zone transparente de l’image.

---

## Structure d’un mockup

| Champ          | Type    | Obligatoire | Description |
|----------------|---------|-------------|-------------|
| `id`           | string  | oui         | Identifiant unique (ex. `sol-1`, `cuisine-1`). |
| `name`         | string  | oui         | Nom affiché (ex. "Sol cuisine", "Full mur"). |
| `overlayPath`  | string  | oui         | Chemin vers l’image PNG overlay (ex. `assets/mockups/Sol-1.png`). |
| `sceneWidth`   | number  | oui         | Largeur de référence de la scène (px), pour le ratio d’affichage. |
| `sceneHeight`  | number  | oui         | Hauteur de référence (px). |
| `gridCols`     | number  | oui         | Nombre de carreaux en largeur dans la grille. |
| `gridRows`     | number  | oui         | Nombre de carreaux en hauteur. |
| `corners`      | array   | recommandé  | 4 points `[x, y]` en **pourcentage (0–100)** définissant la zone du sol/mur (voir ci‑dessous). |
| `perspective`  | boolean | non         | Si `false`, la grille s’affiche sans déformation (pleine zone). Utile pour déboguer. |

---

## Les 4 coins (`corners`) et la perspective

### Ordre des coins

`corners` est un tableau de **4 points** dans cet ordre :

1. **Haut-gauche** (top-left)  
2. **Haut-droite** (top-right)  
3. **Bas-droite** (bottom-right)  
4. **Bas-gauche** (bottom-left)

Chaque point est `[x, y]` en **pourcentage** (0 à 100) par rapport à la largeur et à la hauteur de l’image de la scène.

- `[0, 0]` = coin haut-gauche de l’image  
- `[100, 100]` = coin bas-droite  
- `[50, 50]` = centre  

Exemple pour un sol en perspective (trapèze) :

- Le bord "du haut" (vers le fond de la pièce) est plus petit que le bord "du bas" (proche de la caméra).
- En % cela peut donner : haut-gauche `[10, 15]`, haut-droite `[90, 12]`, bas-droite `[92, 88]`, bas-gauche `[8, 90]`.

### Comment mesurer les coins sur ton image

1. Ouvre l’image PNG (overlay) dans un logiciel (Photoshop, GIMP, etc.).
2. Repère la zone **transparente** qui correspond au sol (ou au mur) où les carreaux doivent apparaître.
3. Pour chaque coin de cette zone (dans l’ordre haut-gauche, haut-droite, bas-droite, bas-gauche), note la position en % :
   - **x** = (position horizontale en px / largeur totale de l’image) × 100  
   - **y** = (position verticale en px / hauteur totale de l’image) × 100  

Exemple : image 1200×800 px, coin haut-gauche du sol à (120, 100) px → `[10, 12.5]`.

### Si les carreaux ne s’affichent pas ou sont mal placés

- Vérifie que l’overlay PNG a bien la zone sol/mur **transparente** (détourage). Si toute l’image est opaque, les carreaux restent cachés.
- Mets temporairement `"perspective": false` dans le mockup : la grille s’affiche alors en plein format (sans déformation). Si tu vois les carreaux, le souci vient des `corners` ou de leur ordre.
- Vérifie l’ordre des 4 coins (haut-gauche, haut-droite, bas-droite, bas-gauche). Un mauvais ordre déforme la grille de façon incohérente.
- Pour un rectangle plein (pas de perspective), tu peux utiliser :  
  `"corners": [[0, 0], [100, 0], [100, 100], [0, 100]]`

---

## Comment fonctionne la matrice de perspective

### Principe

La grille 2D (carreaux) est déformée pour se caler exactement sur le quadrilatère défini par les 4 coins. On utilise une **homographie** (transformation projective 2D) :

- En entrée : un rectangle (la grille), dont les 4 coins sont mappés sur les 4 points de `corners`.
- En sortie : une transformation CSS `matrix3d(...)` qui applique cette déformation.

### Formule mathématique (pour info)

On cherche une transformation qui envoie le carré unité (0,0)–(1,1) sur le quad défini par les 4 coins en coordonnées normalisées (0–1). La transformation est de la forme :

- `x' = (a·u + b·v + c) / (g·u + h·v + 1)`  
- `y' = (d·u + e·v + f) / (g·u + h·v + 1)`  

où `(u, v)` est un point du carré source et `(x', y')` le point dans le quad. Les 8 coefficients (a, b, c, d, e, f, g, h) sont calculés en résolvant un système linéaire 8×8 à partir des 4 correspondances de coins. Le script construit ensuite la `matrix3d` CSS (format colonne par colonne) à partir de ces coefficients.

### Chaîne de transforms appliquée

En CSS, le conteneur de la grille (`.mockup-tapis`) reçoit :

1. `scale(1/W, 1/H)` : passage du rectangle de la scène (W×H px) au carré unité (0,0)–(1,1).  
2. `matrix3d(...)` : homographie qui envoie ce carré sur le quad défini par `corners` (en 0–1).  
3. `scale(W, H)` : retour en pixels pour que le quad soit à l’échelle de la scène.

Ainsi, la grille remplit exactement la zone du sol/mur définie par les 4 coins.

---

## Exemple complet

```json
{
  "id": "sol-1",
  "name": "Sol cuisine",
  "overlayPath": "assets/mockups/Sol-1.png",
  "sceneWidth": 1200,
  "sceneHeight": 800,
  "gridCols": 12,
  "gridRows": 8,
  "corners": [[10, 15], [90, 12], [92, 88], [8, 90]]
}
```

- Image overlay : `assets/mockups/Sol-1.png` (sol transparent, ombres en noir semi-transparent).
- Grille : 12×8 carreaux.
- Les 4 coins décrivent un trapèze (sol en perspective) en % de l’image.

Sans déformation (débogage) :

```json
{
  "id": "sol-1",
  "name": "Sol cuisine",
  "overlayPath": "assets/mockups/Sol-1.png",
  "sceneWidth": 1200,
  "sceneHeight": 800,
  "gridCols": 12,
  "gridRows": 8,
  "perspective": false
}
```

---

## Fichiers à préparer (côté design)

- **PNG overlay** : même ratio que `sceneWidth` / `sceneHeight` de préférence.  
- Zone sol/mur : **entièrement transparente** (canal alpha à 0).  
- Ombres des meubles sur le sol : **noir semi-transparent**. Le CSS applique `mix-blend-mode: multiply` pour assombrir naturellement les carreaux sous les ombres.
