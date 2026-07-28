export type WorkflowStepStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled' | 'compensated';

export type WorkflowStepDefinition = {
  id: string;
  title: string;
  tool?: string;
  cancellable?: boolean;
  compensation_tool?: string;
};

export type WorkflowStepReceipt = {
  operation_ids?: string[];
  action_ids?: string[];
  source_ids?: string[];
  record_ids?: string[];
  message?: string;
  payload?: Record<string, unknown>;
};

export type WorkflowCheckpointStep = WorkflowStepDefinition & {
  status: WorkflowStepStatus;
  receipts: WorkflowStepReceipt[];
  started_at?: string;
  completed_at?: string;
  cancelled_at?: string;
  failed_at?: string;
  error?: string;
};

export type WorkflowCheckpointPayload = {
  schema_version: 'utopia.workflow-run.v1';
  run_id: string;
  domain: string;
  workflow_id: string;
  cursor: number;
  resume_count: number;
  steps: WorkflowCheckpointStep[];
  completed_operation_ids: string[];
  completed_action_ids: string[];
  source_ids: string[];
  created_at: string;
  updated_at: string;
  cancelled_at?: string;
  cancel_reason?: string;
  resumed_at?: string;
  failure_reason?: string;
};

export type WorkflowReceiptSummary = {
  run_id: string;
  workflow_id: string;
  status: 'running' | 'completed' | 'failed' | 'cancelled';
  completed_steps: number;
  cancelled_steps: number;
  failed_steps: number;
  operation_ids: string[];
  action_ids: string[];
  source_ids: string[];
  record_ids: string[];
  receipts: WorkflowStepReceipt[];
};
