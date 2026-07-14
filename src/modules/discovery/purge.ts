export function shortBatchId(batchId: string) {
  return batchId.slice(-8);
}

export function expectedPurgeConfirmation(batchId: string) {
  return `DELETE IMPORT ${shortBatchId(batchId)}`;
}
