import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RouteRegistry } from '../src/resources/RouteRegistry.js';
import { ResourceService } from '../src/resources/ResourceService.js';
import { IHttpClient } from '../src/http/types.js';
import { rsql } from '../src/rsql/index.js';

interface TestItem {
  id: number;
  name: string;
}

describe('Resource Service & Route Registry', () => {
  let mockHttp: IHttpClient;
  let registry: RouteRegistry;

  beforeEach(() => {
    mockHttp = {
      request: vi.fn(),
      useRequestInterceptor: vi.fn(),
      useResponseInterceptor: vi.fn(),
      setHeader: vi.fn(),
      removeHeader: vi.fn(),
    };
    registry = new RouteRegistry();
  });

  it('resolves core aliases and custom plugin paths', () => {
    expect(registry.resolve('Ticket')).toBe('Assistance/Ticket');
    expect(registry.resolve('Computer')).toBe('Assets/Computer');
    expect(registry.resolve('User')).toBe('Administration/User');
    expect(registry.resolve('Document')).toBe('Management/Document');

    // Direct path pass-through
    expect(registry.resolve('PluginNamespace/CustomItem')).toBe('PluginNamespace/CustomItem');

    // Custom registration
    registry.register('MyPlugin', 'CustomPlugin/MainItem');
    expect(registry.resolve('MyPlugin')).toBe('CustomPlugin/MainItem');
  });

  it('performs list() with pagination and RSQL filter', async () => {
    (mockHttp.request as any).mockResolvedValueOnce({
      status: 200,
      headers: new Headers({ 'x-total-count': '42' }),
      data: [{ id: 1, name: 'Item 1' }],
    });

    const service = new ResourceService<TestItem>(mockHttp, 'Assistance/Ticket');
    const result = await service.list({
      filter: rsql().eq('name', 'Test'),
      start: 0,
      limit: 10,
      sort: 'id:desc',
    });

    expect(result.data).toEqual([{ id: 1, name: 'Item 1' }]);
    expect(result.total).toBe(42);
    expect(result.count).toBe(1);
    expect(mockHttp.request).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'GET',
        path: '/Assistance/Ticket',
        params: {
          filter: 'name==Test',
          start: 0,
          limit: 10,
          sort: 'id:desc',
        },
      })
    );
  });

  it('performs create() returning { id, href } by default', async () => {
    (mockHttp.request as any).mockResolvedValueOnce({
      status: 201,
      data: { id: 101, href: '/Assistance/Ticket/101' },
    });

    const service = new ResourceService<TestItem>(mockHttp, 'Assistance/Ticket');
    const res = await service.create({ name: 'New Ticket' });

    expect(res).toEqual({ id: 101, href: '/Assistance/Ticket/101' });
    expect(mockHttp.request).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'POST',
        path: '/Assistance/Ticket',
        body: { name: 'New Ticket' },
      })
    );
  });

  it('performs create({ fetch: true }) fetching full object', async () => {
    (mockHttp.request as any)
      .mockResolvedValueOnce({
        status: 201,
        data: { id: 101, href: '/Assistance/Ticket/101' },
      })
      .mockResolvedValueOnce({
        status: 200,
        data: { id: 101, name: 'New Ticket Fetched' },
      });

    const service = new ResourceService<TestItem>(mockHttp, 'Assistance/Ticket');
    const res = await service.create({ name: 'New Ticket' }, { fetch: true });

    expect(res).toEqual({ id: 101, name: 'New Ticket Fetched' });
    expect(mockHttp.request).toHaveBeenCalledTimes(2);
  });

  it('passes scoping headers in request options', async () => {
    (mockHttp.request as any).mockResolvedValueOnce({ status: 200, data: { id: 1, name: 'Scoper' } });
    const service = new ResourceService<TestItem>(mockHttp, 'Assistance/Ticket');
    await service.get(1, {
      entity: 2,
      profile: 5,
      recursive: true,
      language: 'fr_FR',
    });

    expect(mockHttp.request).toHaveBeenCalledWith(
      expect.objectContaining({
        headers: expect.objectContaining({
          'GLPI-Entity': '2',
          'GLPI-Profile': '5',
          'GLPI-Entity-Recursive': 'true',
          'Accept-Language': 'fr_FR',
        }),
      })
    );
  });

  it('performs get() retrieving a single entity by id', async () => {
    (mockHttp.request as any).mockResolvedValueOnce({
      status: 200,
      data: { id: 42, name: 'Found Item' },
    });

    const service = new ResourceService<TestItem>(mockHttp, 'Assistance/Ticket');
    const item = await service.get(42);

    expect(item).toEqual({ id: 42, name: 'Found Item' });
    expect(mockHttp.request).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'GET',
        path: '/Assistance/Ticket/42',
      })
    );
  });

  it('performs update() sending PATCH request with updates', async () => {
    (mockHttp.request as any).mockResolvedValueOnce({
      status: 200,
      data: { id: 42, name: 'Updated Item' },
    });

    const service = new ResourceService<TestItem>(mockHttp, 'Assistance/Ticket');
    const updated = await service.update(42, { name: 'Updated Item' }, { entity: 3 });

    expect(updated).toEqual({ id: 42, name: 'Updated Item' });
    expect(mockHttp.request).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'PATCH',
        path: '/Assistance/Ticket/42',
        body: { name: 'Updated Item' },
        headers: expect.objectContaining({
          'GLPI-Entity': '3',
        }),
      })
    );
  });

  it('performs update() with custom method if specified in options', async () => {
    (mockHttp.request as any).mockResolvedValueOnce({
      status: 200,
      data: { id: 42, name: 'Put Item' },
    });

    const service = new ResourceService<TestItem>(mockHttp, 'Assistance/Ticket');
    const updated = await service.update(42, { name: 'Put Item' }, { method: 'PUT' });

    expect(updated).toEqual({ id: 42, name: 'Put Item' });
    expect(mockHttp.request).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'PUT',
        path: '/Assistance/Ticket/42',
      })
    );
  });

  it('performs delete() sending DELETE request with force/purge parameter', async () => {
    (mockHttp.request as any).mockResolvedValueOnce({
      status: 204,
      data: undefined,
    });

    const service = new ResourceService<TestItem>(mockHttp, 'Assistance/Ticket');
    await service.delete(42, { force: true, entity: 1 });

    expect(mockHttp.request).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'DELETE',
        path: '/Assistance/Ticket/42',
        params: { force: true },
        headers: expect.objectContaining({
          'GLPI-Entity': '1',
        }),
      })
    );
  });

  it('resolves alias when instantiated with shortcut or custom registry', async () => {
    const customRegistry = new RouteRegistry({ CustomItem: 'Plugins/CustomItem' });
    const service = new ResourceService<TestItem>(mockHttp, 'Ticket');
    expect(service.getBasePath()).toBe('/Assistance/Ticket');

    const customService = new ResourceService<TestItem>(mockHttp, 'CustomItem', customRegistry);
    expect(customService.getBasePath()).toBe('/Plugins/CustomItem');
  });

  it('handles list() without params or headers and falls back total to data length', async () => {
    (mockHttp.request as any).mockResolvedValueOnce({
      status: 200,
      data: [{ id: 1, name: 'One' }, { id: 2, name: 'Two' }],
    });

    const service = new ResourceService<TestItem>(mockHttp, 'Assistance/Ticket');
    const result = await service.list();

    expect(result.data).toHaveLength(2);
    expect(result.total).toBe(2);
    expect(result.count).toBe(2);
    expect(mockHttp.request).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'GET',
        path: '/Assistance/Ticket',
      })
    );
  });

  it('handles list() with string filter and order', async () => {
    (mockHttp.request as any).mockResolvedValueOnce({
      status: 200,
      headers: new Headers({ 'x-total-count': '10' }),
      data: [{ id: 1, name: 'One' }],
    });

    const service = new ResourceService<TestItem>(mockHttp, 'Assistance/Ticket');
    const result = await service.list({
      filter: 'name==One',
      sort: 'name',
      order: 'ASC',
      start: 5,
      limit: 5,
    });

    expect(result.start).toBe(5);
    expect(result.limit).toBe(5);
    expect(mockHttp.request).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'GET',
        path: '/Assistance/Ticket',
        params: {
          filter: 'name==One',
          sort: 'name',
          order: 'ASC',
          start: 5,
          limit: 5,
        },
      })
    );
  });

  it('RouteRegistry supports register, unregister, has, and getAll', () => {
    const reg = new RouteRegistry();
    expect(reg.has('Ticket')).toBe(true);
    expect(reg.has('Unknown')).toBe(false);

    reg.register('Rack', 'Assets/Rack');
    expect(reg.has('Rack')).toBe(true);
    expect(reg.resolve('Rack')).toBe('Assets/Rack');

    const all = reg.getAll();
    expect(all.Rack).toBe('Assets/Rack');
    expect(all.Ticket).toBe('Assistance/Ticket');

    expect(reg.unregister('Rack')).toBe(true);
    expect(reg.has('Rack')).toBe(false);
    expect(reg.resolve('Rack')).toBe('Rack');
  });

  it('RouteRegistry.resolve trims leading and trailing slashes for alias matching', () => {
    const reg = new RouteRegistry();
    expect(reg.resolve('/Ticket/')).toBe('Assistance/Ticket');
    expect(reg.resolve('Ticket/')).toBe('Assistance/Ticket');
    expect(reg.resolve('/Ticket')).toBe('Assistance/Ticket');
  });

  it('create with fetch: true throws GlpiError when response lacks id', async () => {
    (mockHttp.request as any).mockResolvedValueOnce({
      status: 201,
      data: { message: 'Created without id' },
    });

    const service = new ResourceService<TestItem>(mockHttp, 'Assistance/Ticket');
    await expect(service.create({ name: 'Test' }, { fetch: true })).rejects.toThrow(
      'Cannot fetch created entity: server response did not contain an id'
    );
  });
});
