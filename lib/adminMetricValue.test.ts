import { describe, expect, it } from 'vitest';
import { adminMetricValue } from './adminMetricValue';

describe('admin dashboard metric failure presentation', () => {
  it('shows unavailable rather than zero when the backing query failed', () => {
    expect(adminMetricValue(0, true)).toBe('—');
  });

  it('preserves actual zero and formatted values when the query succeeded', () => {
    expect(adminMetricValue(0, false)).toBe(0);
    expect(adminMetricValue('₱0.00', false)).toBe('₱0.00');
  });
});
