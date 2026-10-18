# Dashgrid

[English documentation](../README.md)

Dashboard de supervision inspiré visuellement de [Monitoror](https://demo.monitoror.com/) : grille plein écran, palette pastel, grands libellés et thème sombre à bordures colorées. Interface et documentation en français.

![Tableau de bord de démonstration](dashboard.png)

## Démarrage Docker

Prérequis : Docker et le plugin Docker Compose.

```bash
docker compose up -d --build
```

- Interface : **http://localhost:8080**
- Documentation interactive : **http://localhost:8080/api/docs**
- OpenAPI JSON : **http://localhost:8080/api/docs/json**
- Santé : **http://localhost:8080/api/health**

Le conteneur sert le frontend, l’API, le flux SSE et le collecteur HTTP. Il fonctionne avec un utilisateur non-root, un système de fichiers en lecture seule et un volume SQLite inscriptible. Healthcheck et rotation des logs inclus.

### Configuration

Créer un fichier `.env` en prenant `.env.example` pour modèle :

```dotenv
DASHGRID_BIND=127.0.0.1
DASHGRID_PORT=8080
DASHGRID_API_KEY=
```

`DASHGRID_BIND` est l’adresse de l’interface réseau de l’hôte. Pour accéder au dashboard depuis un autre ordinateur, utiliser l’IP LAN ou Tailscale du serveur. `0.0.0.0` publie sur toutes les interfaces.

`DASHGRID_API_KEY`, lorsqu’elle est renseignée, protège toutes les modifications par `Authorization: Bearer …`. L’affichage reste accessible en lecture seule. Le bouton **Modifier** demande la clé ; celle-ci reste dans le stockage de session de l’onglet. Une clé peut aussi être remplacée dans les paramètres. Sans clé configurée, les modifications sont libres sur le réseau choisi.

Après une modification du `.env` :

```bash
docker compose up -d
```

### Données persistantes et mise à jour

Configuration, positions, sources, règles, dernière valeur et état calculé sont enregistrés dans le volume `dashgrid_data`, à `/data/dashgrid.sqlite` dans le conteneur. SQLite utilise WAL. La continuité des temporisations est réinitialisée au redémarrage : une période sans mesures ne confirme pas une alerte.

```bash
docker compose up -d --build
docker compose ps
docker compose logs --tail=100 dashgrid
```

`docker compose down` conserve le volume. L’option `--volumes` le supprime avec ses données.

Pour une sauvegarde cohérente, arrêter le service, copier **le répertoire `/data` entier**, puis le redémarrer :

```bash
docker compose stop dashgrid
docker compose cp dashgrid:/data ./dashgrid-backup
docker compose start dashgrid
```

## Interface

Le premier démarrage crée 12 tuiles **de démonstration**. Leurs données sont synthétiques et leur fraîcheur est renouvelée toutes les 10 secondes. Le badge **DÉMO** les distingue des vraies mesures. Enregistrer une tuile dans l’éditeur ou lui envoyer une donnée par API désactive sa démonstration.

Pour restaurer les tuiles de démonstration supprimées :

```bash
docker compose stop dashgrid
docker compose run --rm --no-deps dashgrid npm run demo:restore
docker compose up -d --wait
```

La commande crée une sauvegarde SQLite dans `/data/backups`, ajoute les tuiles manquantes dans les emplacements libres et agrandit la grille si nécessaire. Les tuiles existantes sont conservées. Relancer la commande n’ajoute aucun doublon. En développement, après compilation et arrêt du serveur : `npm run demo:restore`.

- **Modifier** : ouvre le mode édition.
- **ID de la tuile** : affiché discrètement en haut à droite de chaque tuile, y compris hors du mode édition. Un clic copie l’identifiant pour l’utiliser dans l’API. Le bouton s’accentue et son icône de copie apparaît au survol ou au focus. L’ID complet est aussi accessible au survol si le libellé est tronqué.
- **Poignée de déplacement** : déplace une tuile ; déposer sur une tuile de mêmes dimensions échange leurs emplacements. Un chevauchement incompatible est refusé.
- **Coin inférieur droit** : redimensionne une tuile.
- **Crayon d’une tuile** : modifie son contenu, sa position, sa source, sa couleur et ses seuils.
- **Identifiant dans l’éditeur** : reste visible et copiable au-dessus des onglets Contenu, Source et Couleurs & seuils. L’identifiant peut être choisi lors de la création d’une tuile.
- **Dupliquer** : copie la configuration, y compris les en-têtes secrets côté serveur.
- **Ajouter une tuile** : ouvre l’éditeur ; si nécessaire, une ligne est ajoutée à la grille, jusqu’à 24 lignes. Annuler laisse cette ligne disponible.
- **Paramètres** : titre, nombre de lignes/colonnes et thème.
- **Plein écran** : masque l’interface pour l’affichage de supervision ; `Échap` permet de sortir.

Les modifications sont partagées entre les écrans par SSE. L’éditeur détecte les conflits de configuration grâce à une révision. Sur mobile, les tuiles sont présentées par ligne et colonne sans modifier le placement du grand écran ; le formulaire d’emplacement reste disponible.

Types : `metric`, `text`, `status`, `progress`. Le contenu est du texte, jamais du HTML exécuté. Pour `progress`, `content.min` et `content.max` définissent l’échelle.

## API

Préfixe : `/api/v1`. Les exemples ci-dessous supposent l’absence de clé ; ajouter `-H 'Authorization: Bearer VOTRE_CLE'` si elle est configurée.

| Méthode | Chemin                 | Fonction                                        |
| ------- | ---------------------- | ----------------------------------------------- |
| GET     | `/dashboard`           | Configuration, tuiles, état calculé et révision |
| PATCH   | `/dashboard`           | Modifier titre, dimensions, thème               |
| POST    | `/tiles`               | Créer une tuile                                 |
| GET     | `/tiles/:id`           | Lire une tuile                                  |
| PATCH   | `/tiles/:id`           | Modifier partiellement sa configuration         |
| DELETE  | `/tiles/:id`           | Supprimer une tuile                             |
| POST    | `/tiles/:id/duplicate` | Dupliquer avec un nouvel `id` et `layout`       |
| PUT     | `/layout`              | Modifier plusieurs positions atomiquement       |
| POST    | `/tiles/:id/data`      | Remplacer les données d’une tuile push          |
| POST    | `/tiles/:id/preview`   | Évaluer une mesure sans enregistrer             |
| GET     | `/events`              | Flux SSE : snapshot initial et changements      |

Les PATCH fusionnent les objets de configuration ; les tableaux `rules` et l’objet `source.headers` sont remplacés intégralement lorsqu’ils sont fournis. Un changement de type de source réinitialise cette source. Les identifiants de tuiles sont immuables. Les en-têtes de collecte sont masqués dans **toutes** les réponses ; les omettre d’un PATCH les conserve, fournir `{}` les efface.

### Envoyer une donnée

```bash
curl -X POST http://localhost:8080/api/v1/tiles/cpu/data \
  -H 'Content-Type: application/json' \
  -d '{"value":83,"status":"up","message":"Charge élevée"}'
```

La réponse contient `state`, `color`, `reason`, `receivedAt` et les données. `value` peut être un nombre, une chaîne ou un booléen ; `status` et `message` sont des chaînes facultatives. **Un envoi remplace la mesure précédente** : envoyer ensemble les champs nécessaires aux règles et à l’affichage. Le serveur fixe la date de réception.

### Fixer une couleur et un titre

```bash
curl -X PATCH http://localhost:8080/api/v1/tiles/cpu \
  -H 'Content-Type: application/json' \
  -d '{"content":{"title":"CPU production"},"appearance":{"mode":"fixed","fixedColor":"#57c0ff"}}'
```

### Positionnement

`x` et `y` commencent à **0 dans l’API**. `w` et `h` sont des nombres de cellules. La grille est bornée par `columns` et `rows`, avec un maximum de 24 × 24 cellules. Les chevauchements sont refusés avec HTTP 409.

Exemple d’échange de deux tuiles de démonstration, en une transaction :

```bash
curl -X PUT http://localhost:8080/api/v1/layout \
  -H 'Content-Type: application/json' \
  -d '{"tiles":[{"id":"cpu","x":4,"y":0,"w":2,"h":1},{"id":"memory","x":2,"y":0,"w":2,"h":1}]}'
```

`GET /dashboard` renvoie une `revision` et un ETag. Fournir `If-Match: "REVISION"` sur une modification permet de refuser les écritures basées sur une ancienne configuration. Les mesures seules ne font pas avancer cette révision ; le premier envoi à une tuile de démonstration la fait avancer puisqu’il désactive aussi sa démonstration.

### Créer une tuile avec collecte HTTP

Sur la grille initiale, ajouter d’abord une cinquième ligne :

```bash
curl -X PATCH http://localhost:8080/api/v1/dashboard \
  -H 'Content-Type: application/json' -d '{"rows":5}'

curl -X POST http://localhost:8080/api/v1/tiles \
  -H 'Content-Type: application/json' \
  -d '{
    "id":"service-http",
    "layout":{"x":0,"y":4,"w":2,"h":1},
    "content":{"type":"metric","title":"CPU distant","unit":"%"},
    "source":{
      "type":"http",
      "url":"http://host.docker.internal:9000/metrics",
      "intervalSeconds":30,
      "timeoutSeconds":10,
      "valuePath":"metrics.cpu",
      "messagePath":"message",
      "headers":{}
    }
  }'
```

La collecte attend du JSON. Les chemins acceptent `metrics.cpu` ou `servers[0].cpu`. Un chemin de valeur vide sélectionne la racine JSON. `statusPath` peut extraire une chaîne pour des règles sur le champ `status`. Huit collectes au maximum s’exécutent simultanément, avec une limite de 1 Mo par réponse ; les redirections ne sont pas suivies.

Depuis Docker, `localhost` désigne le conteneur. `host.docker.internal` désigne l’hôte ; pour un service lié à une IP LAN/Tailscale précise, utiliser cette IP. Pour joindre un autre conteneur par son nom, les deux doivent partager un réseau Docker.

## Seuils

Deux modes :

- `fixed` : couleur fixe, même si les données expirent ; l’état et l’âge continuent d’indiquer la fraîcheur.
- `thresholds` : couleur correspondant à l’état calculé.

Exemple complet pour CPU :

```json
{
  "appearance": {
    "mode": "thresholds",
    "colors": {
      "ok": "#88d8b0",
      "warning": "#ffcc5c",
      "critical": "#ff6f69",
      "unknown": "#9ca3ab",
      "info": "#57c0ff"
    }
  },
  "thresholds": {
    "field": "value",
    "defaultState": "ok",
    "staleAfterSeconds": 120,
    "rules": [
      {
        "id": "critique",
        "state": "critical",
        "enter": { "operator": "gte", "value": 80 },
        "exit": { "operator": "lt", "value": 75 },
        "holdSeconds": 30
      },
      {
        "id": "attention",
        "state": "warning",
        "enter": { "operator": "gte", "value": 60 },
        "exit": { "operator": "lt", "value": 55 },
        "holdSeconds": 30
      }
    ]
  }
}
```

Ce document peut être envoyé à `PATCH /api/v1/tiles/cpu`.

### Règles de décision

1. **Priorité** : `critical` > `warning` > `info`. En cas d’égalité, la première règle configurée gagne. Sans règle active, `defaultState` s’applique (`ok` ou `info`).
2. **Hystérésis** : une règle active reste active tant que sa condition `exit` n’est pas confirmée. Sans `exit`, elle se désactive dès que `enter` devient faux. Une règle plus grave peut toujours prendre le relais.
3. **Confirmation** : `holdSeconds` s’applique à l’entrée et à la sortie. La condition doit être observée vraie sur des mesures fraîches espacées d’au moins cette durée. Une mesure contraire remet son compteur à zéro ; le silence ne fait pas avancer l’état. `0` signifie immédiat.
4. **Péremption** : après `staleAfterSeconds`, l’état devient `unknown`, l’ancienne valeur reste visible et les confirmations sont réinitialisées. Au retour d’une mesure, elles repartent de zéro.
5. **Erreur HTTP ou champ de seuil absent/incompatible** : état `unknown`, avec une raison explicite. Une erreur ne remet pas à zéro la date de la dernière mesure valide.
6. **Redémarrage / changement des règles** : les confirmations repartent de zéro. Un changement de source réinitialise les données de la tuile.

Opérateurs : `gt`, `gte`, `lt`, `lte`, `eq`, `neq`, `between`. Les comparaisons numériques n’effectuent aucune conversion implicite ; `between` est inclusif et demande `max`. L’égalité est stricte, utilisable sur nombres, chaînes et booléens. Un identifiant unique est requis pour chaque règle.

### Prévisualisation

```bash
curl -X POST http://localhost:8080/api/v1/tiles/cpu/preview \
  -H 'Content-Type: application/json' -d '{"data":{"value":90}}'
```

L’aperçu part d’un état vide et ne sauvegarde rien. Avec une confirmation de 30 secondes, une seule mesure indique que la confirmation est en cours. Le champ facultatif `tile` permet de tester une configuration complète non encore enregistrée.

## Développement et vérification

Node.js **22.16+** requis (`node:sqlite`, y compris la sauvegarde des données).

```bash
npm ci
npm run dev
```

Frontend : port 5173, avec proxy vers l’API sur 8080.

```bash
npm run check
npm test
npm run build
npx playwright install chromium
npm run test:e2e
```

Les tests API couvrent la persistance, les transactions de placement, les révisions, l’authentification, la protection des secrets, la collecte HTTP et le flux SSE. Les tests de seuils couvrent les limites, priorités, hystérésis, confirmations, erreurs et péremption. Le parcours Chromium vérifie l’édition, les échanges par glisser-déposer, le redimensionnement, les seuils, deux écrans synchronisés et le rendu mobile.

Un test de régression vérifie aussi la création depuis un dashboard vide, l’ajout de règles et la duplication lorsque `crypto.randomUUID` est indisponible, comme sur une origine HTTP non locale. Les suffixes d’identifiants utilisent `crypto.getRandomValues`, compatible avec cet accès.

## Structure

```text
shared/model.ts       Schémas de validation et types communs
server/app.ts         API, documentation OpenAPI et flux SSE
server/thresholds.ts  Moteur de décision
server/collector.ts   Collecte HTTP JSON
server/store.ts       Stockage SQLite et validation de placement
server/seed.ts        Tuiles de démonstration
web/                 Dashboard et éditeur React
tests/               Tests API, seuils et navigateur
Dockerfile           Image multi-stage
compose.yaml         Déploiement et volume persistant
```

Le projet reprend l’esprit visuel de Monitoror avec une implémentation indépendante. Les polices Open Sans sont embarquées localement via Fontsource ; aucune ressource externe n’est nécessaire au fonctionnement de l’interface.
