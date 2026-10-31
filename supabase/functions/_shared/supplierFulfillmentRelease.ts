/** Server-side financial release lock. Unset means no supplier purchases. */
export function isSupplierFulfillmentReleased(value: string | undefined): boolean {
  return value === 'enabled';
}
