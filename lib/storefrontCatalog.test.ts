import { describe, expect, it } from 'vitest';
import { filterStorefrontGames } from './storefrontCatalog';

const games = [
  { name: 'Mobile Legends', short_name: 'MLBB', is_featured: true },
  { name: 'PUBG Mobile', short_name: 'PUBG', is_featured: true },
  { name: 'Valorant', short_name: 'VAL', is_featured: false },
];

describe('filterStorefrontGames', () => {
  it('returns the full catalog for an empty all-games query', () => {
    expect(filterStorefrontGames(games, '', 'all')).toHaveLength(3);
  });

  it('matches names and short names without case sensitivity', () => {
    expect(filterStorefrontGames(games, 'mlbb', 'all').map((game) => game.name)).toEqual(['Mobile Legends']);
    expect(filterStorefrontGames(games, ' pubg ', 'all').map((game) => game.name)).toEqual(['PUBG Mobile']);
  });

  it('limits the catalog to featured games when requested', () => {
    expect(filterStorefrontGames(games, '', 'featured').map((game) => game.name)).toEqual(['Mobile Legends', 'PUBG Mobile']);
  });

  it('combines the featured filter and search query', () => {
    expect(filterStorefrontGames(games, 'val', 'featured')).toEqual([]);
  });
});
