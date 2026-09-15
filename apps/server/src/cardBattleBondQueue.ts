import type { CardBattleBond, CardBattleBondEvent } from "@hgt/shared";
type BondCard = { instanceId: string; cardNo?: string; seat: number; tier: { bonds?: CardBattleBond[] } };
/** Jobs retain the actual triggering instance. A whole causal chain shares one visited set. */
export function createCardBattleBondQueue<Card extends BondCard>(cards: () => Card[], canAct: (card: Card) => boolean) {
  type Job = { owner: Card; trigger: Card; bond: CardBattleBond; root: number; index: number };
  const pending: Job[] = [];
  const chains = new Map<number, Set<string>>();
  let draining = false;
  const chain = (root: number) => {
    if (!chains.has(root)) chains.set(root, new Set());
    return chains.get(root)!;
  };
  return {
    inherit(parent: number, child: number) { chains.set(child, chain(parent)); },
    emit(event: CardBattleBondEvent, trigger: Card, root: number) {
      if (!trigger.cardNo) return; // Older frozen lineups do not invent catalog numbers.
      for (const owner of cards()) {
        if (owner.seat !== trigger.seat || !canAct(owner)) continue;
        for (const [index, bond] of (owner.tier.bonds ?? []).entries()) {
          if (bond.event !== event || !bond.cardNos.includes(trigger.cardNo)) continue;
          const key = `${owner.instanceId}:${index}`;
          if (chain(root).has(key)) continue;
          chain(root).add(key);
          pending.push({owner, trigger, bond, root, index});
        }
      }
    },
    drain(execute: (job: Job) => void, stopped: () => boolean) {
      if (draining) return;
      draining = true;
      try {
        while (pending.length && !stopped()) {
          const job = pending.shift()!;
          if (canAct(job.owner)) execute(job);
        }
      } finally { draining = false; }
    },
  };
}
