import { runWorkflow as runMcpWorkflow, WorkflowExecutionResult as McpWorkflowExecutionResult } from '../tools/catalog';

export type WorkflowExecutionResult = McpWorkflowExecutionResult;

export const runWorkflow = runMcpWorkflow;
