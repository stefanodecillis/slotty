/**
 * Spec for `classifyMismatch`. Tests are intentionally loose — they assert
 * behavior (severity / count) rather than exact codes or wording, so you can
 * pick your own naming. Run with: `bun test tests/unit/diagnose.test.ts`.
 */
import { describe, it, expect } from 'bun:test';

import {
  classifyMismatch,
  type ClassifyInput,
  type ObservedRequest,
  type ReachabilityResult,
} from '@/lib/site-url/diagnose';

const okReachability: ReachabilityResult = {
  ok: true,
  status: 200,
  durationMs: 12,
  error: null,
};

const failedReachability: ReachabilityResult = {
  ok: false,
  status: null,
  durationMs: 4500,
  error: 'fetch failed',
};

function obs(overrides: Partial<ObservedRequest> = {}): ObservedRequest {
  return {
    host: 'book.example.com',
    xForwardedHost: 'book.example.com',
    xForwardedProto: 'https',
    xForwardedFor: '203.0.113.1',
    ...overrides,
  };
}

function input(overrides: Partial<ClassifyInput> = {}): ClassifyInput {
  return {
    configured: new URL('https://book.example.com'),
    observed: obs(),
    trustProxy: true,
    reachability: okReachability,
    ...overrides,
  };
}

describe('classifyMismatch', () => {
  it('returns no issues for a healthy proxied deployment', () => {
    expect(classifyMismatch(input())).toEqual([]);
  });

  // The following are `it.todo` until you implement the matching logic in
  // src/lib/site-url/diagnose.ts → classifyMismatch. Convert each `it.todo`
  // to plain `it` once you've added a corresponding case.
  it.todo('flags an error when reachability fails', () => {
    const issues = classifyMismatch(input({ reachability: failedReachability }));
    expect(issues.some((i) => i.severity === 'error')).toBe(true);
  });

  it.todo('flags missing X-Forwarded-Host when proxy is trusted', () => {
    const issues = classifyMismatch(
      input({ observed: obs({ xForwardedHost: null }) }),
    );
    expect(issues.length).toBeGreaterThan(0);
  });

  it.todo('flags a host mismatch between configured and forwarded', () => {
    const issues = classifyMismatch(
      input({ observed: obs({ xForwardedHost: 'other.example.com' }) }),
    );
    expect(issues.length).toBeGreaterThan(0);
  });

  it.todo('flags https configured but http forwarded', () => {
    const issues = classifyMismatch(
      input({ observed: obs({ xForwardedProto: 'http' }) }),
    );
    expect(issues.some((i) => i.severity === 'error' || i.severity === 'warning')).toBe(true);
  });

  // Optional — uncomment if you decide to flag this case.
  // it('flags a non-standard port on the configured URL', () => {
  //   const issues = classifyMismatch(input({ configured: new URL('https://book.example.com:8443') }));
  //   expect(issues.length).toBeGreaterThan(0);
  // });
});
