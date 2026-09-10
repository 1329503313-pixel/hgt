/** Direct damage effects use this prefix, including future target variants. */
export declare function isCardBattleDamageEffect(type: string): boolean;
export type CardBattleDamageOptions = {
    /** 0–100 percent of the target's effective defense ignored for this hit only. Old snapshots default to 0. */
    ignoreDefensePercent?: number;
};
