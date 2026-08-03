import type { StepFlowSnapshot } from '@/packages/runtime-kernel/timed-flow';

export function timerStatusAccessibilityLabel(status: StepFlowSnapshot['status']): string {
  return `Timer status: ${formatTimerStatus(status)}`;
}

export function timerActionAccessibilityLabel(label: string): string {
  const normalized = label.trim();
  switch (normalized) {
    case 'Pause':
      return 'Pause timer';
    case 'Resume':
      return 'Resume timer';
    case 'Start':
      return 'Start timer';
    case 'Next':
      return 'Next step';
    default:
      return normalized;
  }
}

export function timerControlTestId(runId: string, label: string): string {
  return `timed-flow-${stableId(runId)}-${stableId(label)}`;
}

export function timerStatusTestId(runId: string): string {
  return `timed-flow-${stableId(runId)}-status`;
}

function formatTimerStatus(status: StepFlowSnapshot['status']): string {
  return status.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function stableId(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'timer';
}
