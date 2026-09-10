/** Direct damage effects use this prefix, including future target variants. */
export function isCardBattleDamageEffect(type) {
    return type.startsWith("damage_");
}
