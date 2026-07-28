import { assertServerStartupSecurity } from '../src/security/auth';

function ensure(condition: boolean, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function expectThrows(run: () => void, pattern: RegExp, message: string) {
  try {
    run();
  } catch (error) {
    ensure(pattern.test(String((error as Error).message)), message);
    return;
  }
  throw new Error(message);
}

const previousEnv = {
  localDev: process.env.LIFEOS_LOCAL_DEV,
  serverToken: process.env.LIFEOS_SERVER_TOKEN,
  mcpToken: process.env.LIFEOS_MCP_TOKEN,
  trustedTokens: process.env.LIFEOS_MCP_TRUSTED_TOKENS_JSON,
  trustedPrincipal: process.env.LIFEOS_MCP_TRUSTED_PRINCIPAL,
  trustedDomains: process.env.LIFEOS_MCP_TRUSTED_DOMAINS,
};

try {
  delete process.env.LIFEOS_LOCAL_DEV;
  delete process.env.LIFEOS_SERVER_TOKEN;
  delete process.env.LIFEOS_MCP_TOKEN;
  delete process.env.LIFEOS_MCP_TRUSTED_TOKENS_JSON;
  delete process.env.LIFEOS_MCP_TRUSTED_PRINCIPAL;
  delete process.env.LIFEOS_MCP_TRUSTED_DOMAINS;

  assertServerStartupSecurity('127.0.0.1');

  expectThrows(
    () => assertServerStartupSecurity('0.0.0.0'),
    /Refusing non-loopback bind without configured auth/,
    'non-loopback bind without auth should fail startup',
  );

  process.env.LIFEOS_SERVER_TOKEN = 'startup-security-token';
  assertServerStartupSecurity('0.0.0.0');

  process.env.LIFEOS_LOCAL_DEV = 'true';
  expectThrows(
    () => assertServerStartupSecurity('0.0.0.0'),
    /only allowed when LIFEOS_SERVER_HOST is loopback/,
    'LIFEOS_LOCAL_DEV should be rejected on non-loopback bind',
  );

  console.log('PASS server/test/startup-security.ts');
} finally {
  if (previousEnv.localDev === undefined) delete process.env.LIFEOS_LOCAL_DEV; else process.env.LIFEOS_LOCAL_DEV = previousEnv.localDev;
  if (previousEnv.serverToken === undefined) delete process.env.LIFEOS_SERVER_TOKEN; else process.env.LIFEOS_SERVER_TOKEN = previousEnv.serverToken;
  if (previousEnv.mcpToken === undefined) delete process.env.LIFEOS_MCP_TOKEN; else process.env.LIFEOS_MCP_TOKEN = previousEnv.mcpToken;
  if (previousEnv.trustedTokens === undefined) delete process.env.LIFEOS_MCP_TRUSTED_TOKENS_JSON; else process.env.LIFEOS_MCP_TRUSTED_TOKENS_JSON = previousEnv.trustedTokens;
  if (previousEnv.trustedPrincipal === undefined) delete process.env.LIFEOS_MCP_TRUSTED_PRINCIPAL; else process.env.LIFEOS_MCP_TRUSTED_PRINCIPAL = previousEnv.trustedPrincipal;
  if (previousEnv.trustedDomains === undefined) delete process.env.LIFEOS_MCP_TRUSTED_DOMAINS; else process.env.LIFEOS_MCP_TRUSTED_DOMAINS = previousEnv.trustedDomains;
}
