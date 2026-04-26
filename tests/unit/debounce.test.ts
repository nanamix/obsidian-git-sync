import { describe, it, expect, vi } from 'vitest';
import { debounce } from '../../src/lib/debounce';

describe('debounce', () => {
  it('calls fn once after wait', async () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const d = debounce(fn, 100);
    d(); d(); d();
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(100);
    expect(fn).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it('cancel prevents pending invocation', () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const d = debounce(fn, 100);
    d();
    d.cancel();
    vi.advanceTimersByTime(200);
    expect(fn).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
});
