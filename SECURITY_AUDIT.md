# Rapport d'Audit de Sécurité — `glpi-api` (v2.0.0 Post-Remédiation)

**Date d'évaluation :** 15 octobre 2026  
**Cible :** Bibliothèque client TypeScript [`glpi-api`](./package.json)  
**Périmètre :** Code source complet (`src/`), architecture d'authentification OAuth2, transport HTTP et proxy, générateur RSQL, téléchargement/téléversement de documents, et dépendances.  
**Version / Commit évalué :** Commit `4730202` (branche `32-security-audit`, basé sur `v2.0.0`)  
**Statut global :** **Excellent — Toutes les vulnérabilités Élevées et Moyennes antérieures ont été résolues et validées par tests unitaires.**

---

## 1. Synthèse Exécutive & Posture Globale

Cet audit de sécurité fait suite à la mise en œuvre des correctifs sur la bibliothèque `glpi-api` v2.0.0. L'audit a évalué le code source après application des correctifs prioritaires (**VULN-01 à VULN-06**).

### 1.1 Évolution de la Posture de Sécurité

| Métrique | État Initial (Tag `v2.0.0` - `885b497`) | État Actuel (Commit `4730202`) | Évolution |
| :--- | :---: | :---: | :---: |
| **Vulnérabilités Critiques** | 0 | 0 | Stable |
| **Vulnérabilités Élevées** | 2 | **0** | **-100% (Résolues)** |
| **Vulnérabilités Moyennes** | 4 | **0** | **-100% (Résolues)** |
| **Vulnérabilités Faibles** | 2 | 4 | +2 (Nouvelles observations documentées) |
| **Avis Informationnels** | 1 | 2 | +1 (Recommandation d'usage) |
| **Couverture de tests unitaires** | 143 tests | **149 tests (100% passants)** | +6 tests de sécurité dédiés |
| **Dépendances d'exécution (`dependencies`)** | **0** | **0** | Chaîne de production 100% isolée |

### 1.2 Points Forts Architecturaux Confirmés

1. **Zéro dépendance d'exécution (`dependencies: {}`) :**
   Aucune dépendance tierce n'est chargée au runtime. L'ensemble des fonctionnalités s'appuie sur les primitives standard de Node.js 18+ (`fetch`, `FormData`, `Blob`, `URL`, `Headers`, `AbortController`). Le risque d'attaque par chaîne d'approvisionnement (*supply-chain attack*) en production est nul.
2. **Mitigation native de la Pollution de Prototype :**
   L'aiguillage des routes dans [`RouteRegistry`](./src/resources/RouteRegistry.ts) repose sur des instances de `Map<string, string>`, immunisant la bibliothèque contre l'empoisonnement d'objets `Object.prototype`.
3. **Protection contre le Thundering Herd (Single-Flight Mutex) :**
   [`TokenManager`](./src/auth/TokenManager.ts) centralise le renouvellement des jetons OAuth2 à l'aide d'un verrou synchronisé sur promesse, empêchant la saturation de l'API GLPI lors de rafales de requêtes concurrentes à expiration de jeton.
4. **Validation stricte TypeScript :**
   Compilé en mode `strict: true` sans aucun contournement de typage implicite (`noImplicitAny`), assurant la cohérence structurelle des flux de données.

---

## 2. Tableau Récapitulatif des Vulnérabilités

| Identifiant | Sévérité | CWE | Composant Affecté | Résumé de la Vulnérabilité | Statut |
| :--- | :---: | :---: | :--- | :--- | :---: |
| **VULN-01** | **Élevée** | CWE-209 / CWE-532 | `src/http/FetchHttpClient.ts` | Fuite d'identifiants (mot de passe, `client_secret`) dans les objets d'erreur HTTP et logs | **Résolu & Vérifié** |
| **VULN-02** | **Élevée** | CWE-200 / CWE-522 | `src/client.ts` | Injection inconditionnelle du jeton Bearer sur des URLs absolues externes | **Résolu & Vérifié** |
| **VULN-03** | **Moyenne** | CWE-943 / CWE-89 | `src/rsql/builder.ts` | Injection RSQL via les noms de propriétés (`field`) non assainis dans les opérateurs | **Résolu & Vérifié** |
| **VULN-04** | **Moyenne** | CWE-22 / CWE-88 | `src/resources/ResourceService.ts` | Risque de traversée de chemin / confusion de route via les identifiants non encodés | **Résolu & Vérifié** |
| **VULN-05** | **Moyenne** | CWE-22 | `src/resources/domain/DocumentResource.ts` | Absence d'assainissement du `filename` extrait du `Content-Disposition` | **Résolu & Vérifié** |
| **VULN-06** | **Moyenne** | CWE-312 / CWE-316 | `src/auth/PasswordAuthProvider.ts` | Maintien du mot de passe en mémoire et persistance des identifiants après `logout()` | **Résolu & Vérifié** |
| **VULN-07** | **Faible** | CWE-697 | `src/http/FetchHttpClient.ts` | Absence de support des plages CIDR IPv6 dans le parseur de contournement `NO_PROXY` | Ouvert |
| **VULN-08** | **Faible** | CWE-319 | `src/client.ts` | Absence d'alerte lors de l'utilisation d'une URL HTTP non sécurisée hors localhost | Ouvert |
| **VULN-09** | **Info** | CWE-1395 | `package.json` | Avis de sécurité dans les outils de développement (`vitest`, `esbuild`, `tinypool`) | Accepté (Dev) |
| **VULN-10** | **Faible** | CWE-400 / CWE-770 | `src/resources/domain/DocumentResource.ts` | Risque de saturation mémoire (OOM) sur téléchargement de fichiers volumineux sans streaming | Ouvert |
| **VULN-11** | **Faible** | CWE-312 | `src/auth/ClientCredentialsAuthProvider.ts` | Persistance du `clientSecret` après `logout()` permettant une ré-authentification implicite | Ouvert |
| **VULN-12** | **Info** | CWE-73 / CWE-200 | `src/resources/domain/DocumentResource.ts` | Risque de lecture de fichier arbitraire si `filePath` non assaini fourni par le consommateur | Recommandation |

---

## 3. Vérification & Preuves des Correctifs Appliqués (VULN-01 à VULN-06)

### VULN-01 : Masquage des Identifiants Sensibles dans les Erreurs et Journaux
- **Localisation :** [`src/http/FetchHttpClient.ts`](./src/http/FetchHttpClient.ts#L107-L220)
- **Correctif mis en place :**
  - Ajout de l'expression régulière stricte `SENSITIVE_KEY_PATTERN = /^(authorization|password|client[-_]?secret|secret|token|access[-_]?token|refresh[-_]?token|code|user[-_]?token|app[-_]?token)$/i`.
  - Implémentation des fonctions d'assainissement récursives [`redactSensitiveObject`](./src/http/FetchHttpClient.ts#L110), [`sanitizeHeaders`](./src/http/FetchHttpClient.ts#L136) et [`sanitizeBody`](./src/http/FetchHttpClient.ts#L156).
  - Traitement des corps d'erreurs sérialisés JSON, formulaires encodés (`URLSearchParams` / query strings) et en-têtes HTTP (instances `Headers`, tableaux de tuples ou objets littéraux).
  - Remplacement des valeurs sensibles par `'[REDACTED]'` avant toute assignation sur l'objet d'erreur `(errorToThrow as any).options = sanitizeRequestOptions(options)`.
- **Validation par tests :**
  - Fichier de test : [`tests/http.test.ts`](./tests/http.test.ts)
  - Cas vérifiés : Masquage dans `options.body` (JSON et URLSearchParams), masquage dans `options.headers` (`authorization`, `user-token`), préservation des champs non sensibles (`grant_type`, `client_id`).

### VULN-02 : Protection contre la Fuite du Jeton Bearer sur URL Absolue Externe
- **Localisation :** [`src/client.ts`](./src/client.ts#L87-L100,L402-L444)
- **Correctif mis en place :**
  - Création de la fonction utilitaire de validation de domaine d'origine [`isSameOrigin(targetPath, baseOriginOrUrl)`](./src/client.ts#L87).
  - Comparaison canonique normalisée des propriétés `URL.origin`.
  - Dans `setupInterceptors`, vérification stricte : si la requête vise une URL absolue avec une origine différente de l'API GLPI configurée, l'injection de l'en-tête `Authorization: Bearer <token>` est désactivée et la boucle de réessai transparente sur erreur 401 est neutralisée.
- **Validation par tests :**
  - Fichier de test : [`tests/client.test.ts`](./tests/client.test.ts)
  - Cas vérifiés : Absence d'en-tête Bearer sur `https://evil-site.com/api`, injection normale conservée pour les chemins relatifs et les URLs absolues de même origine (`https://glpi.corp.com/api.php`), blocage du retry 401 sur hôte tiers.

### VULN-03 : Validation Stricte des Noms de Propriétés dans le Constructeur RSQL
- **Localisation :** [`src/rsql/builder.ts`](./src/rsql/builder.ts#L3-L11,L81-L188)
- **Correctif mis en place :**
  - Définition du filtre de validation d'identifiant `RSQL_FIELD_PATTERN = /^[a-zA-Z0-9_.-]+$/`.
  - Implémentation de la garde [`assertValidField(field)`](./src/rsql/builder.ts#L5) qui lève une exception `GlpiError` explicite en cas de tentative d'injection de caractères spéciaux (espaces, virgules, points-virgules, opérateurs logiques).
  - Intégration systématique de la garde en précondition des 14 opérateurs de `RsqlBuilder` (`eq`, `neq`, `gt`, `ge`, `lt`, `le`, `like`, `ilike`, `in`, `out`, `isNull`, `isNotNull`, `empty`, `notEmpty`).
- **Validation par tests :**
  - Fichier de test : [`tests/rsql.test.ts`](./tests/rsql.test.ts)
  - Cas vérifiés : Rejet immédiat de charges utiles contenant des injections RSQL/FIQL (`id=gt=0,name`, `field;injection`, `name==admin`), acceptation des identifiants légitimes (`id`, `user.name`, `entities_id`).

### VULN-04 : Encodage Systématique des Identifiants de Ressources (Prévention Path Traversal)
- **Localisation :**
  - [`src/resources/ResourceService.ts`](./src/resources/ResourceService.ts#L166,L217,L249)
  - [`src/resources/domain/TicketResource.ts`](./src/resources/domain/TicketResource.ts#L49,L73,L102,L141)
  - [`src/resources/domain/DocumentResource.ts`](./src/resources/domain/DocumentResource.ts#L277)
- **Correctif mis en place :**
  - Application de `encodeURIComponent(String(id))` et `encodeURIComponent(String(ticketId))` sur tous les segments d'URL interpolés lors des opérations CRUD (`get`, `update`, `delete`), des sous-ressources de tickets (`addFollowup`, `getTimeline`, `assign`, `addDocument`) et du téléchargement de documents (`download`).
  - Neutralisation des séquences de traversée de chemin relatives (`../../Admin`) qui sont transformées en composants d'URL encodés inoffensifs (`..%2F..%2FAdmin`).
- **Validation par tests :**
  - Fichiers de test : [`tests/resource.test.ts`](./tests/resource.test.ts), [`tests/domain-resources.test.ts`](./tests/domain-resources.test.ts)
  - Cas vérifiés : Vérification que les requêtes HTTP générées contiennent l'encodage correct sans dérive de chemin.

### VULN-05 : Assainissement du Nom de Fichier Issu de `Content-Disposition`
- **Localisation :** [`src/resources/domain/DocumentResource.ts`](./src/resources/domain/DocumentResource.ts#L36-L54,L71-L87)
- **Correctif mis en place :**
  - Création de la fonction exportée [`sanitizeFilename(filename)`](./src/resources/domain/DocumentResource.ts#L36).
  - Élimination des octets nuls et caractères de contrôle (`/[\x00-\x1f\x7f]/g`).
  - Suppression de tout préfixe de chemin et séparateurs de répertoires Unix/Windows (`replace(/^.*[\\/]/, '')`).
  - Suppression des points initiaux (`replace(/^\.+/, '')`) pour prévenir les fichiers cachés ou les traversées résiduelles (`..`).
  - Rejet des résultats vides ou composés uniquement de points (`.` / `..`).
  - Intégration dans [`parseContentDispositionFilename`](./src/resources/domain/DocumentResource.ts#L60) pour les formats standard et encodés RFC 5987 / RFC 6266 (`filename*=UTF-8''...`).
- **Validation par tests :**
  - Fichier de test : [`tests/domain-resources.test.ts`](./tests/domain-resources.test.ts)
  - Cas vérifiés : Nettoyage de chemins malveillants (`../../etc/shadow` $\to$ `shadow`, `..\\..\\Windows\\win.ini` $\to$ `win.ini`, `..\0evil.pdf` $\to$ `evil.pdf`), gestion robuste des noms de fichiers légitimes encodés en UTF-8.

### VULN-06 : Purge Complète des Identifiants en Mémoire après `logout()`
- **Localisation :** [`src/auth/PasswordAuthProvider.ts`](./src/auth/PasswordAuthProvider.ts#L26-L27,L56-L69)
- **Correctif mis en place :**
  - Remplacement des modificateurs `readonly` par des variables mutables pour `username` et `password`.
  - Lors de l'appel à [`logout()`](./src/auth/PasswordAuthProvider.ts#L56), purge immédiate des identifiants : `this.username = ''; this.password = '';` en complément du vidage du `TokenManager`.
  - Dans [`fetchToken()`](./src/auth/PasswordAuthProvider.ts#L63), ajout d'une garde levant une exception `GlpiAuthenticationError('NO_CREDENTIALS', ...)` si les identifiants ont été effacés.
- **Validation par tests :**
  - Fichier de test : [`tests/auth.test.ts`](./tests/auth.test.ts)
  - Cas vérifiés : Vérification que tout appel ultérieur à `getAccessToken()` après un `logout()` échoue avec `NO_CREDENTIALS` au lieu de relancer silencieusement une authentification avec des identifiants résiduels.

---

## 4. Analyse Détaillée des Vulnérabilités Résiduelles & Nouvelles Observations

---

### VULN-07 [Faible] : Absence de Support IPv6 dans les Règles CIDR de `NO_PROXY`

- **CWE :** CWE-697 (Incorrect Comparison)
- **Composant :** [`src/http/FetchHttpClient.ts:18-41`](./src/http/FetchHttpClient.ts#L18-L41)
- **CVSS v3.1 :** 3.1 (`CVSS:3.1/AV:N/AC:H/PR:N/UI:N/S:U/C:N/I:L/A:N`)

#### Mécanisme
La fonction `matchCidr` délègue à `ipToInt`, qui exige strictement 4 blocs décimaux séparés par des points (`parts.length !== 4`). Toute règle CIDR IPv6 (ex: `fe80::/10` ou `2001:db8::/32`) renvoie `false`. Les requêtes destinées à des réseaux locaux IPv6 déclarés en contournement de proxy seront donc transmises au proxy d'entreprise au lieu d'être traitées en direct.

#### Impact
Déviation inattendue de flux réseau internes IPv6 vers un proxy HTTP d'entreprise.

#### Remédiation Recommandée
Ajouter le support des adresses IPv6 (conversion en `BigInt` 128 bits) ou utiliser une expression régulière pour normaliser les adresses IPv6 lors du matching CIDR.

---

### VULN-08 [Faible] : Absence d'Avertissement sur URL Non Chiffrée (`http://`)

- **CWE :** CWE-319 (Cleartext Transmission of Sensitive Information)
- **Composant :** [`src/client.ts:128-146`](./src/client.ts#L128-L146)
- **CVSS v3.1 :** 3.7 (`CVSS:3.1/AV:N/AC:H/PR:N/UI:N/S:U/C:L/I:N/A:N`)

#### Mécanisme
Lors de l'instanciation de `GlpiClient`, si `apiUrl` commence par `http://` et que l'hôte cible n'est ni `localhost` ni `127.0.0.1`, le client transmet les identifiants OAuth2 et les jetons Bearer en clair sur le réseau sans émettre d'avertissement.

#### Remédiation Recommandée
Émettre un avertissement via `this.logger.warn(...)` dans le constructeur de `GlpiClient` si le protocole est non TLS sur un hôte distant :
```typescript
try {
  const parsed = new URL(rawApiUrl);
  if (parsed.protocol === 'http:' && parsed.hostname !== 'localhost' && parsed.hostname !== '127.0.0.1') {
    (options.logger ?? new ConsoleLogger()).warn(
      `[SECURITY WARNING] GlpiClient is configured with an unencrypted HTTP URL (${rawApiUrl}). Credentials and Bearer tokens may be exposed in transit.`
    );
  }
} catch {}
```

---

### VULN-09 [Informationnel] : Avis de Sécurité dans l'Outillage de Développement

- **CWE :** CWE-1395 (Dependency on Vulnerable Third-Party Component)
- **Composant :** [`package.json:41-46`](./package.json#L41-L46) (`devDependencies`)

#### Mécanisme
L'exécution de `npm audit` remonte 6 avis de sécurité affectant `vitest@2.1.3`, `esbuild@0.21.5` et `tinypool@0.8.4` (GHSA-82fw-gwwq-j7x9, GHSA-5gmw-xhrv-c9v3).

#### Impact Réel
**Nul en production.** Le paquet distribué sur npm (`dist/`) n'inclut aucune de ces dépendances (`dependencies: {}`). Le risque concerne uniquement les environnements de développement lors de l'exécution locale des suites de tests.

---

### VULN-10 [Faible] : Risque de Saturation Mémoire sur Téléchargement de Fichiers Volumineux sans Streaming

- **CWE :** CWE-400 (Uncontrolled Resource Consumption), CWE-770 (Allocation of Resources Without Limits or Throttling)
- **Composant :** [`src/resources/domain/DocumentResource.ts:283-302`](./src/resources/domain/DocumentResource.ts#L283-L302)
- **CVSS v3.1 :** 3.3 (`CVSS:3.1/AV:L/AC:L/PR:L/UI:N/S:U/C:N/I:N/A:L`)

#### Mécanisme
La méthode `DocumentResource.download(id)` charge l'intégralité du contenu binaire renvoyé par l'API GLPI dans un unique tampon contigu en mémoire V8 (`ArrayBuffer`) via `await response.arrayBuffer()`.  
Si un document hébergé (ex. image ISO, archive de sauvegarde, vidéo de diagnostic) dépasse la mémoire disponible ou la taille maximale allouable pour un `ArrayBuffer` dans l'environnement Node.js (généralement 2 à 4 Go), le processus Node.js subit un arrêt brutal par épuisement mémoire (*Out-Of-Memory Crash*).  
La bibliothèque ne propose pas à ce jour de méthode alternative renvoyant un flux lisible (`ReadableStream` ou `NodeJS.ReadableStream`).

#### Remédiation Recommandée
Introduire une méthode dédiée au streaming :
```typescript
async downloadStream(id: number | string, options?: RequestOptions): Promise<{
  stream: ReadableStream<Uint8Array>;
  contentType?: string;
  filename?: string;
  headers: Headers;
}>
```

---

### VULN-11 [Faible] : Persistance du Secret Client après `logout()` dans `ClientCredentialsAuthProvider`

- **CWE :** CWE-312 (Cleartext Storage of Sensitive Information)
- **Composant :** [`src/auth/ClientCredentialsAuthProvider.ts:48-50`](./src/auth/ClientCredentialsAuthProvider.ts#L48-L50)
- **CVSS v3.1 :** 2.7 (`CVSS:3.1/AV:L/AC:H/PR:L/UI:N/S:U/C:L/I:N/A:N`)

#### Mécanisme
Dans `ClientCredentialsAuthProvider.logout()` :
```typescript
async logout(): Promise<void> {
  await this.tokenManager.clearToken();
}
```
Seul le jeton actif stocké dans `TokenManager` est invalidé. Les propriétés `clientId` et `clientSecret` demeurent stockées en mémoire sur l'instance. Si un appel ultérieur à `getAccessToken()` est émis, une nouvelle requête `/token` est immédiatement envoyée pour recréer un jeton valide, contrairement au comportement de `PasswordAuthProvider` et `AuthorizationCodeAuthProvider`.

#### Remédiation Recommandée
Si le contrat applicatif attend que `logout()` termine définitivement la session de l'agent, vider également `clientSecret` ou positionner un indicateur d'état `isLoggedOut = true`.

---

### VULN-12 [Informationnel] : Risque de Lecture de Fichier Arbitraire si `filePath` Non Assaini

- **CWE :** CWE-73 (External Control of File Name or Path), CWE-200 (Exposure of Sensitive Information)
- **Composant :** [`src/resources/domain/DocumentResource.ts:202-226`](./src/resources/domain/DocumentResource.ts#L202-L226)

#### Mécanisme
Lorsque le consommateur utilise la surcharge pratique `client.documents.upload('/chemin/vers/fichier.ext')` ou passe `{ filePath: '...' }`, la bibliothèque effectue une lecture directe sur le système de fichiers hôte via `node:fs/promises.readFile(uploadFile.filePath)`.  
Si l'application intégratrice reçoit un chemin de fichier depuis une entrée utilisateur non validée (ex. un paramètre d'API REST sans liste blanche), un attaquant pourrait téléverser des fichiers locaux sensibles (`/etc/passwd`, variables d'environnement, clés privées) sur l'instance GLPI.

#### Recommandation pour les Développeurs Intégrateurs
Documenter clairement dans le README / JSDoc que `upload(filePath)` ne doit jamais recevoir un chemin contrôlé par un utilisateur sans validation préalable par rapport à un répertoire restreint autorisé (*whitelist directory traversal check*).

---

## 5. Matrice de Couverture OWASP API Security Top 10 (2023)

| Identifiant OWASP | Catégorie de Risque | Statut `glpi-api` | Commentaire |
| :--- | :--- | :---: | :--- |
| **API1:2023** | Broken Object Level Authorization (BOLA) | **N/A (Côté Client)** | Contrôle assuré par le backend GLPI. Le client applique un encodage strict des identifiants (VULN-04). |
| **API2:2023** | Broken Authentication | **Conforme** | Renouvellement transparent sans concurrence (mutex single-flight), gestion des flux OAuth2 standards, purge mémoire au `logout` (VULN-06). |
| **API3:2023** | Broken Object Property Level Authorization | **Conforme** | Typage strict TypeScript sur les payloads et modèles de domaine. |
| **API4:2023** | Unrestricted Resource Consumption | **Partiel** | Timeouts configurables par requête et globaux. Point d'amélioration sur le streaming de téléchargement (VULN-10). |
| **API5:2023** | Broken Function Level Authorization | **N/A (Côté Client)** | Contrôle géré par les profils/droits du serveur GLPI. Scoping par en-têtes `GLPI-Profile` et `GLPI-Entity` supporté. |
| **API6:2023** | Unrestricted Access to Sensitive Business Flows | **Conforme** | Gestion du rate limiting HTTP 429 avec prise en compte de l'en-tête `Retry-After` ([`GlpiRateLimitError`](./src/errors/index.ts#L67)). |
| **API7:2023** | Server Side Request Forgery (SSRF) | **Conforme** | Same-Origin check strict sur l'injection Bearer (VULN-02). |
| **API8:2023** | Security Misconfiguration | **Conforme** | Masquage des en-têtes et corps d'erreur sensibles (VULN-01). Pas de dépendances tierces vulnérables en production. |
| **API9:2023** | Improper Inventory Management | **Conforme** | Support unifié des endpoints REST `/v2` et `/GraphQL`. |
| **API10:2023** | Unsafe Consumption of APIs | **Conforme** | Assainissement des en-têtes `Content-Disposition` (VULN-05), validation des réponses JSON et des identifiants RSQL (VULN-03). |

---

## 6. Conclusion & Recommandations

La bibliothèque `glpi-api` v2.0.0 présente désormais un **niveau de sécurité remarquable** pour une bibliothèque d'intégration d'API :
- Les vulnérabilités antérieures d'exposition d'identifiants (VULN-01), de fuite de jeton (VULN-02), d'injection RSQL (VULN-03) et de traversée de chemin (VULN-04, VULN-05, VULN-06) ont toutes été traitées de manière rigoureuse et validées par **149 tests unitaires passants**.
- Les quelques observations restantes (VULN-07 à VULN-12) sont de sévérité faible ou informationnelle et n'affectent pas l'intégrité globale du système dans des conditions normales d'exploitation.

### Plan d'Action Proposé pour les Versions Futures :
1. **v2.1.0 :** Implémenter `client.documents.downloadStream(id)` pour permettre la consommation de fichiers volumineux sans surconsommation mémoire (VULN-10).
2. **v2.1.0 :** Ajouter un avertissement dans la console si l'API est ciblée en HTTP clair sur un domaine non local (VULN-08).
3. **v2.1.0 :** Étendre `matchCidr` au parsing des adresses IPv6 pour le contournement de proxy (VULN-07).
4. **Maintenance :** Mettre à jour les outils de dev (`vitest`, `vite`) dès que les correctifs amont seront publiés dans une version majeure compatible (VULN-09).
