import type * as vscode from 'vscode';

interface Waiter {
  readonly resolve: (release: () => void) => void;
  readonly reject: (error: Error) => void;
  readonly token: vscode.CancellationToken;
  cancellation?: vscode.Disposable;
}

export class CancellationError extends Error {
  public constructor() {
    super('操作已取消');
    this.name = 'CancellationError';
  }
}

export class Semaphore {
  private active = 0;
  private readonly waiters: Waiter[] = [];

  public constructor(private readonly capacity: number) {}

  public async acquire(token: vscode.CancellationToken): Promise<() => void> {
    if (token.isCancellationRequested) {
      throw new CancellationError();
    }
    if (this.active < this.capacity) {
      this.active += 1;
      return this.createRelease();
    }

    return new Promise<() => void>((resolve, reject) => {
      const waiter: Waiter = { resolve, reject, token };
      waiter.cancellation = token.onCancellationRequested(() => {
        const index = this.waiters.indexOf(waiter);
        if (index >= 0) {
          this.waiters.splice(index, 1);
        }
        waiter.cancellation?.dispose();
        reject(new CancellationError());
      });
      this.waiters.push(waiter);
    });
  }

  private createRelease(): () => void {
    let released = false;
    return () => {
      if (released) {
        return;
      }
      released = true;
      this.active -= 1;
      this.dispatch();
    };
  }

  private dispatch(): void {
    while (this.active < this.capacity && this.waiters.length > 0) {
      const waiter = this.waiters.shift();
      if (!waiter) {
        return;
      }
      waiter.cancellation?.dispose();
      if (waiter.token.isCancellationRequested) {
        waiter.reject(new CancellationError());
        continue;
      }
      this.active += 1;
      waiter.resolve(this.createRelease());
    }
  }
}
