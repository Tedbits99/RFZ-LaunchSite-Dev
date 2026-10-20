import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

function pageFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return pageFiles(path);
    return entry.name === 'page.tsx' ? [path] : [];
  });
}

describe('privileged admin server page boundaries', () => {
  it('checks an active admin inside each server page before database reads', () => {
    const pages = pageFiles(join(process.cwd(), 'app/admin'));
    const guardedPages = pages.filter((path) => {
      const source = readFileSync(path, 'utf8');
      return source.includes('adminSupabase') || source.includes('createSupabaseServerClient');
    });

    expect(guardedPages.length).toBeGreaterThan(0);
    for (const path of guardedPages) {
      const source = readFileSync(path, 'utf8');
      const defaultPageIndex = source.indexOf('export default async function');
      expect(defaultPageIndex, relative(process.cwd(), path)).toBeGreaterThanOrEqual(0);

      const pageBody = source.slice(defaultPageIndex);
      const guardIndex = pageBody.indexOf('await requireAdminPageSession(');
      expect(guardIndex, relative(process.cwd(), path)).toBeGreaterThanOrEqual(0);

      const firstQueryIndex = [pageBody.indexOf('.from('), pageBody.indexOf('.rpc('), pageBody.indexOf('await getMetrics()')]
        .filter((index) => index >= 0)
        .sort((a, b) => a - b)[0];
      if (firstQueryIndex !== undefined) {
        expect(guardIndex, relative(process.cwd(), path)).toBeLessThan(firstQueryIndex);
      }
    }
  });
});
