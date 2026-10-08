  /** Sends everything that's due. Two callers at once share one flush. */
  flush(): Promise<void> {
    this.flushing ??= this.sendDue().finally(() => {
      this.flushing = null;
    });
    return this.flushing;
  }

  private async sendDue(): Promise<void> {
    await this.load();
    const due = this.items.filter((item) => item.nextAttemptAt <= Date.now());
    if (due.length === 0) return;

    for (const item of due) {
      const result = await this.send(item);

      if (result.outcome === 'delivered') {
        this.remove(item);
      } else if (result.outcome === 'rejected') {
        // The server read it and said no. Retrying won't change its mind.
        this.remove(item);
        this.options.onDeadLetter?.(item, result.reason);
      } else {
        item.attempts++;
        item.lastError = result.reason;
        item.nextAttemptAt = Date.now();
      }
      await this.save();

      // If the network just failed us, don't fire the rest of the queue into it.
      if (result.outcome === 'retry') break;
    }
  }

  private async send(item: QueuedRequest): Promise<Result> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.options.timeoutMs ?? 10_000);
    try {
      const res = await fetch(`${this.options.baseUrl}${item.path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'idempotency-key': item.id },
        body: JSON.stringify(item.body),
        signal: controller.signal,
      });
      if (res.ok) return { outcome: 'delivered' };
      if (res.status === 408 || res.status === 429 || res.status >= 500) {
        return { outcome: 'retry', reason: `HTTP ${res.status}` };
      }
      return { outcome: 'rejected', reason: `HTTP ${res.status}: ${await res.text()}` };
    } catch (err) {
      return { outcome: 'retry', reason: err instanceof Error ? err.message : String(err) };
    } finally {
      clearTimeout(timer);
    }
  }

  private remove(item: QueuedRequest): void {
    this.items = this.items.filter((other) => other.id !== item.id);
  }
