import {
  TAVILY_SEARCH_FUNCTION_NAME,
  type LiveModelId,
  modelUsesTavilySearch,
} from '@/lib/live-session-config';

type EnvSource = Record<string, string | undefined>;

export type LiveFunctionCall = {
  id: string;
  name: string;
  args: Record<string, unknown>;
};

export type LiveFunctionResponse = {
  id: string;
  name: string;
  response: Record<string, unknown>;
};

type TavilyTopic = 'general' | 'news';
type TavilyTimeRange = 'day' | 'week' | 'month' | 'year';
type TavilySearchDepth = 'basic' | 'advanced';

type TavilySearchArgs = {
  query: string;
  topic?: TavilyTopic;
  timeRange?: TavilyTimeRange;
  maxResults?: number;
  searchDepth?: TavilySearchDepth;
  includeDomains?: string[];
  excludeDomains?: string[];
};

type TavilyResult = {
  title?: string;
  url?: string;
  content?: string;
  score?: number;
  raw_content?: string | null;
  favicon?: string | null;
};

type TavilyResponse = {
  query?: string;
  answer?: string;
  results?: TavilyResult[];
  response_time?: string;
  auto_parameters?: Record<string, unknown>;
  usage?: Record<string, unknown>;
  request_id?: string;
};

const TAVILY_API_URL = 'https://api.tavily.com/search';

function getTavilyApiKey(env: EnvSource = process.env) {
  const apiKey = env.TAVILY_API_KEY;

  if (!apiKey) {
    throw new Error(
      'TAVILY_API_KEY is not set. Add it to .env.local before enabling Tavily search.',
    );
  }

  return apiKey;
}

function asStringArray(value: unknown, maxItems: number): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const normalized = value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
    .slice(0, maxItems);

  return normalized.length > 0 ? normalized : undefined;
}

function normalizeTavilyArgs(args: Record<string, unknown>): TavilySearchArgs {
  const query = typeof args.query === 'string' ? args.query.trim() : '';

  if (!query) {
    throw new Error('Tavily search requires a non-empty query.');
  }

  const topic = args.topic === 'news' ? 'news' : 'general';
  const timeRange =
    args.timeRange === 'day' ||
    args.timeRange === 'week' ||
    args.timeRange === 'month' ||
    args.timeRange === 'year'
      ? args.timeRange
      : undefined;
  const maxResultsRaw =
    typeof args.maxResults === 'number' && Number.isFinite(args.maxResults)
      ? args.maxResults
      : 5;
  const maxResults = Math.min(10, Math.max(1, Math.round(maxResultsRaw)));
  const searchDepth = args.searchDepth === 'advanced' ? 'advanced' : 'basic';

  return {
    query,
    topic,
    timeRange,
    maxResults,
    searchDepth,
    includeDomains: asStringArray(args.includeDomains, 20),
    excludeDomains: asStringArray(args.excludeDomains, 20),
  };
}

async function runTavilySearch(
  args: Record<string, unknown>,
  env: EnvSource = process.env,
): Promise<Record<string, unknown>> {
  const normalized = normalizeTavilyArgs(args);
  const response = await fetch(TAVILY_API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${getTavilyApiKey(env)}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      query: normalized.query,
      topic: normalized.topic,
      time_range: normalized.timeRange,
      max_results: normalized.maxResults,
      search_depth: normalized.searchDepth,
      include_answer: 'advanced',
      include_raw_content: false,
      include_domains: normalized.includeDomains,
      exclude_domains: normalized.excludeDomains,
    }),
    cache: 'no-store',
  });

  const json = (await response.json().catch(() => null)) as TavilyResponse | null;

  if (!response.ok) {
    const fallback = `Tavily request failed with status ${response.status}.`;
    throw new Error(
      typeof json === 'object' && json !== null && 'detail' in json && typeof json.detail === 'string'
        ? json.detail
        : fallback,
    );
  }

  return {
    query: json?.query ?? normalized.query,
    answer: json?.answer ?? null,
    results: (json?.results ?? []).slice(0, normalized.maxResults).map((result) => ({
      title: result.title ?? '',
      url: result.url ?? '',
      content: result.content ?? '',
      score: result.score ?? null,
      favicon: result.favicon ?? null,
    })),
    responseTime: json?.response_time ?? null,
    requestId: json?.request_id ?? null,
    autoParameters: json?.auto_parameters ?? null,
    usage: json?.usage ?? null,
  };
}

export async function executeLiveFunctionCalls(
  functionCalls: LiveFunctionCall[],
  model: LiveModelId,
  env: EnvSource = process.env,
): Promise<LiveFunctionResponse[]> {
  return Promise.all(
    functionCalls.map(async (call) => {
      if (call.name === TAVILY_SEARCH_FUNCTION_NAME && modelUsesTavilySearch(model)) {
        try {
          const result = await runTavilySearch(call.args, env);
          return {
            id: call.id,
            name: call.name,
            response: {
              ok: true,
              ...result,
            },
          };
        } catch (error) {
          return {
            id: call.id,
            name: call.name,
            response: {
              ok: false,
              error: error instanceof Error ? error.message : 'Tavily search failed.',
            },
          };
        }
      }

      return {
        id: call.id,
        name: call.name,
        response: {
          ok: false,
          error: `Unsupported tool: ${call.name}`,
        },
      };
    }),
  );
}
