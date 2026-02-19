# Calepinages — Documentation du format JSON

Ce fichier décrit la structure de `calepinages.json` utilisée par le moteur de calepinage du configurateur. Vous pouvez ajouter de nouveaux calepinages en respectant ce schéma.

---

## Structure d’un calepinage

Chaque entrée du tableau est un objet avec les propriétés suivantes :

| Propriété   | Type     | Description |
|------------|----------|-------------|
| `id`       | string   | Identifiant unique (ex. `damier_2_motifs`). Utilisé en interne et pour l’URL. |
| `nom`      | string   | Libellé affiché dans le sélecteur de disposition (ex. « Damier Alterné »). |
| `block_size` | [number, number] | Taille du bloc qui se répète : `[colonnes, lignes]`. |
| `matrix`   | array    | Liste des cellules du bloc (voir ci-dessous). |

---

## Structure d’une cellule (`matrix`)

Chaque élément de `matrix` décrit une cellule du bloc avec :

| Propriété | Type | Description |
|-----------|------|-------------|
| `x`       | number | Index de colonne dans le bloc (0 à `block_size[0] - 1`). |
| `y`       | number | Index de ligne dans le bloc (0 à `block_size[1] - 1`). |
| `tile`    | number \| string \| number[] | Quelle variation de carreau utiliser (voir ci-dessous). |
| `rot`     | number \| string | Rotation en degrés : `0`, `90`, `180`, `270`, ou `"random"`. |

### Valeurs possibles pour `tile`

- **Nombre** (ex. `1`, `2`) : variation fixe. `1` = VAR1, `2` = VAR2, etc. Si la collection a moins de variations, on utilise la première (VAR1) en secours.
- **`"any"`** : choix aléatoire parmi toutes les variations de la collection.
- **Tableau** (ex. `[1, 2]`) : choix aléatoire parmi les variations dont l’index est dans le tableau (1 = VAR1, 2 = VAR2, etc.).

### Valeurs possibles pour `rot`

- **`0`, `90`, `180`, `270`** : rotation fixe en degrés.
- **`"random"`** : rotation aléatoire parmi 0°, 90°, 180°, 270°.

---

## Règles à respecter

1. **Couverture du bloc** : La `matrix` doit contenir exactement `block_size[0] × block_size[1]` cellules.
2. **Coordonnées** : Chaque `(x, y)` doit être unique et dans les bornes :  
   `0 ≤ x < block_size[0]` et `0 ≤ y < block_size[1]`.
3. **Ordre** : L’ordre des cellules dans `matrix` n’a pas d’effet sur le rendu ; le moteur identifie la cellule par `(x, y)`.

---

## Exemple minimal (bloc 1×1, pose aléatoire)

```json
{
  "id": "aleatoire_total",
  "nom": "Pose Aléatoire",
  "block_size": [1, 1],
  "matrix": [
    { "x": 0, "y": 0, "tile": "any", "rot": "random" }
  ]
}
```

## Exemple damier 2×2

```json
{
  "id": "damier_2_motifs",
  "nom": "Damier Alterné",
  "block_size": [2, 2],
  "matrix": [
    { "x": 0, "y": 0, "tile": 1, "rot": 0 },
    { "x": 1, "y": 0, "tile": 2, "rot": 0 },
    { "x": 0, "y": 1, "tile": 2, "rot": 0 },
    { "x": 1, "y": 1, "tile": 1, "rot": 0 }
  ]
}
```

---

## Liaison avec les collections

Dans `collections.json`, chaque collection peut définir :

- **`layouts`** : liste d’identifiants de calepinages (ex. `["aleatoire", "damier_2_motifs", "fresque_bordure"]`). Seuls ces calepinages sont proposés pour cette collection. Si absent, tous les calepinages du fichier sont proposés (ou ceux définis par défaut dans l’app).
- **`defaut_layout`** : id du calepinage sélectionné par défaut (doit être présent dans `layouts`).

L’identifiant `damier` est fourni dans `calepinages.json` pour compatibilité avec les collections qui l’utilisent encore.
