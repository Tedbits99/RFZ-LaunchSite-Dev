/** Supplier purchases stay disabled unless explicitly released server-side. */
export function isSupplierFulfillmentReleased(value: string | undefined): boolean {
  return value === 'enabled';
}
