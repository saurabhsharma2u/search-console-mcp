import { vi } from 'vitest';

vi.mock('googleapis', () => {
  return {
      google: {
          auth: {
              GoogleAuth: class {},
              OAuth2: class {}
          },
          searchconsole: () => ({
              searchanalytics: {
                  query: vi.fn()
              }
          })
      },
      searchconsole_v1: {}
  };
});

export const mockSearchConsoleClient = {
  sites: {
    list: vi.fn(),
    add: vi.fn(),
    delete: vi.fn(),
    get: vi.fn(),
  },
  sitemaps: {
    list: vi.fn(),
    submit: vi.fn(),
    delete: vi.fn(),
    get: vi.fn(),
  },
  searchanalytics: {
    query: vi.fn(),
  },
  urlInspection: {
    index: {
      inspect: vi.fn(),
    },
  },
};

vi.mock('../src/google/client', () => ({
  getSearchConsoleClient: vi.fn().mockResolvedValue(mockSearchConsoleClient),
  getWriteSession: vi.fn().mockResolvedValue({ client: mockSearchConsoleClient, accountId: 'account-1' }),
  resolveIndexingAccount: vi.fn().mockResolvedValue({ id: 'account-1' }),
}));
