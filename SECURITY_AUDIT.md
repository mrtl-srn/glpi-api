# Rapport d'Audit de Sécurité — `glpi-api` (v2.0.0)

**Date :** 15 octobre 2026  
**Cible :** Bibliothèque client TypeScript [`glpi-api`](./package.json)  
**Périmètre :** Code source complet (`src/`), architecture d'authentification OAuth2, transport HTTP et proxy, générateur RSQL, téléchargement/téléversement de documents, et chaîne d'approvisionnement logicielle.  
**Version évaluée :** Commit `885b497` (tag `v2.0.0`)

---

## 1. Synthèse Exécutive & Posture Globale

La bibliothèque `glpi-api` présente une **très bonne posture de sécurité structurelle** :
- **0 dépendance d'exécution (`dependencies: {}`)** : La chaîne d'approvisionnement au runtime est totalement exempte de vulnérabilités tierces.
- **APIs Web Standard natives** : Utilisation de `fetch`, `FormData`, `Blob` et `URL` standard de Node 18+, limitant la surface d'attaque.
- **Résistance native à la Prototype Pollution** : `RouteRegistry` s'appuie sur `Map<string, string>` plutôt que des objets littéraux JavaScript non protégés.
- **Gestion robuste de la concurrence** : Le `TokenManager` implémente un mutex « single-flight » prévenant les attaques par épuisement de ressources (*thundering herd*) lors du renouvellement des jetons.

L'audit a identifié **deux vulnérabilités de sévérité Élevée** (exposition d'identifiants dans les erreurs/logs et fuite de jeton Bearer sur URL absolue) et **quatre vulnérabilités de sévérité Moyenne** (injection RSQL via les champs, confusion de route / traversée de chemin, non-assainissement du header `Content-Disposition`, et rétention des mots de passe après `logout`).

---

## 2. Tableau Récapitulatif des Vulnérabilités

| Identifiant | Sévérité | CWE | Composant Affecté | Résumé de la Vulnérabilité | Statut |
| :--- | :---: | :---: | :--- | :--- | :---: |
| **VULN-01** | **Élevée** | CWE-209 / CWE-532 | `src/http/FetchHttpClient.ts` | Fuite d'identifiants (mot de passe, `client_secret`) dans les objets d'erreur HTTP et les journaux | **Résolu** |
| **VULN-02** | **Élevée** | CWE-200 / CWE-522 | `src/client.ts` | Injection inconditionnelle du jeton Bearer sur des URLs absolues externes (fuite de token) | **Résolu** |
| **VULN-03** | **Moyenne** | CWE-943 / CWE-89 | `src/rsql/builder.ts` | Injection RSQL via les noms de propriétés (`field`) non assainis dans les opérateurs | **Résolu** |
| **VULN-04** | **Moyenne** | CWE-22 / CWE-88 | `src/resources/ResourceService.ts` | Risque de traversée de chemin / confusion de route via les identifiants de ressources non encodés | **Résolu** |
| **VULN-05** | **Moyenne** | CWE-22 | `src/resources/domain/DocumentResource.ts` | Absence d'assainissement du `filename` extrait du `Content-Disposition` lors du téléchargement | **Résolu** |
| **VULN-06** | **Moyenne** | CWE-312 / CWE-316 | `src/auth/PasswordAuthProvider.ts` | Maintien du mot de passe en mémoire et persistance des identifiants après `logout()` | **Résolu** |
| **VULN-07** | **Faible** | CWE-697 | `src/http/FetchHttpClient.ts` | Absence de support des plages CIDR IPv6 dans le parseur de contournement de proxy `NO_PROXY` | Ouvert |
| **VULN-08** | **Faible** | CWE-319 | `src/client.ts` | Absence d'alerte lors de l'utilisation d'une URL HTTP non sécurisée en dehors de localhost | Ouvert |
| **VULN-09** | **Info** | CWE-1395 | `package.json` | Avis de sécurité dans les outils de développement (`vitest`, `esbuild`, `tinypool`) | Accepté |

---

## 3. Analyse Détaillée des Vulnérabilités & Remédiations

---

### VULN-01 [Élevée] : Fuite d'Identifiants Sensibles dans l'Objet Erreur et les Journaux

- **CWE :** CWE-209 (Information Exposure Through an Error Message), CWE-532 (Insertion of Sensitive Information into Log File)
- **Localisation :** `src/http/FetchHttpClient.ts:510-514`, `src/auth/PasswordAuthProvider.ts:61-75`, `src/auth/ClientCredentialsAuthProvider.ts:53-67`

#### Mécanisme
Lorsqu'une requête HTTP échoue, `FetchHttpClient` instancie une erreur (`GlpiHttpError`, `GlpiValidationError`, etc.) et y attache l'intégralité de l'objet `options` de la requête d'origine :
```typescript
// src/http/FetchHttpClient.ts:513
(errorToThrow as any).options = options;
throw errorToThrow;
```
Lors des appels d'authentification vers `/token` effectués par `PasswordAuthProvider` ou `ClientCredentialsAuthProvider`, `options.body` contient le corps POST en clair :
```typescript
body: {
  grant_type: 'password',
  username: 'admin',
  password: 'SuperSecretPassword123!'
}
```
Si la requête échoue (ex: erreur 400 Bad Request, 401 Unauthorized ou erreur réseau) et que l'application cliente ou un middleware journalise l'erreur (`console.error(err)`, Sentry, Datadog, Elasticsearch), Node.js inspecte récursivement les propriétés de l'erreur et **affiche le mot de passe utilisateur ou le secret client en clair dans les logs**.

#### Démonstration
```bash
GlpiHttpError: HTTP 400 Bad Request: https://glpi.corp/token
  status: 400,
  options: {
    method: 'POST',
    path: '/token',
    body: {
      grant_type: 'password',
      username: 'admin',
      password: 'SuperSecretPassword123!' // <-- EXPOSÉ EN CLAIR DANS LES LOGS
    }
  }
```

#### Remédiation Recommandée
Masquer les champs sensibles dans `options` avant de les attacher à l'erreur, ou ne conserver que les champs non sensibles (`method`, `path`, `timeout`) :
```typescript
// Solution dans src/http/FetchHttpClient.ts
const sanitizedOptions: Partial<HttpRequestOptions> = {
  method: options.method,
  path: options.path,
  timeout: options.timeout,
};

// Ne jamais exposer 'password', 'client_secret', 'code' ou 'Authorization'
(errorToThrow as any).options = sanitizedOptions;
```

---

### VULN-02 [Élevée] : Fuite du Jeton Bearer sur Requêtes vers URLs Externes Absolues

- **CWE :** CWE-200 (Exposure of Sensitive Information to an Unauthorized Actor), CWE-522 (Insufficiently Protected Credentials)
- **Localisation :** `src/client.ts:383-407`, `src/http/FetchHttpClient.ts:552-565`

#### Mécanisme
Dans `FetchHttpClient.buildUrl` :
```typescript
if (path.startsWith('http://') || path.startsWith('https://')) {
  urlString = path;
}
```
Si le chemin passé est une URL absolue, elle remplace totalement l'URL de base (`baseUrl`).

Dans `GlpiClient.setupInterceptors`, l'intercepteur de requête ajoute le header `Authorization: Bearer <token>` :
```typescript
httpClient.useRequestInterceptor(async (requestOpts) => {
  if (this.authProvider) {
    const isTokenPath = typeof requestOpts.path === 'string' && requestOpts.path.includes('/token');
    if (!isTokenPath) {
      const token = await this.authProvider.getAccessToken();
      // Injecte inconditionnellement le jeton sans vérifier l'hôte cible !
      requestOpts.headers['Authorization'] = `Bearer ${token}`;
    }
  }
  return requestOpts;
});
```
Si une application effectue un appel direct `client.http.get('https://attacker-controlled.site/api')` ou suit une URL externe renvoyée dans un champ de ressource, **le jeton Bearer d'authentification GLPI est envoyé au serveur tiers**. De surcroît, si ce serveur renvoie un code 401, l'intercepteur de réponse invalide le jeton et lui envoie un jeton régénéré flambant neuf.

#### Remédiation Recommandée
Valider la même origine (*Same-Origin Check*) avant d'injecter le jeton :
```typescript
// Dans src/client.ts setupInterceptors
const isTokenPath = typeof requestOpts.path === 'string' && requestOpts.path.includes('/token');
let isSameOrigin = true;

if (typeof requestOpts.path === 'string' && (requestOpts.path.startsWith('http://') || requestOpts.path.startsWith('https://'))) {
  try {
    const targetOrigin = new URL(requestOpts.path).origin;
    const baseOrigin = new URL(this.rootHttpClient.getBaseUrl()).origin;
    isSameOrigin = targetOrigin === baseOrigin;
  } catch {
    isSameOrigin = false;
  }
}

if (!isTokenPath && isSameOrigin) {
  const token = await this.authProvider.getAccessToken();
  // ... injecter Authorization
}
```

---

### VULN-03 [Moyenne] : Injection RSQL via les Noms de Propriétés (`field`)

- **CWE :** CWE-943 (Improper Neutralization for Special Elements in Data Query Logic), CWE-89
- **Localisation :** `src/rsql/builder.ts:68-163`

#### Mécanisme
La fonction `escapeValue(val)` protège et échappe rigoureusement les **valeurs** (échappement des guillemets, parenthèses, points-virgules, virgules et signes égal).  
Cependant, l'argument `field` dans `RsqlBuilder` est injecté directement sans aucun assainissement :
```typescript
// src/rsql/builder.ts:68
eq(field: string, val: unknown): this {
  return this.append(`${field}==${escapeValue(val)}`);
}
```
Si une application reçoit un nom de champ depuis une requête HTTP (ex. `client.tickets.list({ filter: rsql().eq(req.query.searchField, req.query.searchValue) })`) :
- Entrée fournie dans `searchField` : `id=gt=0,name`
- Résultat compilé : `id=gt=0,name=="admin"`
- Interprétation FIQL/RSQL : `(id > 0) OR (name == "admin")`

L'attaquant altère complètement la logique booléenne de la requête, pouvant contourner les filtres d'accès aux entités ou exfiltrer des tickets non autorisés.

#### Remédiation Recommandée
Valider que le champ passé correspond strictement à la syntaxe d'un identifiant RSQL/FIQL autorisé :
```typescript
const RSQL_FIELD_REGEX = /^[a-zA-Z0-9_.-]+$/;

function assertValidField(field: string): void {
  if (!field || typeof field !== 'string' || !RSQL_FIELD_REGEX.test(field)) {
    throw new GlpiError(`Invalid RSQL field identifier: "${field}"`);
  }
}
```
Appliquer `assertValidField(field)` en précondition de chaque opérateur dans `RsqlBuilder`.

---

### VULN-04 [Moyenne] : Risque de Traversée de Chemin via les Identifiants Non Encodés

- **CWE :** CWE-22 (Improper Limitation of a Pathname to a Restricted Directory), CWE-88 (Improper Neutralization of Argument Delimiters)
- **Localisation :** `src/resources/ResourceService.ts:166, 217, 249`, `src/resources/domain/TicketResource.ts:49, 73, 102, 141`, `src/resources/domain/DocumentResource.ts:254`

#### Mécanisme
Les identifiants (`id`, `ticketId`) acceptent les types `number | string` et sont interpolés directement dans les chemins d'URL :
```typescript
// src/resources/ResourceService.ts:166
path: `${this.basePath}/${id}`
```
Si un développeur consomme une API externe et passe un identifiant non assaini issu d'une route utilisateur (ex: `client.tickets.get(req.params.id)`) et que `id` vaut `../../Administration/User/Me` :
- Le chemin résolu devient : `/v2/Assistance/Ticket/../../Administration/User/Me`
- Ce chemin pointe en réalité vers `/v2/Administration/User/Me`, déviant la requête vers une tout autre ressource administrative.

#### Remédiation Recommandée
Encoder systématiquement les identifiants de ressource :
```typescript
path: `${this.basePath}/${encodeURIComponent(String(id))}`
```

---

### VULN-05 [Moyenne] : Absence d'Assainissement du Nom de Fichier Issu de `Content-Disposition`

- **CWE :** CWE-22 (Path Traversal in Downstream Consumer)
- **Localisation :** `src/resources/domain/DocumentResource.ts:37-67, 283-290`

#### Mécanisme
La méthode `DocumentResource.download` extrait le nom de fichier via `parseContentDispositionFilename(contentDisposition)` et le renvoie tel quel dans `DocumentDownloadResult.filename`.  
Si un document hébergé sur GLPI a été nommé avec des séquences de traversée de chemin (ex: `../../../../etc/shadow` ou `..\\..\\Windows\\win.ini`) ou des caractères de contrôle (`\0`), le consommateur aval qui écrit le fichier sur son disque avec `fs.writeFile(path.join(uploadDir, result.filename), result.data)` sera victime d'une écriture de fichier arbitraire.

#### Remédiation Recommandée
Nettoyer le nom de fichier extrait pour ne renvoyer que son nom de base sain, exempt de séparateurs de répertoires :
```typescript
function sanitizeFilename(filename?: string): string | undefined {
  if (!filename) return undefined;
  // Supprime les séparateurs de chemin et séquences de remontée
  const cleaned = filename
    .replace(/\0/g, '')
    .replace(/^.*[\\/]/, '')
    .replace(/^\.+/, '')
    .trim();
  return cleaned || undefined;
}
```

---

### VULN-06 [Moyenne] : Rétention Indéfinie du Mot de Passe en Mémoire et Persistance après `logout()`

- **CWE :** CWE-312 (Cleartext Storage of Sensitive Information), CWE-316 (Cleartext Storage of Sensitive Information in Memory)
- **Localisation :** `src/auth/PasswordAuthProvider.ts:26-28, 56-58`

#### Mécanisme
En raison des spécifications de l'API REST v2 de GLPI, le grant OAuth2 `password` délivre un `access_token` mais **aucun `refresh_token`**. Pour permettre le renouvellement automatique transparent du jeton lors d'opérations longues, `PasswordAuthProvider` conserve `username` et `password` en mémoire.

Cependant :
1. Dans `PasswordAuthProvider.logout()` :
   ```typescript
   async logout(): Promise<void> {
     await this.tokenManager.clearToken();
   }
   ```
   Contrairement à `AuthorizationCodeAuthProvider` qui réinitialise `this.code = undefined; this.refreshToken = undefined;`, `PasswordAuthProvider` **ne supprime pas `this.password` ni `this.username`**.  
2. Un appel ultérieur à `client.tickets.list()` après un `client.logout()` relance automatiquement une authentification avec le mot de passe resté en mémoire au lieu d'échouer.

#### Remédiation Recommandée
Réinitialiser les identifiants lors de l'appel à `logout()` :
```typescript
async logout(): Promise<void> {
  this.username = '';
  this.password = '';
  await this.tokenManager.clearToken();
}
```

---

### VULN-07 [Faible] : Absence de Support IPv6 dans les Règles CIDR de `NO_PROXY`

- **CWE :** CWE-697 (Incorrect Comparison)
- **Localisation :** `src/http/FetchHttpClient.ts:18-41`

#### Mécanisme
La fonction `matchCidr` délègue à `ipToInt`, qui exige strictement 4 blocs décimaux séparés par des points (`parts.length !== 4`). Toute règle CIDR IPv6 (ex: `fe80::/10` ou `2001:db8::/32`) renvoie `false`. Les requêtes destinées à des réseaux locaux IPv6 déclarés en contournement de proxy seront donc transmises au proxy d'entreprise au lieu d'être traitées en direct.

---

### VULN-08 [Faible] : Absence d'Avertissement sur URL Non Chiffrée (`http://`)

- **CWE :** CWE-319 (Cleartext Transmission of Sensitive Information)
- **Localisation :** `src/client.ts:112-130`

#### Mécanisme
Si un utilisateur configure `apiUrl: 'http://glpi.internal/api.php'`, le client transmet les identifiants OAuth et jetons Bearer en clair sans avertissement.  
**Recommandation :** Émettre un avertissement via `logger.warn()` si le protocole est `http:` et que l'hôte n'est pas `localhost` ou `127.0.0.1`.

---

### VULN-09 [Informationnel] : Avis de Sécurité dans l'Outillage de Développement

- **Localisation :** `package.json:41-46` (`devDependencies`)
- **Mécanisme :**
  L'exécution de `npm audit` remonte 6 avis de sécurité affectant `vitest@2.1.3`, `esbuild@0.21.5` et `tinypool@0.8.4` (GHSA-82fw-gwwq-j7x9, GHSA-5gmw-xhrv-c9v3).
- **Impact Réel :** **Nul en production**. Le paquet distribué sur npm (`dist/`) n'inclut aucune de ces dépendances (`dependencies: {}`). Le risque concerne uniquement les machines de développement lors de l'exécution des tests.

---

## 4. Recommandations de Déploiement & Bonnes Pratiques

1. **Correctifs appliqués sur la librairie (100% vérifiés par tests unitaires) :**
   - **VULN-01 (Résolu) :** Masquage et troncature récursive des données sensibles (`password`, `client_secret`, `token`, `authorization`, etc.) dans les en-têtes et le corps de requête attachés aux erreurs HTTP et logs (`FetchHttpClient.ts`). Tests : `tests/http.test.ts`.
   - **VULN-02 (Résolu) :** Protection contre la fuite de jeton Bearer et boucle de retry 401 sur URLs absolues externes via `isSameOrigin()` (`src/client.ts`). Tests : `tests/client.test.ts`.
   - **VULN-03 (Résolu) :** Validation stricte des noms de champs RSQL via `assertValidField()` (`/^[a-zA-Z0-9_.-]+$/`) dans tous les opérateurs (`src/rsql/builder.ts`). Tests : `tests/rsql.test.ts`.
   - **VULN-04 (Résolu) :** Encodage systématique de tous les identifiants de routes avec `encodeURIComponent` pour prévenir les confusions de route et path traversal (`ResourceService.ts`, `TicketResource.ts`, `DocumentResource.ts`). Tests : `tests/resource.test.ts`, `tests/domain-resources.test.ts`.
   - **VULN-05 (Résolu) :** Assainissement strict du nom de fichier dans `DocumentResource.download` via `sanitizeFilename()` (élimination des octets nuls, séparateurs de répertoires, points initiaux) (`DocumentResource.ts`). Tests : `tests/domain-resources.test.ts`.
   - **VULN-06 (Résolu) :** Purge complète des variables `username` et `password` en mémoire lors de l'appel `logout()` avec blocage des ré-authentifications ultérieures sans réinitialisation explicite (`PasswordAuthProvider.ts`). Tests : `tests/auth.test.ts`.

2. **Recommandations pour les applications clientes consommatrices :**
   - **Mode d'authentification :** En production, privilégier le flux `authorization_code` ou `client_credentials` pour éviter de stocker des mots de passe utilisateurs en mémoire lorsque l'environnement GLPI le permet.
   - **HTTPS impératif :** Toujours cibler une URL d'API GLPI protégée par TLS (`https://`).
   - **Sanitisation des téléversements :** Lors de l'utilisation de `client.documents.upload(filePath)`, valider systématiquement que le chemin fourni se trouve dans un répertoire blanc autorisé (*whitelist directory*) pour éviter toute lecture de fichier arbitraire.
