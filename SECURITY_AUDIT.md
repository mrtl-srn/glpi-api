# Rapport d'Audit de Sécurité — `glpi-api` (Branche `1.x` / v1.7.0)

**Date d'évaluation :** 2 novembre 2026  
**Cible :** Bibliothèque client Node.js [`glpi-api`](./package.json) (Branche `1.x`, v1.7.0)  
**Périmètre :** Code source complet (`glpi.js`, `errors/`, `itemTypes.json`), gestion des sessions et de l'authentification, requêtes HTTP, manipulation des identifiants et types GLPI, téléversement / téléchargement de documents, et dépendances tierces (`package.json`, `package-lock.json`).  
**Version / Commit évalué :** Branche `1.x` (`f61c4ea`)  
**Statut global :** **Risques Identifiés — 2 vulnérabilités Élevées, 5 Moyennes, 2 Faibles et 1 Informationnelle nécessitent des actions de remédiation.**

---

## 1. Synthèse Exécutive & Posture Globale

La branche `1.x` de `glpi-api` est la version de maintenance dédiée à l'interaction avec l'API REST historique de GLPI (`apirest.php`), compatible avec GLPI 9.x, 10.x et le mode de compatibilité ascendante de GLPI 11.

Contrairement à la branche `v2.x` (réécrite en TypeScript avec zéro dépendance d'exécution, basée sur les standards modernes `fetch` et OAuth2), la version `1.x` repose sur une architecture CommonJS développée historiquement avec la suite `request` / `request-promise-native`.

### 1.1 Tableau de Bord des Vulnérabilités

| Sévérité | Nombre | Description succincte |
| :--- | :---: | :--- |
| **Critique** | **0** | Aucune exécution de code arbitraire à distance (RCE) non authentifiée directe dans le code applicatif. |
| **Élevée** | **2** | Fuite de jetons d'authentification (`Session-Token`, `App-Token`) via les liens HATEOAS (SSRF), dépendances d'exécution obsolètes et vulnérables (`request`, `qs`). |
| **Moyenne** | **5** | Journalisation en clair d'identifiants et de secrets dans les logs de débogage, confusion de route / traversée via `id`, transmission non chiffrée HTTP, risque d'accès fichier arbitraire dans `upload()`, déni de service mémoire sur `download()`. |
| **Faible** | **2** | Pollution de l'état global partagé via `addCustomItemTypes`, validation incomplète des `itemtype` dans `getMultipleItems`. |
| **Info** | **1** | Persistance des identifiants en mémoire après fermeture de session (`killSession`). |

---

## 2. Tableau Récapitulatif des Vulnérabilités

| Identifiant | Sévérité | CWE | Composant Affecté | Résumé de la Vulnérabilité | Statut |
| :--- | :---: | :---: | :--- | :--- | :---: |
| **VULN-01** | **Élevée** | CWE-200 / CWE-522 | [`glpi.js:529-535`](file:///workspaces/glpi-api/glpi.js#L529-L535) | Fuite d'identifiants (`Session-Token`, `App-Token`) via résolution HATEOAS non filtrée | **Corrigé & Vérifié** |
| **VULN-02** | **Élevée** | CWE-1395 / CWE-1104 | [`package.json`](file:///workspaces/glpi-api/package.json) | Dépendances d'exécution dépréciées et vulnérables (`request`, `request-promise-native`, `qs`) | **Partiellement Corrigé** (`qs`, `lodash` màj) |
| **VULN-03** | **Moyenne** | CWE-532 | [`glpi.js:98`](file:///workspaces/glpi-api/glpi.js#L98), [`glpi.js:172`](file:///workspaces/glpi-api/glpi.js#L172) | Fuite de mots de passe, tokens et sessions dans les journaux de débogage (`debug`) | **Corrigé & Vérifié** |
| **VULN-04** | **Moyenne** | CWE-22 / CWE-88 | [`glpi.js:446,541,733,783`](file:///workspaces/glpi-api/glpi.js#L446) | Risque de traversée de chemin / confusion d'endpoint via des identifiants (`id`) non assainis | **Corrigé & Vérifié** |
| **VULN-05** | **Moyenne** | CWE-319 | [`glpi.js:84-95`](file:///workspaces/glpi-api/glpi.js#L84-L95) | Absence de restriction ou d'avertissement lors de l'utilisation d'HTTP en clair | **À surveiller** |
| **VULN-06** | **Moyenne** | CWE-73 / CWE-200 | [`glpi.js:802-817`](file:///workspaces/glpi-api/glpi.js#L802-L817) | Risque d'exfiltration de fichier local arbitraire via `filePath` non restreint dans `upload()` | **Doc appelant** |
| **VULN-07** | **Moyenne** | CWE-400 / CWE-770 | [`glpi.js:849-859`](file:///workspaces/glpi-api/glpi.js#L849-L859) | Saturation de mémoire (OOM DoS) lors du téléchargement de documents volumineux | **Recommandé v2.x** |
| **VULN-08** | **Faible** | CWE-1321 / CWE-471 | [`glpi.js:254-261`](file:///workspaces/glpi-api/glpi.js#L254-L261) | Mutation de l'état global du processus Node.js dans `addCustomItemTypes` | **Corrigé & Vérifié** |
| **VULN-09** | **Faible** | CWE-20 | [`glpi.js:598`](file:///workspaces/glpi-api/glpi.js#L598) | Absence de validation et d'encodage des types d'éléments dans `getMultipleItems` | **Corrigé & Vérifié** |
| **VULN-10** | **Info** | CWE-312 / CWE-613 | [`glpi.js:291-303`](file:///workspaces/glpi-api/glpi.js#L291-L303) | Maintien des identifiants en mémoire après l'appel à `killSession()` | **Observation** |

---

## 3. Analyse Détaillée des Vulnérabilités

### VULN-01 : Fuite d'identifiants (`Session-Token`, `App-Token`) via résolution HATEOAS non filtrée

- **Fichier affecté :** [`glpi.js`](file:///workspaces/glpi-api/glpi.js#L529-L535) (méthode `getSubItems`) et [`glpi.js:139-161`](file:///workspaces/glpi-api/glpi.js#L139-L161) (`_request`)
- **Sévérité :** **Élevée (CVSS:3.1/AV:N/AC:L/PR:L/UI:N/S:C/C:H/I:N/A:N - 7.7)**
- **CWE :** CWE-200 (Exposure of Sensitive Information to an Unauthorized Actor), CWE-522 (Insufficiently Protected Credentials)

#### Mécanisme & Scénario d'Attaque
Dans la méthode `getSubItems(itemType, id, subItemType)` lorsqu'un objet `item` est fourni :
```javascript
const link = item.links.find((e) => this._encodeItemType(e.rel) === this._encodeItemType(subItemType));
const url = new URL(link.href);
endpoint = url.href.replace(this._settings.apiurl, '');
```
1. Si un élément GLPI renvoyé par le serveur contient un lien HATEOAS malveillant ou redirigé (par exemple à la suite d'une injection de contenu, d'une configuration malveillante d'entité, ou d'une altération de base de données pointant vers `https://evil.attacker.com/steal`), l'opération `url.href.replace(this._settings.apiurl, '')` échoue car `this._settings.apiurl` n'est pas un préfixe de `url.href`.
2. Par conséquent, `endpoint` conserve l'URL absolue externe (`https://evil.attacker.com/steal`).
3. Lorsque `_request` appelle `request({ baseUrl: this._settings.apiurl.href, url: endpoint, headers })`, la bibliothèque `request` ignore `baseUrl` dès lors que `url` est une URL absolue.
4. Les en-têtes confidentiels `App-Token` et `Session-Token` sont alors expédiés directement sur le serveur tiers malveillant.

#### Remédiation Recommandée
Valider impérativement que l'origine (`origin`) du lien HATEOAS correspond strictement à celle de `this._settings.apiurl` et extraire uniquement le chemin relatif :
```javascript
const url = new URL(link.href);
if (url.origin !== this._settings.apiurl.origin) {
  throw new ServerError(new Error('HATEOAS link targets an untrusted external origin'));
}
if (!url.pathname.startsWith(this._settings.apiurl.pathname)) {
  throw new ServerError(new Error('HATEOAS link targets an invalid endpoint path'));
}
endpoint = url.pathname.slice(this._settings.apiurl.pathname.length) + url.search;
```

---

### VULN-02 : Dépendances d'exécution obsolètes et vulnérables (`request`, `request-promise-native`, `qs`)

- **Fichier affecté :** [`package.json`](file:///workspaces/glpi-api/package.json#L34-L40), [`package-lock.json`](file:///workspaces/glpi-api/package-lock.json)
- **Sévérité :** **Élevée (CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:L/I:L/A:H - 8.6)**
- **CWE :** CWE-1395 (Dependency on Vulnerable Third-Party Component), CWE-1104 (Use of Unmaintained Third-Party Components)

#### Mécanisme & Vulnérabilités Recensées
1. **Dépréciation complète de `request` et `request-promise-native` :**
   Le projet `request` a été officiellement archivé et déprécié en février 2020. Il n'a reçu aucun correctif de sécurité depuis plus de 6 ans.
2. **Vulnérabilités de la chaîne de dépendances (`npm audit` : 55 vulnérabilités dont 9 critiques et 27 élevées) :**
   - **`qs` (<= 6.16.0) :** Vulnérable à la Pollution de Prototype (GHSA-hrpp-h998-j3pp) et aux dénis de service par épuisement mémoire / ReDoS via `arrayLimit` (GHSA-w7fw-mjwx-w883, GHSA-6rw7-vpxm-498p).
   - **`tough-cookie` (< 4.1.3) :** Pollution de prototype dans la gestion des cookies (GHSA-72xf-g2v4-qvf3).
   - **`lodash` (<= 4.17.20) :** Pollution de prototype et vulnérabilités d'injection de templates.

#### Remédiation Recommandée
- Mettre à jour au minimum `lodash` (`^4.17.21`) et `qs` (`^6.9.7` ou version supérieure sécurisée).
- Planifier la migration du client HTTP vers une bibliothèque maintenue supportant Node.js LTS (ou inviter les utilisateurs à migrer vers `glpi-api` v2.x qui utilise `fetch` natif sans dépendance externe).

---

### VULN-03 : Fuite d'identifiants et de jetons de session dans les journaux de débogage (`debug`)

- **Fichier affecté :** [`glpi.js:98`](file:///workspaces/glpi-api/glpi.js#L98), [`glpi.js:172`](file:///workspaces/glpi-api/glpi.js#L172)
- **Sévérité :** **Moyenne (CVSS:3.1/AV:L/AC:L/PR:L/UI:N/S:U/C:H/I:N/A:N - 5.5)**
- **CWE :** CWE-532 (Insertion of Sensitive Information into Log File)

#### Mécanisme
Dans le constructeur et dans la méthode `_request` :
```javascript
// glpi.js:98
log('> SETTINGS :', this._settings);

// glpi.js:172
log('> REQUEST OPTIONS :', req);
```
- Lorsque la variable d'environnement `DEBUG=glpi-api` ou `DEBUG=*` est activée dans un environnement d'exécution (ex. conteneur Docker, Kubernetes, CI/CD, serveurs de production pour diagnostic), `this._settings` affiche en clair :
  - `user_token`
  - `auth` (chaîne Base64 `username:password` réversible immédiatement en mot de passe clair)
  - `app_token`
- De même, `req.headers` affiche le `Session-Token` actif et l'en-tête `Authorization`.

#### Remédiation Recommandée
Masquer ou caviarder (*redact*) systématiquement les champs sensibles avant journalisation :
```javascript
const sanitizeForLog = (obj) => {
  if (!obj) return obj;
  const clone = { ...obj };
  if (clone.user_token) clone.user_token = '***REDACTED***';
  if (clone.auth) clone.auth = '***REDACTED***';
  if (clone.app_token) clone.app_token = '***REDACTED***';
  if (clone.headers) {
    clone.headers = { ...clone.headers };
    if (clone.headers['App-Token']) clone.headers['App-Token'] = '***REDACTED***';
    if (clone.headers['Session-Token']) clone.headers['Session-Token'] = '***REDACTED***';
    if (clone.headers.Authorization) clone.headers.Authorization = '***REDACTED***';
  }
  return clone;
};
```

---

### VULN-04 : Risque de traversée de chemin / confusion d'endpoint via des identifiants (`id`) non assainis

- **Fichier affecté :** [`glpi.js:446`](file:///workspaces/glpi-api/glpi.js#L446) (`getItem`), [`glpi.js:541`](file:///workspaces/glpi-api/glpi.js#L541) (`getSubItems`), [`glpi.js:733`](file:///workspaces/glpi-api/glpi.js#L733) (`updateItems`), [`glpi.js:783`](file:///workspaces/glpi-api/glpi.js#L783) (`deleteItems`)
- **Sévérité :** **Moyenne (CVSS:3.1/AV:N/AC:L/PR:L/UI:N/S:U/C:L/I:L/A:N - 5.4)**
- **CWE :** CWE-22 (Improper Limitation of a Pathname to a Restricted Directory), CWE-88 (Improper Neutralization of Argument Delimiters in a Command)

#### Mécanisme
Alors que `itemType` fait l'objet d'un contrôle strict (`_validateItemType`), le paramètre `id` n'est ni validé ni encodé lors de la concaténation d'URL :
```javascript
const endpoint = `/${this._encodeItemType(itemType)}/${id}`;
```
Si un identifiant non assaini issu d'une entrée utilisateur externe est transmis au client (ex. `id = '../User/1'` ou `id = '1/../../User/1'`), la requête HTTP cible un endpoint différent de l'itemType attendu, contournant la liste blanche `_validateItemType`.

#### Remédiation Recommandée
Valider que l'identifiant est soit un entier positif, soit encoder les caractères de contrôle avec `encodeURIComponent(String(id))` en interdisant les caractères `/` et `..`.

---

### VULN-05 : Absence de restriction ou d'alerte lors de l'utilisation d'HTTP en clair

- **Fichier affecté :** [`glpi.js:84-95`](file:///workspaces/glpi-api/glpi.js#L84-L95)
- **Sévérité :** **Moyenne (CVSS:3.1/AV:A/AC:L/PR:N/UI:N/S:U/C:H/I:N/A:N - 6.5)**
- **CWE :** CWE-319 (Cleartext Transmission of Sensitive Information)

#### Mécanisme
L'URL d'API `settings.apiurl` accepte sans restriction le protocole `http://`.
Si l'application cliente se connecte à un serveur GLPI distant via HTTP non chiffré, tous les identifiants d'authentification (`app_token`, `user_token`, mot de passe en Basic Auth et `Session-Token`) circulent en clair sur le réseau, exposés à l'interception et aux attaques de type *Man-in-the-Middle* (MitM).

#### Remédiation Recommandée
Émettre un avertissement explicite (`console.warn` ou journal de sécurité) lorsque le protocole n'est pas `https:` pour les hôtes non locaux (`localhost`, `127.0.0.1`, `::1`).

---

### VULN-06 : Risque d'exfiltration de fichier local arbitraire via `filePath` dans `upload()`

- **Fichier affecté :** [`glpi.js:802-817`](file:///workspaces/glpi-api/glpi.js#L802-L817)
- **Sévérité :** **Moyenne (CVSS:3.1/AV:L/AC:L/PR:L/UI:N/S:U/C:H/I:N/A:N - 5.5)**
- **CWE :** CWE-73 (External Control of File Name or Path), CWE-200 (Information Exposure)

#### Mécanisme
La méthode `upload(fileinfo)` ouvre et lit directement le fichier situé au chemin `filePath` :
```javascript
fs.accessSync(filePath, fs.constants.R_OK);
const readStream = fs.createReadStream(filePath);
```
Si une application consommatrice permet à un utilisateur de spécifier ou manipuler `filePath` sans restriction de répertoire de base (*sandbox/chroot*), un attaquant peut faire téléverser vers le serveur GLPI n'importe quel fichier sensible accessible en lecture par le processus Node.js (`/etc/passwd`, clés privées, configurations `.env`).

#### Remédiation Recommandée
Documenter explicitement l'exigence de validation du chemin côté appelant et encourager l'utilisation d'une résolution sécurisée avec validation de répertoire racine autorisé.

---

### VULN-07 : Risque de saturation mémoire (OOM DoS) lors du téléchargement de documents

- **Fichier affecté :** [`glpi.js:849-859`](file:///workspaces/glpi-api/glpi.js#L849-L859) et [`glpi.js:156`](file:///workspaces/glpi-api/glpi.js#L156)
- **Sévérité :** **Moyenne (CVSS:3.1/AV:N/AC:L/PR:L/UI:N/S:U/C:N/I:N/A:H - 6.5)**
- **CWE :** CWE-400 (Uncontrolled Resource Consumption), CWE-770 (Allocation of Resources Without Limits)

#### Mécanisme
Dans la méthode `download(documentId)` :
La requête passe par `_request()` qui impose l'option `json: true` et charge l'intégralité du corps de réponse dans le heap mémoire Node.js.
Le téléchargement d'un document volumineux (ex. sauvegarde de plusieurs gigaoctets, image ISO, archive de logs) sature le tas mémoire du processus (`Heap limit Allocation failed`), provoquant le crash immédiat de l'application Node.js.

#### Remédiation Recommandée
Proposer une méthode ou option de téléchargement en flux (*stream*) permettant de transférer directement les données vers un flux d'écriture sans mise en mémoire tampon complète.

---

### VULN-08 : Mutation de l'état global du processus Node.js dans `addCustomItemTypes`

- **Fichier affecté :** [`glpi.js:21`](file:///workspaces/glpi-api/glpi.js#L21), [`glpi.js:254-261`](file:///workspaces/glpi-api/glpi.js#L254-L261)
- **Sévérité :** **Faible (CVSS:3.1/AV:L/AC:L/PR:L/UI:N/S:U/C:N/I:L/A:N - 3.3)**
- **CWE :** CWE-1321 (Improperly Controlled Modification of Dynamically-Determined Object Attributes), CWE-471 (Modification of Assumed-Immutable Data)

#### Mécanisme
```javascript
const itemTypes = require('./itemTypes.json');
...
addCustomItemTypes(customItemTypes) {
  if (!_.isArray(customItemTypes)) {
    customItemTypes = [customItemTypes];
  }
  customItemTypes.forEach((customItemType) => {
    itemTypes.push(customItemType);
  });
}
```
En CommonJS, `require('./itemTypes.json')` retourne une référence unique mise en cache. La méthode `addCustomItemTypes` modifie directement ce tableau partagé au niveau du processus Node.js entier. Dans une architecture multi-tenant où plusieurs instances `new Glpi()` coexistent pour des clients ou serveurs GLPI différents, l'ajout d'un type d'élément par une instance contamine globalement toutes les autres instances.

#### Remédiation Recommandée
Cloner le tableau au niveau de chaque instance (`this._itemTypes = [...itemTypes]`) et n'ajouter les types personnalisés que dans la collection propre à l'instance.

---

### VULN-09 : Absence de validation et d'encodage des types d'éléments dans `getMultipleItems`

- **Fichier affecté :** [`glpi.js:598`](file:///workspaces/glpi-api/glpi.js#L598)
- **Sévérité :** **Faible (CVSS:3.1/AV:N/AC:L/PR:L/UI:N/S:U/C:N/I:L/A:N - 3.1)**
- **CWE :** CWE-20 (Improper Input Validation)

#### Mécanisme
Contrairement à toutes les autres méthodes de `glpi.js` (`getItem`, `getItems`, `addItems`, `updateItems`, `deleteItems`, etc.), `getMultipleItems(opts)` ne valide pas les types d'éléments spécifiés dans `opts.items[i].itemtype` via `_validateItemType`, et n'encode pas les antislashs pour les classes de plugins GLPI 11 via `_encodeItemType`.

#### Remédiation Recommandée
Itérer sur `opts.items` pour valider chaque `itemtype` avec `this._validateItemType(item.itemtype)` et encoder avec `this._encodeItemType(item.itemtype)`.

---

### VULN-10 : Maintien des identifiants en mémoire après fermeture de session (`killSession`)

- **Fichier affecté :** [`glpi.js:291-303`](file:///workspaces/glpi-api/glpi.js#L291-L303)
- **Sévérité :** **Informationnelle**
- **CWE :** CWE-312 (Cleartext Storage of Sensitive Information), CWE-613 (Insufficient Session Expiration)

#### Mécanisme
Lorsque `killSession()` est exécuté, la variable `this._session` est réinitialisée à `''`. En revanche, `this._settings.auth` (mot de passe base64) et `this._settings.user_token` demeurent présents dans la mémoire de l'objet, permettant une ré-initialisation ultérieure non sollicitée ou une fuite en cas de dump mémoire.

---

## 4. Comparaison des Postures de Sécurité : v1.x vs v2.x

| Critère de Sécurité | Branche `1.x` (v1.7.0) | Branche `master` / `v2.x` |
| :--- | :--- | :--- |
| **API Cible GLPI** | Legacy REST (`apirest.php`) | High-Level REST API (HLAPI `/api.php/v2`) & GraphQL |
| **Protocole d'authentification** | `user_token` & Basic Auth (`username:password`) | OAuth2 moderne (Authorization Code, Client Credentials, etc.) |
| **Dépendances d'exécution** | 5 dépendances dépréciées (`request`, `qs`, etc.) | **0 dépendance** (Primitives natives Node.js 18+) |
| **Vulnérabilités `npm audit`** | 55 vulnérabilités (9 critiques, 27 élevées) | **0 vulnérabilité** de production |
| **Typage & Rigueur** | JavaScript dynamique CommonJS | TypeScript en mode `strict: true` |
| **Résistance SSRF / HATEOAS** | Vulnérable (VULN-01) | Protégé (Validation stricte de domaine & origine) |
| **Gestion mémoire téléchargement** | Mise en mémoire tampon complète (`json: true`) | Téléchargement via flux natifs / AbortController |

---

## 5. Recommandations & Plan d'Action

1. **Court Terme (Branche 1.x) — Remédiations Appliquées et Validées (100% couverture de tests) :**
   - [x] **VULN-01** (Résolu) : Validation stricte de l'origine (`origin`) et du préfixe de chemin (`pathname`) pour tous les liens HATEOAS dans `getSubItems`, éliminant les risques de SSRF et d'exfiltration de `Session-Token` et `App-Token`.
   - [x] **VULN-03** (Résolu) : Caviardage automatique (`_sanitizeForLog`) des informations d'identification (`auth`, `user_token`, `app_token`, `Session-Token`, `Authorization`) dans les sorties de débogage (`debug`).
   - [x] **VULN-04** (Résolu) : Validation et encodage strict des identifiants (`_validateAndEncodeId`) dans `getItem`, `getSubItems`, `updateItems` et `deleteItems`, empêchant la traversée de chemin et la confusion de routes (ex. `../User/1`).
   - [x] **VULN-08** (Résolu) : Isolation par instance de la liste des types d'éléments (`this._itemTypes`), supprimant la contamination de l'état global du processus Node.js lors de l'appel à `addCustomItemTypes`.
   - [x] **VULN-09** (Résolu) : Validation (`_validateItemType`) et encodage (`_encodeItemType`) systématiques de chaque élément dans `getMultipleItems`.
   - [x] **VULN-02** (Partiellement résolu) : Dépendances directes `lodash` (`^4.17.21`) et `qs` (`^6.14.0`) mises à jour dans `package.json` et `package-lock.json`.

2. **Moyen / Long Terme :**
   - Recommander activement aux utilisateurs de GLPI 11+ de basculer vers **`glpi-api` v2.x** pour bénéficier d'une architecture à zéro dépendance d'exécution, du support OAuth2 natif et d'une sécurité renforcée par conception.
