import { afterEach, expect, it, vi } from "vitest";
import { createVisiblePoll } from "../src/renderer-visible-poll.js";

afterEach(() => vi.useRealTimers());

it("pauses inactive and hidden views, refreshes on return, and releases its timer and listener", () => {
  vi.useFakeTimers();
  const document = Object.assign(new EventTarget(), { hidden: false });
  const refresh = vi.fn();
  const poll = createVisiblePoll(document as unknown as Document, 1200, refresh);
  vi.advanceTimersByTime(12_000);
  expect(refresh).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);

  poll.setActive(true);
  vi.advanceTimersByTime(1200);
  expect(refresh).toHaveBeenCalledTimes(1);
  document.hidden = true;
  document.dispatchEvent(new Event("visibilitychange"));
  vi.advanceTimersByTime(12_000);
  expect(refresh).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(0);

  document.hidden = false;
  document.dispatchEvent(new Event("visibilitychange"));
  expect(refresh).toHaveBeenCalledTimes(2);
  poll.setActive(false);
  vi.advanceTimersByTime(12_000);
  expect(refresh).toHaveBeenCalledTimes(2);
  poll.setActive(true);
  poll.dispose();
  document.dispatchEvent(new Event("visibilitychange"));
  vi.advanceTimersByTime(12_000);
  expect(refresh).toHaveBeenCalledTimes(2);
  expect(vi.getTimerCount()).toBe(0);
});
