import {
  Chart as ChartJS,
  Filler,
  Legend,
  LineElement,
  PointElement,
  type Plugin,
  RadialLinearScale,
  Tooltip
} from "chart.js";
import { Radar } from "react-chartjs-2";
import type { RadarStats } from "./shared/types";

ChartJS.register(RadialLinearScale, PointElement, LineElement, Filler, Tooltip, Legend);

const labels = ["文笔", "逻辑", "分享性", "机制", "反转", "深度"];

const radarScoreLabels: Plugin<"radar"> = {
  id: "radarScoreLabels",
  afterDatasetsDraw(chart) {
    const scale = chart.scales.r as RadialLinearScale & {
      xCenter: number;
      yCenter: number;
      getPointPositionForValue: (index: number, value: number) => { x: number; y: number };
    };
    const dataset = chart.data.datasets[0];
    if (!scale || !dataset) return;

    const { ctx } = chart;
    ctx.save();
    ctx.font = "700 12px PingFang SC, Microsoft YaHei, Arial, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    dataset.data.forEach((rawValue, index) => {
      const value = Number(rawValue);
      if (!Number.isFinite(value) || value <= 0) return;

      const point = scale.getPointPositionForValue(index, value);
      const dx = point.x - scale.xCenter;
      const dy = point.y - scale.yCenter;
      const distance = Math.hypot(dx, dy) || 1;
      // 高分会合并在每个维度顶点上的线从外面拉回来，得分 >= 4.1 时数字放在顶点内侧
      const offset = value >= 4.1 ? -6 : 18;
      const labelX = point.x + (dx / distance) * offset;
      const labelY = point.y + (dy / distance) * offset;
      const text = Number.isInteger(value) ? String(value) : value.toFixed(1);

      ctx.fillStyle = "#2563EB";
      ctx.fillText(text, labelX, labelY + 0.5);
    });

    ctx.restore();
  }
};

export function RadarChart({ radar, compact = false }: { radar: RadarStats; compact?: boolean }) {
  const values = [radar.writing, radar.logic, radar.share, radar.mechanism, radar.twist, radar.depth];
  const hasData = values.some((value) => value != null);

  if (!hasData) {
    return (
      <div className="flex h-full min-h-32 items-center justify-center rounded-lg border border-dashed border-line bg-slate-50 text-sm text-muted">
        暂无维度评分
      </div>
    );
  }

  return (
    <div className={compact ? "relative h-full min-h-24" : "relative h-full min-h-0"}>
      <Radar
        plugins={[radarScoreLabels]}
        data={{
          labels,
          datasets: [
            {
              label: "六维均分",
              data: values.map((value) => value ?? 0),
              backgroundColor: "rgba(37, 99, 235, 0.16)",
              borderColor: "#2563EB",
              borderWidth: 2,
              pointBackgroundColor: "#14B8A6"
            }
          ]
        }}
        options={{
          responsive: true,
          maintainAspectRatio: false,
          layout: { padding: compact ? 8 : { top: 18, right: 22, bottom: 18, left: 22 } },
          plugins: { legend: { display: false } },
          scales: {
            r: {
              min: 0,
              max: 5,
              ticks: { stepSize: 1, display: false },
              pointLabels: {
                padding: compact ? 4 : 6,
                font: { size: compact ? 9 : 11 },
                color: "#64748B"
              },
              grid: { color: "#E2E8F0" },
              angleLines: { color: "#E2E8F0" }
            }
          }
        }}
      />
    </div>
  );
}
