export const emptyCardTowerFormations = () => Array.from({ length: 3 }, () => ({ cardIds: Array(5).fill(null), collectibleBindings: [] }));
/** The most recent formation operation owns every selected card and collectible. */
export function replaceCardTowerFormation(formations, index, incoming) {
    const cardIds = new Set(incoming.cardIds.filter(Boolean));
    const collectibleIds = new Set(incoming.collectibleBindings.map((binding) => binding.collectibleId));
    return formations.map((formation, i) => {
        if (i === index)
            return { cardIds: [...incoming.cardIds], collectibleBindings: incoming.collectibleBindings.map((binding) => ({ ...binding })) };
        const nextIds = formation.cardIds.map((id) => id && cardIds.has(id) ? null : id);
        return { cardIds: nextIds, collectibleBindings: formation.collectibleBindings.filter((binding) => nextIds.includes(binding.cardId) && !collectibleIds.has(binding.collectibleId)) };
    });
}
export function cardTowerFormationError(formations) {
    if (formations.length !== 3 || formations.some((formation) => formation.cardIds.length !== 5))
        return "需要三个五卡阵容";
    const cards = formations.flatMap((formation) => formation.cardIds.filter((id) => Boolean(id)));
    if (!cards.length)
        return "至少配置一个完整的五卡阵容才能开始";
    if (new Set(cards).size !== cards.length)
        return "三个阵容不能重复使用同一张卡牌";
    if (formations.some((formation) => formation.cardIds.some(Boolean) && !formation.cardIds.every(Boolean)))
        return "每个阵容必须选满五张卡，或清空该阵容";
    const bindings = formations.flatMap((formation) => formation.collectibleBindings);
    if (new Set(bindings.map((binding) => binding.collectibleId)).size !== bindings.length)
        return "三个阵容不能重复装配同一件收藏品";
    return null;
}
