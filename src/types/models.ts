/**
 * Strongly typed models for GLPI High-Level REST API domain entities.
 */

/**
 * GLPI Ticket status values according to GLPI specification.
 */
export enum TicketStatus {
  NEW = 1,
  PROCESSING_ASSIGNED = 2,
  PROCESSING_PLANNED = 3,
  PENDING = 4,
  SOLVED = 5,
  CLOSED = 6,
  WAITING_VALIDATION = 10,
}

/**
 * Detailed ticket status object returned by GLPI REST API.
 */
export interface TicketStatusInfo {
  id: TicketStatus | number;
  name?: string;
  [key: string]: unknown;
}

/**
 * Generic item reference object returned by GLPI REST API for dropdowns and linked entities.
 */
export interface GlpiItemReference {
  id: number;
  name?: string;
  [key: string]: unknown;
}

/**
 * Entity reference object returned by GLPI REST API.
 */
export interface GlpiEntityReference extends GlpiItemReference {
  completename?: string;
}

/**
 * GLPI Ticket type values.
 */
export enum TicketType {
  INCIDENT = 1,
  REQUEST = 2,
}

/**
 * Ticket urgency / impact / priority levels (1: Very low, 2: Low, 3: Medium, 4: High, 5: Very high).
 */
export type PriorityLevel = 1 | 2 | 3 | 4 | 5 | number;

/**
 * Actor types that can be assigned or linked to a ticket.
 */
export type TicketActorType = 'user' | 'group' | 'supplier' | 'User' | 'Group' | 'Supplier';

/**
 * Actor roles within a ticket.
 */
export type TicketActorRole = 'requester' | 'assigned' | 'observer';

/**
 * Ticket entity model matching GLPI Assistance/Ticket representation.
 */
export interface GlpiTicket {
  id: number;
  name?: string;
  content?: string;
  status?: TicketStatusInfo;
  urgency?: PriorityLevel;
  impact?: PriorityLevel;
  priority?: PriorityLevel;
  type?: TicketType | number;
  user_recipient?: GlpiItemReference;
  user_editor?: GlpiItemReference;
  category?: GlpiItemReference;
  location?: GlpiItemReference;
  entity?: GlpiEntityReference;
  is_deleted?: boolean | number;
  date_creation?: string;
  date_mod?: string;
  date?: string;
  date_solve?: string;
  date_close?: string;
  sla_ttr?: GlpiItemReference | number;
  sla_tto?: GlpiItemReference | number;
  ola_ttr?: GlpiItemReference | number;
  ola_tto?: GlpiItemReference | number;
  actiontime?: number;
  waiting_duration?: number;
  close_duration?: number;
  team?: Array<{
    id: number;
    type: string;
    role: string;
    [key: string]: unknown;
  }>;
  costs?: unknown[];
  [key: string]: unknown;
}

/**
 * Computer entity model matching GLPI Assets/Computer representation.
 */
export interface GlpiComputer {
  id: number;
  name?: string;
  comment?: string;
  status?: GlpiItemReference;
  entity?: GlpiEntityReference;
  is_recursive?: boolean | number;
  manufacturer?: GlpiItemReference;
  user?: GlpiItemReference;
  user_tech?: GlpiItemReference;
  contact?: string;
  contact_num?: string;
  serial?: string;
  otherserial?: string;
  is_deleted?: boolean | number;
  date_creation?: string;
  date_mod?: string;
  location?: GlpiItemReference;
  type?: GlpiItemReference;
  model?: GlpiItemReference;
  group?: GlpiItemReference;
  group_tech?: GlpiItemReference;
  uuid?: string;
  network?: GlpiItemReference;
  autoupdatesystem?: GlpiItemReference;
  is_template?: boolean | number;
  template_name?: string;
  is_dynamic?: boolean | number;
  ticket_tco?: number | string;
  last_inventory_update?: string;
  last_boot?: string;
  [key: string]: unknown;
}

/**
 * User entity model matching GLPI Administration/User representation.
 */
export interface GlpiUser {
  id: number;
  username?: string;
  realname?: string;
  firstname?: string;
  name?: string;
  phone?: string;
  phone2?: string;
  mobile?: string;
  emails?: Array<{ id: number; email: string; is_default?: boolean; [key: string]: unknown }> | string;
  comment?: string;
  is_active?: boolean | number;
  is_deleted?: boolean | number;
  picture?: string;
  date_password_change?: string;
  location?: GlpiItemReference;
  authtype?: number;
  last_login?: string;
  default_profile?: GlpiItemReference;
  default_entity?: GlpiEntityReference;
  date_creation?: string;
  date_mod?: string;
  date_sync?: string;
  title?: GlpiItemReference;
  category?: GlpiItemReference;
  registration_number?: string;
  begin_date?: string;
  end_date?: string;
  nickname?: string;
  [key: string]: unknown;
}

/**
 * Document entity model matching GLPI Management/Document representation.
 */
export interface GlpiDocument {
  id: number;
  name?: string;
  comment?: string;
  entity?: GlpiEntityReference;
  filename?: string;
  filepath?: string;
  download_url?: string;
  mime?: string;
  sha1sum?: string;
  checksum_sha1?: string;
  category?: GlpiItemReference;
  link?: string;
  user?: GlpiItemReference;
  is_deleted?: boolean | number;
  is_import_denied?: boolean | number;
  tag?: string;
  date_creation?: string;
  date_mod?: string;
  [key: string]: unknown;
}

/**
 * GLPI session information returned by GET /session.
 */
export interface GlpiSessionInfo {
  glpiactiveprofile?: {
    id: number;
    name?: string;
    [key: string]: unknown;
  };
  glpi_plugins?: unknown[];
  active_profile?: {
    id: number;
    name?: string;
    interface?: string;
    rights?: Record<string, number>;
    [key: string]: unknown;
  };
  active_entity?: {
    id: number;
    short_name?: string;
    complete_name?: string;
    recursive?: number | boolean;
    [key: string]: unknown;
  };
  user_id?: number;
  name?: string;
  friendly_name?: string;
  real_name?: string;
  first_name?: string;
  default_entity?: number;
  profiles?: unknown[];
  active_entities?: unknown[];
  groups?: number[];
  current_time?: string;
  use_mode?: number;
  [key: string]: unknown;
}

/**
 * Timeline item structure for ticket interactions (followups, tasks, solutions, validations, documents).
 */
export interface TicketTimelineItem {
  id: number | string;
  type?: string;
  itemtype?: string;
  date?: string;
  date_mod?: string;
  date_creation?: string;
  users_id?: number;
  content?: string;
  source?: string;
  is_private?: number | boolean;
  [key: string]: unknown;
}

/**
 * Input descriptor for uploading documents to GLPI.
 */
export interface DocumentUploadFile {
  /**
   * The binary content or readable stream of the file.
   */
  content:
    | Buffer
    | Uint8Array
    | ArrayBuffer
    | Blob
    | string
    | NodeJS.ReadableStream
    | ReadableStream<Uint8Array>
    | AsyncIterable<Uint8Array | Buffer | string>;

  /**
   * File name with extension (e.g. 'report.pdf').
   */
  filename?: string;

  /**
   * MIME type of the file (e.g. 'application/pdf', 'text/plain').
   */
  mimeType?: string;
}

/**
 * Metadata associated with an uploaded document.
 */
export interface DocumentMetadata {
  /**
   * Human-readable document name.
   */
  name?: string;

  /**
   * Description or comment for the document.
   */
  comment?: string;

  /**
   * Desired filename on GLPI storage.
   */
  filename?: string;

  /**
   * Target MIME type.
   */
  mime?: string;

  /**
   * Target entity ID for the document.
   */
  entities_id?: number;

  /**
   * Whether the document is visible recursively in child entities.
   */
  is_recursive?: boolean | number;

  /**
   * Arbitrary JSON manifest payload.
   */
  uploadManifest?: Record<string, unknown>;

  [key: string]: unknown;
}

/**
 * Result returned from downloading a document binary.
 */
export interface DocumentDownloadResult {
  /**
   * Binary contents of the downloaded file as ArrayBuffer.
   */
  data: ArrayBuffer;

  /**
   * MIME content type extracted from response headers.
   */
  contentType?: string;

  /**
   * File name extracted from the Content-Disposition header.
   */
  filename?: string;

  /**
   * Raw response headers.
   */
  headers?: Headers | Record<string, string>;
}
