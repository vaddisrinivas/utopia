import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  McpError,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

import type { McpScope } from '../security/auth';
import { isMcpToolAllowed } from '../security/policy';
import { resolveResourceMimeType } from '../resources/catalog';
import { listMcpTools } from '../tools/catalog';
import { validateArgsForTool } from '../tools/tool-validation';
import {
  McpScopeDeniedError,
  callScopedMcpTool,
  listScopedMcpResources,
  readScopedMcpResource,
} from './scoped-access';

export const MCP_SERVER_NAME = 'utopia-server';
export const MCP_SERVER_VERSION = '1.0.0';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function textContent(value: unknown) {
  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify(value),
      },
    ],
  };
}

export function createWonderMcpSdkServer(scope: McpScope) {
  const server = new Server(
    {
      name: MCP_SERVER_NAME,
      version: MCP_SERVER_VERSION,
    },
    {
      capabilities: {
        tools: {},
        resources: {},
      },
    },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: listMcpTools().map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema as {
        type: 'object';
        properties?: Record<string, object>;
        required?: string[];
      },
    })),
  }));

  server.setRequestHandler(ListResourcesRequestSchema, async () => ({
    resources: listScopedMcpResources(scope),
  }));

  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const uri = request.params.uri;
    try {
      return {
        contents: [
          {
            uri,
            mimeType: resolveResourceMimeType(uri),
            text: readScopedMcpResource(uri, scope),
          },
        ],
      };
    } catch (error) {
      if (error instanceof McpScopeDeniedError) {
        throw new McpError(ErrorCode.InvalidParams, error.message);
      }
      throw error;
    }
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const toolName = request.params.name;
    if (!isMcpToolAllowed(toolName)) {
      throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${toolName}`);
    }

    const args = request.params.arguments ?? {};
    const validationErrors = validateArgsForTool(toolName, args);
    if (validationErrors.length > 0) {
      throw new McpError(ErrorCode.InvalidParams, `Invalid arguments: ${validationErrors.join('; ')}`);
    }

    try {
      const result = await callScopedMcpTool(toolName, isRecord(args) ? args : {}, scope);
      return textContent(result.json);
    } catch (error) {
      if (error instanceof McpScopeDeniedError) {
        throw new McpError(-32001, error.message);
      }
      throw error;
    }
  });

  return server;
}
