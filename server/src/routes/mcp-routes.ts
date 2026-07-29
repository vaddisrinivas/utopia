import { handleMcpRequest } from '../mcp/official-server';

export async function handleMcpRoutes(req: any, res: any, path: string): Promise<boolean> {
  if (!/^\/mcp(?:$|\/)/.test(path)) {
    return false;
  }
  await handleMcpRequest(req, res);
  return true;
}
