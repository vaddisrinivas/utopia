export type AgentStep = {
  id: string;
  action: 'validate_schema' | 'execute_command' | 'write_receipt';
  required: boolean;
};

export type ActionPlan = {
  command: string;
  domain: string;
  steps: AgentStep[];
};

export async function buildPlan(input: { command: string; domain: string }): Promise<ActionPlan> {
  return {
    command: input.command,
    domain: input.domain,
    steps: [
      { id: 'validate', action: 'validate_schema', required: true },
      { id: 'execute', action: 'execute_command', required: true },
      { id: 'emit_receipt', action: 'write_receipt', required: true },
    ],
  };
}
