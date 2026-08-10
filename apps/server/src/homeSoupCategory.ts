export const homeSoupCategories = ["recommended", "latest", "following", "ai", "played"] as const;

export type HomeSoupCategory = (typeof homeSoupCategories)[number];

export function parseHomeSoupCategory(value: unknown): HomeSoupCategory {
  const normalized = String(value ?? "recommended");
  return homeSoupCategories.includes(normalized as HomeSoupCategory)
    ? normalized as HomeSoupCategory
    : "recommended";
}

export function homeSoupCategoryRequiresAuth(category: HomeSoupCategory) {
  return category === "following" || category === "played";
}

export function homeSoupCategoryOrder(category: HomeSoupCategory): "default" | "latest" | "random" {
  if (category === "latest" || category === "following") return "latest";
  if (category === "ai" || category === "played") return "random";
  return "default";
}
