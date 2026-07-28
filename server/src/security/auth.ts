export type HeaderMap = Record<string, string | string[] | undefined>;

export type RequestAuthorizationResult = {
  ok: boolean;
  localDevelopment: boolean;
  statusCode: 200 | 401 | 403 | 503;
  message: string;
  principalId: string | null;
  mcpScope: McpScope | null;
};

export type McpScope = {
  domains: Set<string>;
  principal: string | null;
  allowAllDomains: boolean;
};

type TrustedTokenConfig = {
  token: string;
  principal: string;
  domains: Set<string>;
  allowAllDomains: boolean;
};

const TRUE_VALUES = new Set(['1', 'true', 'yes', 'on']);
const DOMAIN_SCOPE_HEADER_CANDIDATES = ['x-utopia-domain-scope', 'x-utopia-tenant-scope'] as const;
const PRINCIPAL_SCOPE_HEADER_CANDIDATES = ['x-utopia-principal', 'x-utopia-principal-scope'] as const;
const DOMAIN_SCOPE_ENTRY_RE = /^[A-Za-z0-9_.:-]+$/;

export const LOCAL_DEVELOPMENT_ENV = 'LIFEOS_LOCAL_DEV';
export const SERVER_TRUSTED_TOKENS_ENV = 'LIFEOS_SERVER_TRUSTED_TOKENS_JSON';
export const MCP_TRUSTED_TOKENS_ENV = 'LIFEOS_MCP_TRUSTED_TOKENS_JSON';
export const MCP_TRUSTED_PRINCIPAL_ENV = 'LIFEOS_MCP_TRUSTED_PRINCIPAL';
export const MCP_TRUSTED_DOMAINS_ENV = 'LIFEOS_MCP_TRUSTED_DOMAINS';
export const DEFAULT_SERVER_PRINCIPAL = 'server';
export const DEFAULT_LOCAL_DEVELOPMENT_PRINCIPAL = 'local-development';

function serverAuthToken(): string {
  return process.env.LIFEOS_SERVER_TOKEN?.trim() || '';
}

function mcpAuthToken(): string {
  return process.env.LIFEOS_MCP_TOKEN?.trim() || serverAuthToken();
}

function firstHeaderValue(headers: HeaderMap, name: string): string | undefined {
  const rawHeader = headers?.[name];
  if (!rawHeader) {
    return undefined;
  }
  if (Array.isArray(rawHeader)) {
    return typeof rawHeader[0] === 'string' ? rawHeader[0].trim() : undefined;
  }
  return String(rawHeader).trim();
}

function parseBoolean(raw: unknown): boolean {
  return typeof raw === 'string' && TRUE_VALUES.has(raw.trim().toLowerCase());
}

function normalizePrincipalId(value: string | undefined, fallback: string) {
  if (!value) {
    return fallback;
  }
  return value.trim().toLowerCase().replace(/[^a-z0-9_.:-]+/g, '-').replace(/^-+|-+$/g, '') || fallback;
}

function normalizeScopeEntries(raw: string | undefined): { domains: Set<string>; allowAllDomains: boolean } {
  if (!raw) {
    return { domains: new Set(), allowAllDomains: false };
  }

  const domains = new Set<string>();
  let allowAllDomains = false;
  for (const entry of raw.split(',')) {
    const normalized = entry.trim().toLowerCase();
    if (!normalized) {
      continue;
    }
    if (normalized === '*') {
      allowAllDomains = true;
      continue;
    }
    if (DOMAIN_SCOPE_ENTRY_RE.test(normalized)) {
      domains.add(normalized);
    }
  }

  return { domains, allowAllDomains };
}

function localDevelopmentScope(): McpScope {
  return {
    domains: new Set(),
    principal: DEFAULT_LOCAL_DEVELOPMENT_PRINCIPAL,
    allowAllDomains: true,
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseTrustedTokenConfig(raw: unknown): TrustedTokenConfig | null {
  if (!isObject(raw)) {
    return null;
  }

  const token = typeof raw.token === 'string' ? raw.token.trim() : '';
  if (!token) {
    return null;
  }

  const principal = normalizePrincipalId(
    typeof raw.principal === 'string' ? raw.principal : undefined,
    DEFAULT_SERVER_PRINCIPAL,
  );
  const rawDomains = Array.isArray(raw.domains)
    ? raw.domains.filter((entry): entry is string => typeof entry === 'string').join(',')
    : typeof raw.domains === 'string'
      ? raw.domains
      : '';
  const { domains, allowAllDomains } = normalizeScopeEntries(rawDomains);

  return {
    token,
    principal,
    domains,
    allowAllDomains,
  };
}

function parseTrustedTokenConfigs(rawValue: string, envName: string): TrustedTokenConfig[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawValue);
  } catch {
    throw new Error(`${envName} must be valid JSON`);
  }

  const rows = Array.isArray(parsed) ? parsed : [parsed];
  const entries = rows
    .map((entry) => parseTrustedTokenConfig(entry))
    .filter((entry): entry is TrustedTokenConfig => entry !== null);
  if (entries.length === 0) {
    throw new Error(`${envName} must define at least one token`);
  }
  return entries;
}

function configuredServerTokens(): TrustedTokenConfig[] {
  const rawTrustedTokens = process.env[SERVER_TRUSTED_TOKENS_ENV]?.trim();
  if (rawTrustedTokens) {
    return parseTrustedTokenConfigs(rawTrustedTokens, SERVER_TRUSTED_TOKENS_ENV);
  }

  const token = serverAuthToken();
  if (!token) {
    return [];
  }
  return [{
    token,
    principal: DEFAULT_SERVER_PRINCIPAL,
    domains: new Set(),
    allowAllDomains: true,
  }];
}

function configuredMcpTokens(): TrustedTokenConfig[] {
  const rawTrustedTokens = process.env[MCP_TRUSTED_TOKENS_ENV]?.trim();
  if (rawTrustedTokens) {
    return parseTrustedTokenConfigs(rawTrustedTokens, MCP_TRUSTED_TOKENS_ENV);
  }

  const token = mcpAuthToken();
  if (!token) {
    return [];
  }

  const principal = normalizePrincipalId(process.env[MCP_TRUSTED_PRINCIPAL_ENV], DEFAULT_SERVER_PRINCIPAL);
  const configuredDomains = process.env[MCP_TRUSTED_DOMAINS_ENV];
  const { domains, allowAllDomains } = normalizeScopeEntries(configuredDomains);
  return [{
    token,
    principal,
    domains,
    // A legacy single MCP token is an explicitly global credential unless the
    // operator narrows it with LIFEOS_MCP_TRUSTED_DOMAINS.
    allowAllDomains: configuredDomains === undefined ? true : allowAllDomains,
  }];
}

function parseRequestedScope(headers: HeaderMap): McpScope {
  const domainHeader = DOMAIN_SCOPE_HEADER_CANDIDATES
    .map((name) => firstHeaderValue(headers, name))
    .find((value) => typeof value === 'string' && value.length > 0);
  const principalHeader = PRINCIPAL_SCOPE_HEADER_CANDIDATES
    .map((name) => firstHeaderValue(headers, name))
    .find((value) => typeof value === 'string' && value.length > 0);
  const { domains, allowAllDomains } = normalizeScopeEntries(domainHeader);

  return {
    domains,
    principal: principalHeader ? normalizePrincipalId(principalHeader, DEFAULT_SERVER_PRINCIPAL) : null,
    allowAllDomains,
  };
}

function isSubset(candidate: Set<string>, allowed: Set<string>): boolean {
  for (const entry of candidate) {
    if (!allowed.has(entry)) {
      return false;
    }
  }
  return true;
}

function validateRequestedMcpScope(headers: HeaderMap, trusted: TrustedTokenConfig): RequestAuthorizationResult | null {
  const requested = parseRequestedScope(headers);
  if (requested.principal && requested.principal !== trusted.principal) {
    return {
      ok: false,
      localDevelopment: false,
      statusCode: 403,
      message: 'Caller-asserted MCP principal does not match trusted server configuration',
      principalId: null,
      mcpScope: null,
    };
  }

  if (requested.allowAllDomains && !trusted.allowAllDomains) {
    return {
      ok: false,
      localDevelopment: false,
      statusCode: 403,
      message: 'Caller-asserted MCP scope exceeds trusted server configuration',
      principalId: null,
      mcpScope: null,
    };
  }

  if (!trusted.allowAllDomains && !isSubset(requested.domains, trusted.domains)) {
    return {
      ok: false,
      localDevelopment: false,
      statusCode: 403,
      message: 'Caller-asserted MCP scope exceeds trusted server configuration',
      principalId: null,
      mcpScope: null,
    };
  }

  return null;
}

export function isLoopbackHost(host: string): boolean {
  const normalized = host.trim().toLowerCase();
  return normalized === '127.0.0.1'
    || normalized === 'localhost'
    || normalized === '::1';
}

export function assertServerStartupSecurity(host: string): void {
  const loopback = isLoopbackHost(host);
  if (isExplicitLocalDevelopment() && !loopback) {
    throw new Error(`${LOCAL_DEVELOPMENT_ENV}=true is only allowed when LIFEOS_SERVER_HOST is loopback`);
  }

  if (
    !loopback
    && !process.env[SERVER_TRUSTED_TOKENS_ENV]?.trim()
    && !process.env[MCP_TRUSTED_TOKENS_ENV]?.trim()
    && !serverAuthToken()
    && !mcpAuthToken()
  ) {
    throw new Error('Refusing non-loopback bind without configured auth. Set LIFEOS_SERVER_TOKEN or LIFEOS_MCP_TOKEN.');
  }
}

export function isExplicitLocalDevelopment(): boolean {
  return parseBoolean(process.env[LOCAL_DEVELOPMENT_ENV]);
}

export function getBearerToken(headers: HeaderMap): string | undefined {
  return firstHeaderValue(headers, 'authorization');
}

export function authorizeBearerRequest(headers: HeaderMap, token: string, label: string): RequestAuthorizationResult {
  if (isExplicitLocalDevelopment()) {
    return {
      ok: true,
      localDevelopment: true,
      statusCode: 200,
      message: `${label} auth bypassed in explicit local-development mode.`,
      principalId: DEFAULT_LOCAL_DEVELOPMENT_PRINCIPAL,
      mcpScope: label === 'MCP' ? localDevelopmentScope() : null,
    };
  }

  if (!token) {
    return {
      ok: false,
      localDevelopment: false,
      statusCode: 503,
      message: `${label} token not configured. Set ${label === 'MCP' ? 'LIFEOS_MCP_TOKEN or ' : ''}LIFEOS_SERVER_TOKEN, or explicitly enable ${LOCAL_DEVELOPMENT_ENV}=true for local development.`,
      principalId: null,
      mcpScope: null,
    };
  }

  const bearer = getBearerToken(headers);
  if (!bearer) {
    return {
      ok: false,
      localDevelopment: false,
      statusCode: 401,
      message: `Missing ${label.toLowerCase()} bearer token`,
      principalId: null,
      mcpScope: null,
    };
  }

  if (bearer !== `Bearer ${token}`) {
    return {
      ok: false,
      localDevelopment: false,
      statusCode: 401,
      message: `Invalid ${label.toLowerCase()} bearer token`,
      principalId: null,
      mcpScope: null,
    };
  }

  return {
    ok: true,
    localDevelopment: false,
    statusCode: 200,
    message: `${label} authorized`,
    principalId: DEFAULT_SERVER_PRINCIPAL,
    mcpScope: label === 'MCP'
      ? {
          domains: new Set(),
          principal: DEFAULT_SERVER_PRINCIPAL,
          allowAllDomains: false,
        }
      : null,
  };
}

export function authorizeServerRequest(headers: HeaderMap): RequestAuthorizationResult {
  if (isExplicitLocalDevelopment()) {
    return {
      ok: true,
      localDevelopment: true,
      statusCode: 200,
      message: 'Server auth bypassed in explicit local-development mode.',
      principalId: DEFAULT_LOCAL_DEVELOPMENT_PRINCIPAL,
      mcpScope: null,
    };
  }

  let configuredTokens: TrustedTokenConfig[];
  try {
    configuredTokens = configuredServerTokens();
  } catch (error) {
    return {
      ok: false,
      localDevelopment: false,
      statusCode: 503,
      message: (error as Error).message,
      principalId: null,
      mcpScope: null,
    };
  }

  if (configuredTokens.length === 0) {
    return {
      ok: false,
      localDevelopment: false,
      statusCode: 503,
      message: `Server token not configured. Set ${SERVER_TRUSTED_TOKENS_ENV} or LIFEOS_SERVER_TOKEN, or explicitly enable ${LOCAL_DEVELOPMENT_ENV}=true for local development.`,
      principalId: null,
      mcpScope: null,
    };
  }

  const bearer = getBearerToken(headers);
  if (!bearer) {
    return {
      ok: false,
      localDevelopment: false,
      statusCode: 401,
      message: 'Missing server bearer token',
      principalId: null,
      mcpScope: null,
    };
  }

  const matched = configuredTokens.find((entry) => bearer === `Bearer ${entry.token}`);
  if (!matched) {
    return {
      ok: false,
      localDevelopment: false,
      statusCode: 401,
      message: 'Invalid server bearer token',
      principalId: null,
      mcpScope: null,
    };
  }

  return {
    ok: true,
    localDevelopment: false,
    statusCode: 200,
    message: 'Server authorized',
    principalId: matched.principal,
    mcpScope: null,
  };
}

export function authorizeMcpRequest(headers: HeaderMap): RequestAuthorizationResult {
  if (isExplicitLocalDevelopment()) {
    return {
      ok: true,
      localDevelopment: true,
      statusCode: 200,
      message: 'MCP auth bypassed in explicit local-development mode.',
      principalId: DEFAULT_LOCAL_DEVELOPMENT_PRINCIPAL,
      mcpScope: localDevelopmentScope(),
    };
  }

  let configuredTokens: TrustedTokenConfig[];
  try {
    configuredTokens = configuredMcpTokens();
  } catch (error) {
    return {
      ok: false,
      localDevelopment: false,
      statusCode: 503,
      message: (error as Error).message,
      principalId: null,
      mcpScope: null,
    };
  }

  if (configuredTokens.length === 0) {
    return {
      ok: false,
      localDevelopment: false,
      statusCode: 503,
      message: `MCP token not configured. Set ${MCP_TRUSTED_TOKENS_ENV}, LIFEOS_MCP_TOKEN, or LIFEOS_SERVER_TOKEN, or explicitly enable ${LOCAL_DEVELOPMENT_ENV}=true for local development.`,
      principalId: null,
      mcpScope: null,
    };
  }

  const bearer = getBearerToken(headers);
  if (!bearer) {
    return {
      ok: false,
      localDevelopment: false,
      statusCode: 401,
      message: 'Missing mcp bearer token',
      principalId: null,
      mcpScope: null,
    };
  }

  const matched = configuredTokens.find((entry) => bearer === `Bearer ${entry.token}`);
  if (!matched) {
    return {
      ok: false,
      localDevelopment: false,
      statusCode: 401,
      message: 'Invalid mcp bearer token',
      principalId: null,
      mcpScope: null,
    };
  }

  const scopeValidation = validateRequestedMcpScope(headers, matched);
  if (scopeValidation) {
    return scopeValidation;
  }

  return {
    ok: true,
    localDevelopment: false,
    statusCode: 200,
    message: 'MCP authorized',
    principalId: matched.principal,
    mcpScope: {
      domains: new Set(matched.domains),
      principal: matched.principal,
      allowAllDomains: matched.allowAllDomains,
    },
  };
}

export function isMcpToolAuthorized(headers: HeaderMap): boolean {
  return authorizeMcpRequest(headers).ok;
}

export function canExposeProviderStatusIds(headers: HeaderMap): boolean {
  return authorizeServerRequest(headers).ok;
}
