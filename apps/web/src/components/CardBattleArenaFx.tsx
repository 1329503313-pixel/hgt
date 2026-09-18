import { useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { useCardBattleFx } from "./CardBattleFxContext";
import { cardBattleImpactMs, eventFx } from "../shared/cardBattleFx";
import { isCardBattleAnimation, seekCardBattleAnimations } from "../shared/cardBattlePlayback";
import type { OnlineCardBattleEvent } from "../shared/types";

type Point = { x: number; y: number; width: number; height: number; seat: string };
type Geometry = { width: number; height: number; source?: Point; targets: Point[]; bond?: [Point, Point] };
export function CardBattleArenaFx({ event }: { event: OnlineCardBattleEvent | null }) {
  const ref = useRef<HTMLDivElement>(null);
  const { quality, reduced, visible, elapsedMs, getElapsedMs, playing, eventKey } = useCardBattleFx();
  const [geometry, setGeometry] = useState<Geometry | null>(null);
  useLayoutEffect(() => {
    const arena = ref.current?.closest<HTMLElement>("[data-battle-arena]");
    if (!arena || !event) { setGeometry(null); return; }
    const measure = () => {
      const rect = arena.getBoundingClientRect();
      const points = new Map<string, Point>();
      arena.querySelectorAll<HTMLElement>("[data-battle-anchor]").forEach(el => {
        const r = el.getBoundingClientRect();
        points.set(el.dataset.battleAnchor!, { x: r.left - rect.left + arena.scrollLeft + r.width / 2, y: r.top - rect.top + arena.scrollTop + r.height / 2, width: r.width, height: r.height, seat: el.dataset.battleSeat ?? "" });
      });
      const source = points.get(event.actorId ?? "");
      const targets = [...new Set(event.effects.filter(e => !e.dodged).map(e => e.targetId))].flatMap(id => points.has(id) ? [points.get(id)!] : []);
      const owner = points.get(event.bond?.ownerId ?? ""), trigger = points.get(event.bond?.triggerId ?? "");
      setGeometry({ width: arena.clientWidth, height: arena.scrollHeight, source, targets, bond: owner && trigger && owner !== trigger ? [owner, trigger] : undefined });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(arena);
    arena.querySelectorAll<HTMLElement>("[data-battle-anchor]").forEach(el => observer.observe(el));
    return () => observer.disconnect();
  }, [event?.sequence, event?.actorId, eventKey]);
  useLayoutEffect(() => {
    if (!ref.current) return;
    const arena = ref.current.closest<HTMLElement>('[data-battle-arena]') ?? ref.current;
    seekCardBattleAnimations(arena, getElapsedMs());
    if (!playing || !visible) arena.getAnimations({ subtree: true }).filter(isCardBattleAnimation).forEach(a => a.pause());
  }, [event?.sequence, geometry, elapsedMs, playing, visible, quality, reduced]);
  if (!event || !visible || !geometry || reduced || !['attack', 'skill', 'extra_action'].includes(event.kind)) return <div ref={ref} />;
  const { source, targets, bond } = geometry;
  const recipe = eventFx(event);
  const impact = cardBattleImpactMs(event.durationMs);
  const groups = [...new Set(targets.map(p => p.seat))].map(seat => targets.filter(p => p.seat === seat)).filter(g => g.length > 1);
  const connection = (a: Point, b: Point) => {
    const midX=(a.x+b.x)/2, midY=(a.y+b.y)/2;
    if (recipe.family === 'lightning') return `M${a.x} ${a.y}L${midX-12} ${midY-10}L${midX+12} ${midY+10}L${b.x} ${b.y}`;
    return `M${a.x} ${a.y}Q${midX+24} ${recipe.pattern==='rear'?Math.min(a.y,b.y)-b.height/2:recipe.pattern==='front'?b.y:midY} ${b.x} ${b.y}`;
  };
  return <div ref={ref} className="card-battle-arena-fx" aria-hidden="true" style={{ height: geometry.height, '--skill-color': recipe.color, '--skill-duration': event.durationMs+'ms', '--fx-impact': impact+'ms', '--fx-tail': Math.max(1,event.durationMs-impact)+'ms' } as CSSProperties}>
    <svg key={event.sequence} width={geometry.width} height={geometry.height} data-quality={quality}>
      {bond && <path className="card-battle-fx-link is-bond" d={connection(...bond)} pathLength="1" />}
      {source && event.visual !== 'damage' && quality === 'standard' && <path className="card-battle-fx-link" d={targets.filter(p=>p.x!==source.x || p.y!==source.y).map(p=>connection(source,p)).join(' ')} pathLength="1" />}
      {source && targets.length > 0 && Boolean(event.lifesteal) && quality === 'standard' && <path className="card-battle-fx-link is-blood-return" d={connection({ ...targets[0], x:targets.reduce((n,p)=>n+p.x,0)/targets.length, y:targets.reduce((n,p)=>n+p.y,0)/targets.length },source)} pathLength="1" />}
    </svg>
    {groups.map((g,i)=>{ const x=Math.min(...g.map(p=>p.x-p.width/2)), y=Math.min(...g.map(p=>p.y-p.height/2)); const w=Math.max(...g.map(p=>p.x+p.width/2))-x, h=Math.max(...g.map(p=>p.y+p.height/2))-y; return <i key={event.sequence+':wave'+i} data-fx-wave="shared" className="card-battle-fx-group-wave" style={{left:x-8,top:y-8,width:w+16,height:h+16}} />; })}
  </div>;
}
