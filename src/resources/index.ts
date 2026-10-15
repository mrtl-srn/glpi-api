export { RouteRegistry, DEFAULT_CORE_ROUTES } from './RouteRegistry.js';
export { ResourceService } from './ResourceService.js';
export { TicketResource } from './domain/TicketResource.js';
export { ComputerResource } from './domain/ComputerResource.js';
export { UserResource } from './domain/UserResource.js';
export { DocumentResource } from './domain/DocumentResource.js';
export type {
  RequestOptions,
  ListParams,
  PaginatedResult,
  CreateOptions,
  CreateResult,
  UpdateOptions,
  DeleteOptions,
  IResourceService,
} from './types.js';
export type {
  GlpiTicket,
  GlpiComputer,
  GlpiUser,
  GlpiDocument,
  GlpiSessionInfo,
  TicketTimelineItem,
  DocumentUploadFile,
  DocumentMetadata,
  DocumentDownloadResult,
  TicketActorType,
  TicketActorRole,
  PriorityLevel,
} from '../types/models.js';
export { TicketStatus, TicketType } from '../types/models.js';
