import { GlpiError } from '../../errors/index.js';
import type { IHttpClient } from '../../http/types.js';
import { ResourceService } from '../ResourceService.js';
import type { RouteRegistry } from '../RouteRegistry.js';
import type { CreateResult, RequestOptions } from '../types.js';
import type {
  DocumentDownloadResult,
  DocumentMetadata,
  DocumentUploadFile,
  GlpiDocument,
} from '../../types/models.js';

/**
 * Extracts a header value by name case-insensitively from Headers or Record<string, string>.
 */
function getHeaderValue(
  headers: Headers | Record<string, string> | undefined,
  name: string
): string | undefined {
  if (!headers) return undefined;
  if (typeof (headers as Headers).get === 'function') {
    return (headers as Headers).get(name) ?? undefined;
  }
  const target = name.toLowerCase();
  for (const [key, val] of Object.entries(headers)) {
    if (key.toLowerCase() === target && typeof val === 'string') {
      return val;
    }
  }
  return undefined;
}

/**
 * Parses the filename parameter from a Content-Disposition header value,
 * supporting both RFC 5987 / RFC 6266 (filename*=UTF-8''...) and standard syntax.
 */
function parseContentDispositionFilename(headerValue?: string): string | undefined {
  if (!headerValue) return undefined;

  // RFC 5987 / RFC 6266: filename*=charset'lang'encoded_value
  const rfc5987Match = headerValue.match(/filename\*\s*=\s*(?:[A-Za-z0-9_-]+)'[A-Za-z0-9_-]*'([^;]+)/i);
  if (rfc5987Match?.[1]) {
    try {
      let val = rfc5987Match[1].trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      return decodeURIComponent(val);
    } catch {
      return rfc5987Match[1].trim();
    }
  }

  // Quoted filename: filename="abc.xyz"
  const quotedMatch = headerValue.match(/filename\s*=\s*"([^"]+)"/i);
  if (quotedMatch?.[1]) {
    return quotedMatch[1];
  }

  // Unquoted filename: filename=abc.xyz
  const unquotedMatch = headerValue.match(/filename\s*=\s*([^;\s]+)/i);
  if (unquotedMatch?.[1]) {
    return unquotedMatch[1];
  }

  return undefined;
}

/**
 * Converts various content representations (Buffer, Uint8Array, Blob, string, Stream) into a standard Blob.
 */
async function toBlob(file: DocumentUploadFile): Promise<Blob> {
  const content = file.content;
  const mimeType = file.mimeType || 'application/octet-stream';

  if (typeof Blob !== 'undefined' && content instanceof Blob) {
    return content;
  }

  if (
    content &&
    (typeof (content as any)[Symbol.asyncIterator] === 'function' ||
      typeof (content as any).pipe === 'function')
  ) {
    const chunks: BlobPart[] = [];
    for await (const chunk of content as AsyncIterable<Uint8Array | string | Buffer>) {
      if (typeof chunk === 'string') {
        chunks.push(new TextEncoder().encode(chunk) as unknown as BlobPart);
      } else if (chunk instanceof Uint8Array) {
        chunks.push(chunk as unknown as BlobPart);
      } else {
        chunks.push(chunk as unknown as BlobPart);
      }
    }
    return new Blob(chunks, { type: mimeType });
  }

  if (typeof content === 'string') {
    return new Blob([content], { type: file.mimeType || 'text/plain' });
  }

  return new Blob([content as unknown as BlobPart], { type: mimeType });
}

/**
 * Specialized resource service for GLPI Documents (/Management/Document).
 * Provides multi-type file upload via FormData and binary document downloading with metadata extraction.
 */
export class DocumentResource extends ResourceService<GlpiDocument> {
  /**
   * Initializes a new DocumentResource instance.
   *
   * @param http The HTTP client to use for network transport.
   * @param endpoint The route path or registered alias (defaults to 'Management/Document').
   * @param registry Optional RouteRegistry for custom alias resolution.
   */
  constructor(
    http: IHttpClient,
    endpoint: string = 'Management/Document',
    registry?: RouteRegistry
  ) {
    super(http, endpoint, registry);
  }

  /**
   * Uploads a file with metadata to GLPI using multipart/form-data.
   *
   * @param file File content (Buffer, Uint8Array, Blob, string, or Stream) and filename/MIME information.
   * @param metadata Optional metadata fields (name, comment, uploadManifest) to attach to the document.
   * @param options Optional request options including entity/profile scoping.
   * @returns Creation result containing the new document ID and URL.
   */
  async upload(
    file: DocumentUploadFile,
    metadata?: DocumentMetadata,
    options?: RequestOptions
  ): Promise<CreateResult> {
    const formData = new FormData();

    if (metadata) {
      formData.append('uploadManifest', JSON.stringify(metadata));
      for (const [key, val] of Object.entries(metadata)) {
        if (val !== undefined && val !== null && typeof val !== 'object') {
          formData.append(key, String(val));
        }
      }
    }

    const blob = await toBlob(file);
    const filename = file.filename ?? metadata?.filename ?? 'file';
    formData.append('file', blob, filename);

    const headers = this.buildHeaders(options);

    const response = await this.http.request<CreateResult>({
      method: 'POST',
      path: this.basePath,
      body: formData,
      headers,
      signal: options?.signal,
    });

    return response.data;
  }

  /**
   * Downloads the binary content of a document and extracts filename and MIME type from response headers.
   *
   * @param id The ID of the document.
   * @param options Optional request options including entity/profile scoping.
   * @returns Download result with raw ArrayBuffer data, filename, and contentType.
   */
  async download(
    id: number | string,
    options?: RequestOptions
  ): Promise<DocumentDownloadResult> {
    const headers = this.buildHeaders(options);

    const response = await this.http.request<ArrayBuffer | Response | Blob | Uint8Array | string>({
      method: 'GET',
      path: `${this.basePath}/${id}/Download`,
      headers,
      signal: options?.signal,
      rawResponse: true,
    });

    let arrayBuffer: ArrayBuffer;
    const resData = response.data;

    if (resData instanceof ArrayBuffer) {
      arrayBuffer = resData;
    } else if (ArrayBuffer.isView(resData)) {
      const view = resData as ArrayBufferView;
      const copy = new Uint8Array(view.byteLength);
      copy.set(new Uint8Array(view.buffer, view.byteOffset, view.byteLength));
      arrayBuffer = copy.buffer;
    } else if (resData && typeof (resData as Response).arrayBuffer === 'function') {
      arrayBuffer = await (resData as Response).arrayBuffer();
    } else if (resData && typeof (resData as Blob).arrayBuffer === 'function') {
      arrayBuffer = await (resData as Blob).arrayBuffer();
    } else if (typeof resData === 'string') {
      const encoded = new TextEncoder().encode(resData);
      arrayBuffer = encoded.buffer.slice(encoded.byteOffset, encoded.byteOffset + encoded.byteLength);
    } else {
      throw new GlpiError('Unexpected binary response format in document download');
    }

    const contentType = getHeaderValue(response.headers, 'content-type');
    const contentDisposition = getHeaderValue(response.headers, 'content-disposition');
    const filename = parseContentDispositionFilename(contentDisposition);

    return {
      data: arrayBuffer,
      contentType,
      filename,
      headers: response.headers,
    };
  }
}
