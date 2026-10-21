export type StorefrontCatalogFilter = 'all' | 'featured';

type CatalogGame = {
  name: string;
  short_name: string;
  is_featured: boolean;
};

export function filterStorefrontGames<T extends CatalogGame>(games: T[], query: string, filter: StorefrontCatalogFilter): T[] {
  const normalizedQuery = query.trim().toLowerCase();
  return games.filter((game) => {
    const matchesFilter = filter === 'all' || game.is_featured;
    const matchesQuery = !normalizedQuery || `${game.name} ${game.short_name}`.toLowerCase().includes(normalizedQuery);
    return matchesFilter && matchesQuery;
  });
}
