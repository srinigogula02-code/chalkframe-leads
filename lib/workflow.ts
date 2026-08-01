export const WORKFLOW_STATUSES = ["research_pending", "research_completed", "redesign_created", "contacted"] as const;
export type WorkflowStatus = typeof WORKFLOW_STATUSES[number];

export const WORKFLOW_LABELS: Record<WorkflowStatus, string> = {
  research_pending: "Research pending",
  research_completed: "Research completed",
  redesign_created: "Redesign created",
  contacted: "Contacted",
};

export function isWorkflowStatus(value: unknown): value is WorkflowStatus {
  return WORKFLOW_STATUSES.includes(value as WorkflowStatus);
}
