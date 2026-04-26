export interface DebouncedFn<A extends unknown[]> {
  (...args: A): void;
  cancel(): void;
}

export function debounce<A extends unknown[]>(fn: (...args: A) => void, waitMs: number): DebouncedFn<A> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const debounced = ((...args: A) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      fn(...args);
    }, waitMs);
  }) as DebouncedFn<A>;
  debounced.cancel = () => {
    if (timer) {
      clearTimeout(timer);
      timer = undefined;
    }
  };
  return debounced;
}
