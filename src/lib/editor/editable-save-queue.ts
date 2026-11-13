/** Serialize each composition's writes, so a slow earlier PUT cannot overwrite a later edit. */
const queues = new Map<string, Promise<unknown>>();
export function queueEditableSave<T>(key: string, operation: () => Promise<T>): Promise<T> {
  const pending = (queues.get(key) || Promise.resolve()).catch(() => {}).then(operation);
  queues.set(key, pending);
  void pending.finally(() => {
    if (queues.get(key) === pending) queues.delete(key);
  }).catch(() => {});
  return pending;
}
