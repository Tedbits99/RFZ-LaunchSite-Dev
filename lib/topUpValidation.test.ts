import { describe, expect, it } from 'vitest';
import { firstMissingTopUpField } from './topUpValidation';

const fields = [
  { label: 'User ID', field_key: 'user_id', is_required: true },
  { label: 'Zone ID', field_key: 'zone_id', is_required: true },
  { label: 'Server', field_key: 'server_id', is_required: false },
];

describe('firstMissingTopUpField', () => {
  it.each([1, 2, 3, 4])('validates all %s required player fields', (count) => {
    const requiredFields = Array.from({ length: count }, (_, index) => ({
      label: `Field ${index + 1}`,
      field_key: `field_${index + 1}`,
      is_required: true,
    }));
    const incompleteValues = Object.fromEntries(requiredFields.slice(0, -1).map((field) => [field.field_key, 'entered']));
    expect(firstMissingTopUpField(requiredFields, incompleteValues)?.field_key).toBe(requiredFields.at(-1)?.field_key);
    expect(firstMissingTopUpField(requiredFields, Object.fromEntries(requiredFields.map((field) => [field.field_key, 'entered'])))).toBeNull();
  });

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
