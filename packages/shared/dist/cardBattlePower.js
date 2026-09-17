/** Rates use percentage points (10 = 10%, 150 = 150% critical damage).
 * Missing fields in legacy snapshots use the battle engine's defaults.
 * Round only the final per-card sum; team power sums these rounded values.
 */
export function calculateCardBattlePower(stats) {
    // Percentage fields support two decimal places. Represent them as integer
    // hundredths and power in twentieths so e.g. 500.5 cannot drift below the tie.
    const hundredths = (value) => Math.round(value * 100);
    const twentieths = stats.maxHp * 10
        + stats.attack * 40
        + stats.defense * 60
        + stats.speed * 60
        + hundredths(stats.critRate ?? 25) * 3
        + hundredths(stats.critDamage ?? 150) - 10000
        + hundredths(stats.lifestealRate ?? 0) * 4
        + hundredths(stats.extraActionRate ?? 0) * 6
        + hundredths(stats.dodgeRate ?? 0) * 6
        + hundredths(stats.stunRate ?? 0) * 6
        + hundredths(stats.counterRate ?? 0) * 6
        - stats.energyRequired * 400;
    return Math.round(twentieths / 20);
}
