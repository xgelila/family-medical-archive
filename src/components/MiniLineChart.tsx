/** 极简 SVG 折线图（仅用于“单位一致、可比较”的数值系列；不可比场景绝不连线）。 */

export interface ChartDatum {
  date: string;
  value: number;
}

interface Props {
  data: ChartDatum[];
  unit: string;
  height?: number;
  width?: number;
}

export function MiniLineChart({ data, unit, height = 200, width = 560 }: Props) {
  const pts = data.filter((d) => Number.isFinite(d.value));
  if (pts.length === 0) return null;
  const padX = 46;
  const padTop = 18;
  const padBottom = 30;
  const innerW = Math.max(width - padX * 2, 40);
  const innerH = Math.max(height - padTop - padBottom, 40);

  const values = pts.map((p) => p.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const xMax = Math.max(1, pts.length - 1);

  const coords = pts.map((p, i) => ({
    x: padX + (xMax === 0 ? innerW / 2 : (i / xMax) * innerW),
    y: padTop + innerH - ((p.value - min) / span) * innerH,
    date: p.date,
    value: p.value,
  }));

  const path = coords
    .map((c, i) => `${i === 0 ? 'M' : 'L'}${c.x.toFixed(1)},${c.y.toFixed(1)}`)
    .join(' ');
  // 刻度必须与数据点使用同一索引坐标；最多显示 6 个，避免长日期互相覆盖。
  const tickCount = Math.min(6, coords.length);
  const tickIndices = Array.from({ length: tickCount }, (_, i) =>
    tickCount === 1 ? 0 : Math.round((i * (coords.length - 1)) / (tickCount - 1)),
  ).filter((index, i, all) => all.indexOf(index) === i);

  return (
    <svg
      width="100%"
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={`趋势图（单位：${unit || '未填写'}）`}
      style={{ maxHeight: height, display: 'block' }}
    >
      <line x1={padX} y1={padTop} x2={padX} y2={padTop + innerH} stroke="#c6bfb3" strokeWidth="1" />
      <line
        x1={padX}
        y1={padTop + innerH}
        x2={padX + innerW}
        y2={padTop + innerH}
        stroke="#c6bfb3"
        strokeWidth="1"
      />
      {[0, 0.25, 0.5, 0.75, 1].map((f) => {
        const y = padTop + innerH - f * innerH;
        const v = (min + f * span).toFixed(1);
        return (
          <g key={f}>
            <line
              x1={padX}
              y1={y}
              x2={padX + innerW}
              y2={y}
              stroke="#e6e0d4"
              strokeWidth="1"
              strokeDasharray="3 3"
            />
            <text x={padX - 6} y={y + 3} textAnchor="end" fontSize="10" fill="#7e766c">
              {v}
            </text>
          </g>
        );
      })}
      {coords.length > 1 && (
        <path d={path} fill="none" stroke="#7b6ec7" strokeWidth="2" strokeLinejoin="round" />
      )}
      {coords.map((c, i) => (
        <g key={i}>
          <circle cx={c.x} cy={c.y} r="4" fill="#7b6ec7" stroke="#fff" strokeWidth="1.5" />
          <text
            x={c.x}
            y={c.y - 9}
            textAnchor="middle"
            fontSize="10"
            fill="#4a453f"
            style={{ pointerEvents: 'none' }}
          >
            {c.date} · {c.value}
          </text>
        </g>
      ))}
      {tickIndices.map((index) => (
        <text
          key={`${index}-${pts[index].date}`}
          x={coords[index].x}
          y={height - 8}
          textAnchor={index === 0 ? 'start' : index === coords.length - 1 ? 'end' : 'middle'}
          fontSize="10"
          fill="#7e766c"
        >
          {pts[index].date}
        </text>
      ))}
    </svg>
  );
}
