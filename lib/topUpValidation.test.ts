import { describe, expect, it } from 'vitest';
import { firstMissingTopUpField } from './topUpValidation';

const fields = [
  { label: 'User ID', field_key: 'user_id', is_required: true },
  { label: 'Zone ID', field_key: 'zone_id', is_required: true },
  { label: 'Server', field_key: 'server_id', is_required: false },
];

describe('firstMissingTopUpField', () => {
  it('returns the first required field that is blank', () => {
    expect(firstMissingTopUpField(fields, { user_id: '123' })?.label).toBe('Zone ID');
  });

  it('ignores optional fields and whitespace-only values after required fields are complete', () => {
    expect(firstMissingTopUpField(fields, { user_id: '123', zone_id: ' 456 ' })).toBeNull();
  });

  it('returns null when all required fields are complete', () => {
    expect(firstMissingTopUpField(fields, { user_id: '123', zone_id: '456', server_id: '' })).toBeNull();
  });
});
