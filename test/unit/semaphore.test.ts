import { strict as assert } from 'node:assert';
import { Semaphore } from '../../src/utils/semaphore';

class Token {
  public isCancellationRequested = false;
  private listeners: Array<() => void> = [];

  public onCancellationRequested(listener: () => void): { dispose(): void } {
    this.listeners.push(listener);
    return { dispose: () => { this.listeners = this.listeners.filter((item) => item !== listener); } };
  }

  public cancel(): void {
    this.isCancellationRequested = true;
    for (const listener of [...this.listeners]) {
      listener();
    }
  }
}

describe('并发闸门', () => {
  it('限制并发并在释放后唤醒队列', async () => {
    const semaphore = new Semaphore(1);
    const releaseFirst = await semaphore.acquire(new Token() as any);
    let acquired = false;
    const second = semaphore.acquire(new Token() as any).then((release) => {
      acquired = true;
      return release;
    });
    await Promise.resolve();
    assert.equal(acquired, false);
    releaseFirst();
    const releaseSecond = await second;
    assert.equal(acquired, true);
    releaseSecond();
  });

  it('等待期间支持取消', async () => {
    const semaphore = new Semaphore(1);
    const release = await semaphore.acquire(new Token() as any);
    const queuedToken = new Token();
    const queued = semaphore.acquire(queuedToken as any);
    queuedToken.cancel();
    await assert.rejects(queued, /操作已取消/);
    release();
  });
});
