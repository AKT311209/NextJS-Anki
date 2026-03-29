export function useSearch() {
  return {
    query: "",
    results: [] as Array<{ id: number }>,
  };
}
