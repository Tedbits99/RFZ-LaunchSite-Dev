import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('admin server layout boundary', () => {
  it('authorizes an active admin before rendering protected child pages', () => {
    const layout = readFileSync(resolve(process.cwd(), 'app/admin/layout.tsx'), 'utf8');
    expect(layout).toContain('await getAdminSession()');
    expect(layout).toContain('if (!session) notFound()');
    expect(layout.indexOf('if (!session) notFound()')).toBeLessThan(layout.indexOf('<AdminShell>'));
    expect(layout).not.toContain('useEffect');
  });
});
