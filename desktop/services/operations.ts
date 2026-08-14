export class OperationRegistry {
  private readonly controllers = new Map<string, AbortController>();

  async run<T>(operationId: string, task: (signal: AbortSignal) => Promise<T>): Promise<T> {
    if (this.controllers.has(operationId)) throw new Error('An operation with this identifier is already running.');
    const controller = new AbortController();
    this.controllers.set(operationId, controller);
    try {
      return await task(controller.signal);
    } finally {
      if (this.controllers.get(operationId) === controller) this.controllers.delete(operationId);
    }
  }

  cancel(operationId: string) {
    const controller = this.controllers.get(operationId);
    if (!controller) return false;
    controller.abort();
    return true;
  }

  cancelAll() {
    for (const controller of this.controllers.values()) controller.abort();
    this.controllers.clear();
  }
}
