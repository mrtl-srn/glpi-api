import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Readable } from 'node:stream';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { TicketResource } from '../src/resources/domain/TicketResource.js';
import { ComputerResource } from '../src/resources/domain/ComputerResource.js';
import { UserResource } from '../src/resources/domain/UserResource.js';
import { DocumentResource } from '../src/resources/domain/DocumentResource.js';
import type { IHttpClient } from '../src/http/types.js';

describe('Domain Resource Services', () => {
  let mockHttp: IHttpClient;

  beforeEach(() => {
    mockHttp = {
      request: vi.fn(),
      useRequestInterceptor: vi.fn(),
      useResponseInterceptor: vi.fn(),
      setHeader: vi.fn(),
      removeHeader: vi.fn(),
    };
  });

  it('TicketResource_adds_followup_and_assigns', async () => {
    (mockHttp.request as any)
      .mockResolvedValueOnce({ status: 201, data: { id: 50, href: '/Assistance/Ticket/1/Timeline/Followup/50' } })
      .mockResolvedValueOnce({ status: 201, data: { id: 51, href: '/Assistance/Ticket/1/TeamMember/51' } });

    const tickets = new TicketResource(mockHttp);
    const followup = await tickets.addFollowup(1, 'Issue investigated');
    expect(followup.id).toBe(50);
    expect(mockHttp.request).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'POST',
        path: '/Assistance/Ticket/1/Timeline/Followup',
        body: expect.objectContaining({ content: 'Issue investigated' }),
      })
    );

    const assignRes = await tickets.assign(1, 24, 'user');
    expect(assignRes.id).toBe(51);
    expect(mockHttp.request).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'POST',
        path: '/Assistance/Ticket/1/TeamMember',
        body: expect.objectContaining({ id: 24, type: 'User', role: 'assigned' }),
      })
    );
  });

  it('TicketResource_supports_getTimeline_and_custom_options', async () => {
    (mockHttp.request as any)
      .mockResolvedValueOnce({
        status: 200,
        data: [
          { id: 101, itemtype: 'ITILFollowup', content: 'First response' },
          { id: 102, itemtype: 'TicketTask', content: 'Investigate logs' },
        ],
      })
      .mockResolvedValueOnce({ status: 201, data: { id: 60, href: '/Assistance/Ticket/2/TeamMember/60' } });

    const tickets = new TicketResource(mockHttp);
    const timeline = await tickets.getTimeline(2, { entity: 5 });
    expect(timeline).toHaveLength(2);
    expect(timeline[0].itemtype).toBe('ITILFollowup');
    expect(mockHttp.request).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'GET',
        path: '/Assistance/Ticket/2/Timeline',
        headers: expect.objectContaining({ 'GLPI-Entity': '5' }),
      })
    );

    // Test assign with default type 'user' and group type
    const assignGroupRes = await tickets.assign(2, 99, 'group');
    expect(assignGroupRes.id).toBe(60);
    expect(mockHttp.request).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'POST',
        path: '/Assistance/Ticket/2/TeamMember',
        body: expect.objectContaining({ id: 99, type: 'Group', role: 'assigned' }),
      })
    );
  });

  it('TicketResource_supports_object_content_for_followup', async () => {
    (mockHttp.request as any).mockResolvedValueOnce({
      status: 201,
      data: { id: 70, href: '/Assistance/Ticket/3/Timeline/Followup/70' },
    });

    const tickets = new TicketResource(mockHttp);
    const followup = await tickets.addFollowup(3, {
      content: 'Private note',
      is_private: 1,
    });

    expect(followup.id).toBe(70);
    expect(mockHttp.request).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'POST',
        path: '/Assistance/Ticket/3/Timeline/Followup',
        body: expect.objectContaining({ content: 'Private note', is_private: 1 }),
      })
    );
  });

  it('ComputerResource_initializes_with_default_Assets_Computer_path', () => {
    const computers = new ComputerResource(mockHttp);
    expect(computers.getBasePath()).toBe('/Assets/Computer');
  });

  it('UserResource_me_and_getSession', async () => {
    (mockHttp.request as any)
      .mockResolvedValueOnce({ status: 200, data: { id: 7, name: 'tech_lead' } })
      .mockResolvedValueOnce({ status: 200, data: { glpi_plugins: [], glpiactiveprofile: { id: 2 } } });

    const users = new UserResource(mockHttp);
    const me = await users.me();
    expect(me.id).toBe(7);
    expect(mockHttp.request).toHaveBeenCalledWith(
      expect.objectContaining({ method: 'GET', path: '/Administration/User/Me' })
    );

    const session = await users.getSession();
    expect(session.glpiactiveprofile?.id).toBe(2);
    expect(mockHttp.request).toHaveBeenCalledWith(
      expect.objectContaining({ method: 'GET', path: '/session' })
    );
  });

  it('UserResource_forwards_scoping_options_on_me_and_getSession', async () => {
    (mockHttp.request as any)
      .mockResolvedValueOnce({ status: 200, data: { id: 7, name: 'tech_lead' } })
      .mockResolvedValueOnce({ status: 200, data: { glpi_plugins: [] } });

    const users = new UserResource(mockHttp);
    await users.me({ entity: 3, profile: 1 });
    expect(mockHttp.request).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'GET',
        path: '/Administration/User/Me',
        headers: expect.objectContaining({ 'GLPI-Entity': '3', 'GLPI-Profile': '1' }),
      })
    );

    await users.getSession({ language: 'fr_FR' });
    expect(mockHttp.request).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'GET',
        path: '/session',
        headers: expect.objectContaining({ 'Accept-Language': 'fr_FR' }),
      })
    );
  });

  it('DocumentResource_upload_handles_buffer_blob_and_stream', async () => {
    // Review Focus #4: Document upload handling
    (mockHttp.request as any)
      .mockResolvedValueOnce({
        status: 201,
        data: { id: 77, href: '/Management/Document/77' },
      })
      .mockResolvedValueOnce({
        status: 201,
        data: { id: 78, href: '/Management/Document/78' },
      })
      .mockResolvedValueOnce({
        status: 201,
        data: { id: 79, href: '/Management/Document/79' },
      });

    const docs = new DocumentResource(mockHttp);

    // 1. Buffer upload
    const buffer = Buffer.from('GLPI log contents');
    const result = await docs.upload(
      { content: buffer, filename: 'log.txt', mimeType: 'text/plain' },
      { name: 'System Log', comment: 'Uploaded from SDK' }
    );

    expect(result.id).toBe(77);
    expect(mockHttp.request).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'POST',
        path: '/Management/Document',
        body: expect.any(FormData),
      })
    );

    // 2. Blob upload
    const blob = new Blob(['sample blob text'], { type: 'text/plain' });
    const blobResult = await docs.upload(
      { content: blob, filename: 'sample.txt', mimeType: 'text/plain' },
      { name: 'Sample' }
    );
    expect(blobResult.id).toBe(78);

    // 3. Node Stream upload
    const stream = Readable.from(['stream data line 1\n', 'stream data line 2\n']);
    const streamResult = await docs.upload(
      { content: stream, filename: 'streamed.txt', mimeType: 'text/plain' }
    );
    expect(streamResult.id).toBe(79);
  });

  it('DocumentResource_download_returns_binary_and_metadata', async () => {
    const rawData = new Uint8Array([1, 2, 3, 4]);
    (mockHttp.request as any).mockResolvedValueOnce({
      status: 200,
      headers: new Headers({
        'content-type': 'application/pdf',
        'content-disposition': 'attachment; filename="report.pdf"',
      }),
      data: rawData.buffer,
    });

    const docs = new DocumentResource(mockHttp);
    const file = await docs.download(77);

    expect(mockHttp.request).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'GET',
        path: '/Management/Document/77/Download',
        rawResponse: true,
      })
    );
    expect(file.contentType).toBe('application/pdf');
    expect(file.filename).toBe('report.pdf');
    expect(file.data).toBeDefined();
    expect(new Uint8Array(file.data)).toEqual(rawData);
  });

  it('DocumentResource_download_handles_response_instance_and_rfc5987_with_lang', async () => {
    const rawData = new Uint8Array([10, 20, 30, 40]);
    const mockNativeResponse = new Response(rawData, {
      headers: {
        'content-type': 'application/octet-stream',
        'content-disposition': "attachment; filename*=UTF-8'en'%E6%96%87%E6%9B%B8.dat",
      },
    });

    (mockHttp.request as any).mockResolvedValueOnce({
      status: 200,
      headers: mockNativeResponse.headers,
      data: mockNativeResponse,
    });

    const docs = new DocumentResource(mockHttp);
    const file = await docs.download(88);

    expect(file.contentType).toBe('application/octet-stream');
    expect(file.filename).toBe('文書.dat');
    expect(file.data).toBeDefined();
    expect(new Uint8Array(file.data)).toEqual(rawData);
  });

  it('DocumentResource_download_handles_rfc5987_encoded_filename', async () => {
    const rawData = new Uint8Array([10, 20, 30]);
    (mockHttp.request as any).mockResolvedValueOnce({
      status: 200,
      headers: new Headers({
        'content-type': 'image/png',
        'content-disposition': "attachment; filename*=UTF-8''my%20diagram.png",
      }),
      data: rawData.buffer,
    });

    const docs = new DocumentResource(mockHttp);
    const file = await docs.download(89);

    expect(file.contentType).toBe('image/png');
    expect(file.filename).toBe('my diagram.png');
    expect(file.data).toBeDefined();
  });

  it('DocumentResource_upload_handles_file_path_string', async () => {
    const tmpFile = path.join(os.tmpdir(), `test-upload-${Date.now()}.pdf`);
    await fs.writeFile(tmpFile, 'dummy pdf content');
    try {
      (mockHttp.request as any).mockResolvedValueOnce({
        status: 201,
        data: { id: 80, href: '/Management/Document/80' },
      });

      const docs = new DocumentResource(mockHttp);
      const result = await docs.upload(tmpFile, { name: 'Auto PDF' });

      expect(result.id).toBe(80);
      expect(mockHttp.request).toHaveBeenCalledWith(
        expect.objectContaining({
          method: 'POST',
          path: '/Management/Document',
          body: expect.any(FormData),
        })
      );
      const call = (mockHttp.request as any).mock.calls[0][0];
      const formData = call.body as FormData;
      const fileEntry = formData.get('file') as File;
      expect(fileEntry).toBeDefined();
      expect(fileEntry.name).toBe(path.basename(tmpFile));
      expect(fileEntry.type).toBe('application/pdf');
    } finally {
      await fs.unlink(tmpFile).catch(() => {});
    }
  });

  it('DocumentResource_upload_handles_filePath_in_object', async () => {
    const tmpFile = path.join(os.tmpdir(), `test-upload-${Date.now()}.csv`);
    await fs.writeFile(tmpFile, 'col1,col2\nval1,val2');
    try {
      (mockHttp.request as any).mockResolvedValueOnce({
        status: 201,
        data: { id: 81, href: '/Management/Document/81' },
      });

      const docs = new DocumentResource(mockHttp);
      const result = await docs.upload({
        filePath: tmpFile,
        filename: 'custom.csv',
      });

      expect(result.id).toBe(81);
      const call = (mockHttp.request as any).mock.calls[0][0];
      const formData = call.body as FormData;
      const fileEntry = formData.get('file') as File;
      expect(fileEntry.name).toBe('custom.csv');
      expect(fileEntry.type).toBe('text/csv');
    } finally {
      await fs.unlink(tmpFile).catch(() => {});
    }
  });

  it('DocumentResource_upload_throws_when_missing_both_content_and_filePath', async () => {
    const docs = new DocumentResource(mockHttp);
    await expect(docs.upload({ filename: 'bad.txt' } as any)).rejects.toThrow(
      'DocumentUploadFile must provide either content or filePath'
    );
  });

  it('TicketResource_addDocument_with_numeric_and_string_ids', async () => {
    (mockHttp.request as any).mockResolvedValueOnce({
      status: 201,
      data: { id: 100, href: '/Assistance/Ticket/10/Timeline/Document/100' },
    });

    const tickets = new TicketResource(mockHttp);
    const result = await tickets.addDocument(10, 20);

    expect(result.id).toBe(100);
    expect(mockHttp.request).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'POST',
        path: '/Assistance/Ticket/10/Timeline/Document',
        body: { id: 20, documents_id: 20 },
      })
    );
  });

  it('TicketResource_addDocument_with_resource_objects', async () => {
    (mockHttp.request as any).mockResolvedValueOnce({
      status: 201,
      data: { id: 101, href: '/Assistance/Ticket/10/Timeline/Document/101' },
    });

    const tickets = new TicketResource(mockHttp);
    const mockTicket = { id: 10, name: 'Sample Ticket' };
    const mockDocument = { id: 25, filename: 'report.pdf' };

    const result = await tickets.addDocument(mockTicket, mockDocument);

    expect(result.id).toBe(101);
    expect(mockHttp.request).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'POST',
        path: '/Assistance/Ticket/10/Timeline/Document',
        body: { id: 25, documents_id: 25 },
      })
    );
  });

  it('TicketResource_addDocument_with_mixed_parameters_and_options', async () => {
    (mockHttp.request as any).mockResolvedValueOnce({
      status: 201,
      data: { id: 102, href: '/Assistance/Ticket/15/Timeline/Document/102' },
    });

    const tickets = new TicketResource(mockHttp);
    const result = await tickets.addDocument({ id: 15 }, '30', { entity: 2 });

    expect(result.id).toBe(102);
    expect(mockHttp.request).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'POST',
        path: '/Assistance/Ticket/15/Timeline/Document',
        body: { id: 30, documents_id: 30 },
        headers: expect.objectContaining({ 'GLPI-Entity': '2' }),
      })
    );
  });
});

