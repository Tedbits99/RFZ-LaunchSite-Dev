export type TopUpField = { label: string; field_key: string; is_required: boolean };

export function firstMissingTopUpField(fields: TopUpField[], values: Record<string, string>): TopUpField | null {
  return fields.find((field) => field.is_required && !values[field.field_key]?.trim()) || null;
}
