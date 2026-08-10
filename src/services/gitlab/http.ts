export type GitLabRequestOptions = {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  body?: Record<string, unknown>;
};

export type GitLabPage<T> = {
  items: T[];
  nextPage: number | null;
  total?: number;
};

type GitLabErrorPayload = {
  error?: unknown;
  message?: unknown;
};

export class GitLabApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly statusText: string
  ) {
    super(message);
    this.name = 'GitLabApiError';
  }
}

export class GitLabRequestCancelledError extends Error {
  constructor() {
    super('Request cancelled');
    this.name = 'GitLabRequestCancelledError';
  }
}

const errorMessageFrom = (payload: unknown): string | null => {
  if (!payload || typeof payload !== 'object') return null;
  const candidate = payload as GitLabErrorPayload;
  if (typeof candidate.message === 'string') return candidate.message;
  if (typeof candidate.error === 'string') return candidate.error;
  if (candidate.message && typeof candidate.message === 'object') {
    try {
      return JSON.stringify(candidate.message);
    } catch {
      return null;
    }
  }
  return null;
};

const header = (response: Response, name: string): string | null => (
  response.headers && typeof response.headers.get === 'function'
    ? response.headers.get(name)
    : null
);

const nextPageFrom = (response: Response, currentPage: number, itemCount: number, perPage: number) => {
  const nextPageHeader = header(response, 'x-next-page');
  if (nextPageHeader !== null) {
    if (!nextPageHeader.trim()) return null;
    const parsed = Number.parseInt(nextPageHeader, 10);
    if (Number.isSafeInteger(parsed) && parsed > currentPage) return parsed;
  }

  const link = header(response, 'link');
  const nextLink = link?.split(',').find((part) => /rel="?next"?/i.test(part));
  const nextUrl = nextLink?.match(/<([^>]+)>/)?.[1];
  if (nextUrl) {
    try {
      const parsed = Number.parseInt(new URL(nextUrl).searchParams.get('page') ?? '', 10);
      if (Number.isSafeInteger(parsed) && parsed > currentPage) return parsed;
    } catch {
      // Fall through to the item-count compatibility fallback.
    }
  }

  return itemCount === perPage ? currentPage + 1 : null;
};

export async function mapWithConcurrency<T, R>(
  values: T[],
  concurrency: number,
  mapper: (value: T, index: number) => Promise<R>
): Promise<Array<PromiseSettledResult<R>>> {
  const results: Array<PromiseSettledResult<R>> = new Array(values.length);
  let nextIndex = 0;

  const worker = async () => {
    while (nextIndex < values.length) {
      const index = nextIndex;
      nextIndex += 1;
      try {
        results[index] = { status: 'fulfilled', value: await mapper(values[index], index) };
      } catch (reason) {
        results[index] = { status: 'rejected', reason };
      }
    }
  };

  const workerCount = Math.min(Math.max(1, concurrency), Math.max(1, values.length));
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}

export class GitLabHttpClient {
  readonly baseUrl: string;

  constructor(instanceUrl: string, private readonly token: string) {
    this.baseUrl = instanceUrl.trim().replace(/\/+$/, '');
  }

  private async perform<T>(
    endpoint: string,
    timeout: number,
    externalSignal?: AbortSignal,
    options: GitLabRequestOptions = {}
  ): Promise<{ data: T; response: Response }> {
    const controller = new AbortController();
    const timeoutId = globalThis.setTimeout(() => controller.abort(), timeout);
    const abortHandler = () => controller.abort();

    if (externalSignal?.aborted) {
      globalThis.clearTimeout(timeoutId);
      throw new GitLabRequestCancelledError();
    }
    externalSignal?.addEventListener('abort', abortHandler, { once: true });

    try {
      const response = await fetch(`${this.baseUrl}/api/v4${endpoint}`, {
        method: options.method ?? 'GET',
        headers: {
          Authorization: `Bearer ${this.token}`,
          'Content-Type': 'application/json',
          'Cache-Control': 'no-cache',
          Pragma: 'no-cache'
        },
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        signal: controller.signal
      });

      const payload = response.status === 204
        ? undefined
        : await response.json().catch(() => undefined);
      if (!response.ok) {
        const detail = errorMessageFrom(payload);
        throw new GitLabApiError(
          detail ? `GitLab API error: ${detail}` : `GitLab API error: ${response.status} ${response.statusText}`,
          response.status,
          response.statusText
        );
      }

      return { data: payload as T, response };
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        if (externalSignal?.aborted) throw new GitLabRequestCancelledError();
        throw new Error('Request timed out. Try reducing the scope or filtering your search.');
      }
      throw error;
    } finally {
      globalThis.clearTimeout(timeoutId);
      externalSignal?.removeEventListener('abort', abortHandler);
    }
  }

  async request<T>(
    endpoint: string,
    timeout = 30_000,
    signal?: AbortSignal,
    options: GitLabRequestOptions = {}
  ): Promise<T> {
    return (await this.perform<T>(endpoint, timeout, signal, options)).data;
  }

  async requestPage<T>(
    endpoint: string,
    page: number,
    perPage: number,
    timeout = 30_000,
    signal?: AbortSignal
  ): Promise<GitLabPage<T>> {
    const [path, rawQuery = ''] = endpoint.split('?', 2);
    const searchParams = new URLSearchParams(rawQuery);
    searchParams.set('per_page', String(perPage));
    searchParams.set('page', String(page));
    const apiEndpoint = `${path}?${searchParams.toString()}`;
    const { data, response } = await this.perform<T[]>(apiEndpoint, timeout, signal);
    const totalHeader = header(response, 'x-total');
    const total = totalHeader ? Number.parseInt(totalHeader, 10) : undefined;

    return {
      items: Array.isArray(data) ? data : [],
      nextPage: nextPageFrom(response, page, Array.isArray(data) ? data.length : 0, perPage),
      ...(Number.isSafeInteger(total) ? { total } : {})
    };
  }

  async requestAllPages<T>(
    endpoint: string,
    timeout = 30_000,
    signal?: AbortSignal,
    maximumPages = 100
  ): Promise<T[]> {
    const items: T[] = [];
    let page = 1;

    while (page <= maximumPages) {
      const result = await this.requestPage<T>(endpoint, page, 100, timeout, signal);
      items.push(...result.items);
      if (result.nextPage === null) return items;
      page = result.nextPage;
    }

    throw new Error(`GitLab returned more than ${maximumPages * 100} results. Narrow the search and try again.`);
  }

  async graphQL<T>(
    query: string,
    variables: Record<string, unknown>,
    timeout = 10_000,
    signal?: AbortSignal
  ): Promise<T> {
    const controller = new AbortController();
    const timeoutId = globalThis.setTimeout(() => controller.abort(), timeout);
    const abortHandler = () => controller.abort();
    if (signal?.aborted) {
      globalThis.clearTimeout(timeoutId);
      throw new GitLabRequestCancelledError();
    }
    signal?.addEventListener('abort', abortHandler, { once: true });

    try {
      const response = await fetch(`${this.baseUrl}/api/graphql`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ query, variables }),
        signal: controller.signal
      });
      const payload = await response.json().catch(() => ({})) as { data?: T; errors?: unknown };
      if (!response.ok) {
        throw new GitLabApiError(
          `GitLab GraphQL error: ${response.status} ${response.statusText}`,
          response.status,
          response.statusText
        );
      }
      if (payload.errors) throw new Error(`GitLab GraphQL error: ${JSON.stringify(payload.errors)}`);
      if (!payload.data) throw new Error('GitLab GraphQL returned no data.');
      return payload.data;
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        if (signal?.aborted) throw new GitLabRequestCancelledError();
        throw new Error('GraphQL request timed out.');
      }
      throw error;
    } finally {
      globalThis.clearTimeout(timeoutId);
      signal?.removeEventListener('abort', abortHandler);
    }
  }

}
