export function runPostCommitTask(taskName: string, task: () => Promise<unknown>) {
  void task().catch((error) => {
    console.error(`${taskName} failed after the primary transaction committed`, error);
  });
}
