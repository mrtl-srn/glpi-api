import type { IHttpClient } from '../../http/types.js';
import { ResourceService } from '../ResourceService.js';
import type { RouteRegistry } from '../RouteRegistry.js';
import type { CreateResult, RequestOptions } from '../types.js';
import type {
  GlpiTicket,
  TicketActorType,
  TicketTimelineItem,
} from '../../types/models.js';

/**
 * Specialized resource service for GLPI Tickets (/Assistance/Ticket).
 * Provides domain helper methods for managing followups, timelines, and actor assignments.
 */
export class TicketResource extends ResourceService<GlpiTicket> {
  /**
   * Initializes a new TicketResource instance.
   *
   * @param http The HTTP client to use for network transport.
   * @param endpoint The route path or registered alias (defaults to 'Assistance/Ticket').
   * @param registry Optional RouteRegistry for custom alias resolution.
   */
  constructor(
    http: IHttpClient,
    endpoint: string = 'Assistance/Ticket',
    registry?: RouteRegistry
  ) {
    super(http, endpoint, registry);
  }

  /**
   * Adds a new followup note to an existing ticket.
   *
   * @param ticketId The ID of the ticket.
   * @param content Plain text message string or a full followup payload object.
   * @param options Optional request options including entity/profile scoping.
   * @returns Creation result containing the new followup ID and URL.
   */
  async addFollowup(
    ticketId: number | string,
    content: string | Record<string, unknown>,
    options?: RequestOptions
  ): Promise<CreateResult> {
    const body = typeof content === 'string' ? { content } : content;
    const headers = this.buildHeaders(options);

    const response = await this.http.request<CreateResult>({
      method: 'POST',
      path: `${this.basePath}/${encodeURIComponent(String(ticketId))}/Timeline/Followup`,
      body,
      headers,
      signal: options?.signal,
    });

    return response.data;
  }

  /**
   * Retrieves the complete timeline for a ticket, including followups, tasks, solutions, and validations.
   *
   * @param ticketId The ID of the ticket.
   * @param options Optional request options including entity/profile scoping.
   * @returns Array of timeline items.
   */
  async getTimeline(
    ticketId: number | string,
    options?: RequestOptions
  ): Promise<TicketTimelineItem[]> {
    const headers = this.buildHeaders(options);

    const response = await this.http.request<TicketTimelineItem[]>({
      method: 'GET',
      path: `${this.basePath}/${encodeURIComponent(String(ticketId))}/Timeline`,
      headers,
      signal: options?.signal,
    });

    return Array.isArray(response.data) ? response.data : [];
  }

  /**
   * Assigns an actor (user, group, or supplier) to a ticket.
   *
   * @param ticketId The ID of the ticket.
   * @param actorId The identifier of the user, group, or supplier.
   * @param type The type of the actor: 'user', 'group', or 'supplier' (defaults to 'user').
   * @param options Optional request options including entity/profile scoping.
   * @returns Creation result containing the new actor assignment ID and URL.
   */
  async assign(
    ticketId: number | string,
    actorId: number | string,
    type: TicketActorType = 'user',
    options?: RequestOptions
  ): Promise<CreateResult> {
    const headers = this.buildHeaders(options);
    const capitalizedType =
      type.charAt(0).toUpperCase() + type.slice(1).toLowerCase();

    const response = await this.http.request<CreateResult>({
      method: 'POST',
      path: `${this.basePath}/${encodeURIComponent(String(ticketId))}/TeamMember`,
      body: {
        id: Number(actorId),
        type: capitalizedType,
        role: 'assigned',
      },
      headers,
      signal: options?.signal,
    });

    return response.data;
  }

  /**
   * Associates or links a document to a ticket timeline.
   *
   * @param ticket Ticket ID or ticket resource object.
   * @param document Document ID or document resource object.
   * @param options Optional request options including entity/profile scoping.
   * @returns Creation result containing the new timeline item ID and URL.
   */
  async addDocument(
    ticket: number | string | { id: number | string; [key: string]: unknown },
    document: number | string | { id: number | string; [key: string]: unknown },
    options?: RequestOptions
  ): Promise<CreateResult> {
    const ticketId =
      typeof ticket === 'object' && ticket !== null ? ticket.id : ticket;
    const documentId =
      typeof document === 'object' && document !== null ? document.id : document;

    const docId = Number.isNaN(Number(documentId))
      ? documentId
      : Number(documentId);

    const headers = this.buildHeaders(options);

    const response = await this.http.request<CreateResult>({
      method: 'POST',
      path: `${this.basePath}/${encodeURIComponent(String(ticketId))}/Timeline/Document`,
      body: {
        id: docId,
        documents_id: docId,
      },
      headers,
      signal: options?.signal,
    });

    return response.data;
  }
}

