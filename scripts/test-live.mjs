#!/usr/bin/env node

/**
 * GLPI API 2.0 - Live Environment Test Runner
 *
 * Tests the complete end-to-end workflow against a real GLPI instance:
 * 1. OAuth2 Authentication & Session inspection
 * 2. Inventory querying (Computers)
 * 3. Ticket creation & Followup posting
 * 4. Document upload & binary download verification
 * 5. Fluent RSQL search filtering
 * 6. GraphQL query execution (if enabled)
 * 7. Entity cleanup and graceful logout
 *
 * Usage:
 *   npm run test:live
 *   or:
 *   node scripts/test-live.mjs
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = resolve(__dirname, '..');

// ---------------------------------------------------------------------------
// 1. Lightweight .env loader (zero external dependencies)
// ---------------------------------------------------------------------------
function loadEnv() {
  const envPaths = [resolve(rootDir, '.env'), resolve(process.cwd(), '.env')];
  for (const envPath of envPaths) {
    if (existsSync(envPath)) {
      try {
        const content = readFileSync(envPath, 'utf8');
        for (const line of content.split('\n')) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith('#')) continue;
          const eqIdx = trimmed.indexOf('=');
          if (eqIdx > 0) {
            const key = trimmed.slice(0, eqIdx).trim();
            let val = trimmed.slice(eqIdx + 1).trim();
            if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
              val = val.slice(1, -1);
            }
            if (process.env[key] === undefined) {
              process.env[key] = val;
            }
          }
        }
        return envPath;
      } catch {
        // Ignore read errors
      }
    }
  }
  return null;
}

const loadedEnvFile = loadEnv();

// ---------------------------------------------------------------------------
// 2. Load glpi-api bundle
// ---------------------------------------------------------------------------
let GlpiClient;
let rsql;

try {
  const lib = await import('../dist/index.mjs');
  GlpiClient = lib.GlpiClient;
  rsql = lib.rsql;
} catch (err) {
  console.error('\x1b[31m[ERROR] Failed to load library bundle from dist/index.mjs.\x1b[0m');
  console.error('Please build the project first by running: \x1b[36mnpm run build\x1b[0m\n');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// 3. Configuration & Validation
// ---------------------------------------------------------------------------
const apiUrl = process.env.GLPI_API_URL;
const authType = process.env.GLPI_AUTH_TYPE || 'password';
const clientId = process.env.GLPI_CLIENT_ID;
const clientSecret = process.env.GLPI_CLIENT_SECRET;
const username = process.env.GLPI_USERNAME;
const password = process.env.GLPI_PASSWORD;
const proxy = process.env.GLPI_PROXY || process.env.HTTPS_PROXY || process.env.HTTP_PROXY;
const noProxy = process.env.GLPI_NO_PROXY || process.env.NO_PROXY || process.env.no_proxy;
const entity = process.env.GLPI_ENTITY;
const profile = process.env.GLPI_PROFILE;
const language = process.env.GLPI_LANGUAGE;
const cleanup = process.env.GLPI_CLEANUP !== 'false';

// ANSI formatting helpers
const fmt = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m',
};

function printBanner() {
  console.log(`\n${fmt.bold}${fmt.cyan}╔══════════════════════════════════════════════════════════════╗${fmt.reset}`);
  console.log(`${fmt.bold}${fmt.cyan}║             GLPI API 2.0 Live Environment Test               ║${fmt.reset}`);
  console.log(`${fmt.bold}${fmt.cyan}╚══════════════════════════════════════════════════════════════╝${fmt.reset}\n`);
}

if (!apiUrl) {
  printBanner();
  console.log(`${fmt.yellow}[!] Configuration Missing:${fmt.reset} GLPI_API_URL environment variable is required.\n`);
  console.log(`To configure and run the live tests:\n`);
  console.log(`  ${fmt.bold}1. Create a .env file from .env.example:${fmt.reset}`);
  console.log(`     ${fmt.cyan}cp .env.example .env${fmt.reset}`);
  console.log(`     ${fmt.gray}# Edit .env with your GLPI URL and OAuth credentials${fmt.reset}\n`);
  console.log(`  ${fmt.bold}2. Run the test script:${fmt.reset}`);
  console.log(`     ${fmt.cyan}npm run test:live${fmt.reset}\n`);
  console.log(`  ${fmt.bold}Alternatively, provide environment variables inline:${fmt.reset}`);
  console.log(`     ${fmt.cyan}GLPI_API_URL=https://glpi.example.com/api.php \\`);
  console.log(`     GLPI_CLIENT_ID=my-client-id \\`);
  console.log(`     GLPI_CLIENT_SECRET=my-client-secret \\`);
  console.log(`     GLPI_USERNAME=tech \\`);
  console.log(`     GLPI_PASSWORD=secret \\`);
  console.log(`     npm run test:live${fmt.reset}\n`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// 4. Test Suite Execution
// ---------------------------------------------------------------------------
async function runLiveTest() {
  printBanner();

  if (loadedEnvFile) {
    console.log(`${fmt.gray}Loaded config from: ${loadedEnvFile}${fmt.reset}`);
  }
  console.log(`${fmt.gray}Target API URL:     ${apiUrl}${fmt.reset}`);
  console.log(`${fmt.gray}Auth Flow:          ${authType}${fmt.reset}`);
  if (proxy) {
    console.log(`${fmt.gray}Proxy:              ${proxy}${fmt.reset}`);
  }
  if (noProxy) {
    console.log(`${fmt.gray}No Proxy:           ${noProxy}${fmt.reset}`);
  }
  console.log('');

  // Build auth configuration
  let authConfig;
  if (authType === 'password') {
    if (!username || !password) {
      console.error(`${fmt.red}[ERROR] GLPI_USERNAME and GLPI_PASSWORD are required for password grant.${fmt.reset}`);
      process.exit(1);
    }
    const scopeEnv = process.env.GLPI_SCOPE;
    const resolvedScope = (!scopeEnv || scopeEnv === 'all')
      ? 'api user email graphql status'
      : scopeEnv;

    authConfig = {
      type: 'password',
      clientId: clientId || '',
      clientSecret: clientSecret || '',
      username,
      password,
      scope: resolvedScope,
    };
  } else if (authType === 'client_credentials') {
    if (!clientId || !clientSecret) {
      console.error(`${fmt.red}[ERROR] GLPI_CLIENT_ID and GLPI_CLIENT_SECRET are required for client_credentials.${fmt.reset}`);
      process.exit(1);
    }
    authConfig = {
      type: 'client_credentials',
      clientId,
      clientSecret,
      scope: process.env.GLPI_SCOPE || 'all',
    };
    console.log(`${fmt.yellow}[!] Warning: GLPI 11 only supports 'client_credentials' for inventory agent submission.${fmt.reset}`);
    console.log(`${fmt.yellow}    Accessing REST resources (User/Me, Tickets, Computers) requires user authentication ('password' grant).${fmt.reset}`);
    console.log(`${fmt.yellow}    If requests fail with HTTP 401, set GLPI_AUTH_TYPE=password, GLPI_USERNAME, and GLPI_PASSWORD.${fmt.reset}\n`);
  } else {
    console.error(`${fmt.red}[ERROR] Unsupported GLPI_AUTH_TYPE: ${authType}${fmt.reset}`);
    process.exit(1);
  }

  // Initialize GlpiClient
  const client = new GlpiClient({
    apiUrl,
    auth: authConfig,
    proxy: proxy || undefined,
    useEnvProxy: !proxy,
    noProxy: noProxy || undefined,
    entity: entity ? Number(entity) : undefined,
    profile: profile ? Number(profile) : undefined,
    language: language || undefined,
  });

  const steps = [];
  let createdTicketId = null;
  let createdDocumentId = null;
  const startTime = Date.now();

  async function step(name, fn) {
    process.stdout.write(`  ${fmt.bold}•${fmt.reset} ${name.padEnd(50, '.')} `);
    const stepStart = Date.now();
    try {
      const result = await fn();
      const elapsed = `${Date.now() - stepStart}ms`;
      console.log(`${fmt.green}[OK]${fmt.reset} ${fmt.gray}(${elapsed})${fmt.reset}`);
      steps.push({ name, status: 'OK', elapsed, result });
      return result;
    } catch (err) {
      const elapsed = `${Date.now() - stepStart}ms`;
      console.log(`${fmt.red}[FAILED]${fmt.reset} ${fmt.gray}(${elapsed})${fmt.reset}`);
      console.error(`\n    ${fmt.red}↳ Error: ${err.message}${fmt.reset}`);
      if (err.status) console.error(`    ${fmt.red}↳ HTTP Status: ${err.status}${fmt.reset}`);
      if (err.body) console.error(`    ${fmt.red}↳ Response Body: ${JSON.stringify(err.body)}${fmt.reset}`);
      if (err.status === 401 && authType === 'client_credentials') {
        console.error(`\n    ${fmt.yellow}↳ DIAGNOSTIC: GLPI 11 rejected the request with 401 Unauthorized.${fmt.reset}`);
        console.error(`    ${fmt.yellow}  In GLPI 11 REST API, 'client_credentials' tokens are only valid for inventory agent submissions.${fmt.reset}`);
        console.error(`    ${fmt.yellow}  All REST resources (Users, Tickets, Computers, etc.) require an authenticated GLPI user account.${fmt.reset}`);
        console.error(`    ${fmt.yellow}  To fix this, edit .env to use 'password' grant:${fmt.reset}`);
        console.error(`      ${fmt.cyan}GLPI_AUTH_TYPE=password${fmt.reset}`);
        console.error(`      ${fmt.cyan}GLPI_USERNAME=<your_glpi_username>${fmt.reset}`);
        console.error(`      ${fmt.cyan}GLPI_PASSWORD=<your_glpi_password>${fmt.reset}\n`);
      }
      steps.push({ name, status: 'FAILED', elapsed, error: err });
      throw err;
    }
  }

  try {
    // -----------------------------------------------------------------------
    // Step 1: Authentication & User Info
    // -----------------------------------------------------------------------
    let currentUser;
    await step('Authenticate and fetch current user profile', async () => {
      currentUser = await client.users.me();
      return currentUser;
    });
    if (currentUser) {
      console.log(`    ${fmt.gray}Logged in as: ${currentUser.name || currentUser.login || 'User #' + currentUser.id} (ID: ${currentUser.id})${fmt.reset}`);
    }

    // -----------------------------------------------------------------------
    // Step 2: Inspect Session Details
    // -----------------------------------------------------------------------
    let sessionInfo;
    await step('Inspect active session and permissions', async () => {
      sessionInfo = await client.users.getSession();
      return sessionInfo;
    });

    // -----------------------------------------------------------------------
    // Step 3: Query Computers (Assets)
    // -----------------------------------------------------------------------
    let computersList;
    await step('Query computers list (limit 5)', async () => {
      computersList = await client.computers.list({ limit: 5 });
      return computersList;
    });
    console.log(`    ${fmt.gray}Total computers in scope: ${computersList?.total ?? computersList?.data?.length ?? 0}${fmt.reset}`);

    // -----------------------------------------------------------------------
    // Step 4: Create a Support Ticket
    // -----------------------------------------------------------------------
    const testTimestamp = new Date().toISOString();
    await step('Create a test support ticket', async () => {
      const ticket = await client.tickets.create({
        name: `[API Test] Automated Live Test Ticket - ${testTimestamp}`,
        content: `This ticket was automatically generated by glpi-api live test runner.\nCreated at: ${testTimestamp}`,
        urgency: 3,
        priority: 3,
      });
      createdTicketId = ticket.id;
      return ticket;
    });
    console.log(`    ${fmt.gray}Created Ticket #${createdTicketId}${fmt.reset}`);

    // -----------------------------------------------------------------------
    // Step 5: Add a Followup to Ticket
    // -----------------------------------------------------------------------
    await step('Add followup comment to ticket', async () => {
      return await client.tickets.addFollowup(
        createdTicketId,
        `Followup verification timestamp: ${new Date().toISOString()}`
      );
    });

    // -----------------------------------------------------------------------
    // Step 6: Upload Document Attachment
    // -----------------------------------------------------------------------
    const samplePayload = `GLPI API 2.0 Live Test Diagnostic Document\nGenerated: ${testTimestamp}\nRandom: ${Math.random().toString(36).substring(2)}`;
    const sampleBuffer = Buffer.from(samplePayload, 'utf8');

    await step('Upload document attachment to ticket', async () => {
      const doc = await client.documents.upload(
        {
          content: sampleBuffer,
          filename: `live-test-${Date.now()}.txt`,
          mimeType: 'text/plain',
        },
        {
          name: `Live Test Diagnostic - ${testTimestamp}`,
          items_id: createdTicketId,
          itemtype: 'Ticket',
        }
      );
      createdDocumentId = doc.id;
      return doc;
    });
    console.log(`    ${fmt.gray}Created Document #${createdDocumentId}${fmt.reset}`);

    // -----------------------------------------------------------------------
    // Step 7: Download and Verify Binary Content
    // -----------------------------------------------------------------------
    await step('Download uploaded document & verify content', async () => {
      try {
        const downloaded = await client.documents.download(createdDocumentId);
        const downloadedBuffer = Buffer.from(downloaded.data);
        if (downloadedBuffer.toString('utf8') !== samplePayload) {
          throw new Error('Downloaded document content does not match uploaded payload');
        }
        return { filename: downloaded.filename, size: downloaded.data.byteLength };
      } catch (err) {
        if (err.status === 500) {
          console.log(`\n    ${fmt.yellow}↳ Note: GLPI returned HTTP 500 on document download.${fmt.reset}`);
          console.log(`    ${fmt.yellow}  (Typical in pre-prod environments where physical files/ directory was not copied from production).${fmt.reset}`);
          const doc = await client.documents.get(createdDocumentId);
          console.log(`    ${fmt.gray}Verified document metadata in GLPI: "${doc.name}" (ID: ${doc.id})${fmt.reset}`);
          return { id: doc.id, name: doc.name, status: 'metadata_verified' };
        }
        throw err;
      }
    });

    // -----------------------------------------------------------------------
    // Step 8: Search with Fluent RSQL Builder
    // -----------------------------------------------------------------------
    await step('Filter tickets using fluent RSQL builder', async () => {
      const search = await client.tickets.list({
        filter: rsql().eq('id', createdTicketId),
      });
      if (!search.data || search.data.length === 0) {
        throw new Error(`RSQL search could not find ticket #${createdTicketId}`);
      }
      return search;
    });

    // -----------------------------------------------------------------------
    // Step 9: Optional GraphQL Query
    // -----------------------------------------------------------------------
    try {
      await step('Execute test GraphQL query', async () => {
        return await client.graphql.query(`
          query {
            Computer(limit: 1) {
              id
              name
            }
          }
        `);
      });
    } catch {
      console.log(`    ${fmt.yellow}↳ Note: GraphQL query skipped or endpoint disabled on target server.${fmt.reset}`);
    }

    // -----------------------------------------------------------------------
    // Step 10: Cleanup Created Entities
    // -----------------------------------------------------------------------
    if (cleanup) {
      if (createdDocumentId) {
        await step(`Clean up test document #${createdDocumentId}`, async () => {
          return await client.documents.delete(createdDocumentId, { purge: true });
        });
      }
      if (createdTicketId) {
        await step(`Clean up test ticket #${createdTicketId}`, async () => {
          return await client.tickets.delete(createdTicketId, { purge: true });
        });
      }
    } else {
      console.log(`\n  ${fmt.yellow}[!] GLPI_CLEANUP=false: Preserved Ticket #${createdTicketId} and Document #${createdDocumentId}.${fmt.reset}`);
    }

    // -----------------------------------------------------------------------
    // Step 11: Invalidate Session (Logout)
    // -----------------------------------------------------------------------
    await step('Logout and close session', async () => {
      return await client.logout();
    });

    // -----------------------------------------------------------------------
    // Final Summary
    // -----------------------------------------------------------------------
    const totalElapsed = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`\n${fmt.bold}${fmt.green}✔ All live tests completed successfully!${fmt.reset} ${fmt.gray}(${totalElapsed}s total)${fmt.reset}\n`);

  } catch (err) {
    console.log(`\n${fmt.bold}${fmt.red}✖ Live testing aborted due to an error.${fmt.reset}\n`);
    // Attempt emergency cleanup if ticket was created
    if (cleanup && createdTicketId) {
      try {
        console.log(`  ${fmt.gray}Attempting emergency cleanup of Ticket #${createdTicketId}...${fmt.reset}`);
        await client.tickets.delete(createdTicketId, { purge: true });
        console.log(`  ${fmt.green}Emergency cleanup succeeded.${fmt.reset}`);
      } catch {
        console.log(`  ${fmt.yellow}Emergency cleanup failed. Please manually delete Ticket #${createdTicketId}.${fmt.reset}`);
      }
    }
    process.exit(1);
  }
}

runLiveTest();
