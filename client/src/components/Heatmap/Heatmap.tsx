import { useMemo } from 'react';
import { HeatmapEntry } from '../../types';
import styles from './Heatmap.module.css';

interface HeatmapProps {
  data: HeatmapEntry[];
}

function Heatmap({ data }: HeatmapProps) {
  const { cells, maxCount } = useMemo(() => {
    const map = new Map<string, number>();
    let max = 0;
    for (const entry of data) {
      map.set(entry.date, entry.count);
      if (entry.count > max) max = entry.count;
    }

    // Generate last 90 days
    const cells: { date: string; count: number }[] = [];
    const today = new Date();
    for (let i = 89; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().split('T')[0];
      cells.push({ date: dateStr, count: map.get(dateStr) || 0 });
    }

    return { cells, maxCount: max };
  }, [data]);

  function getIntensity(count: number): string {
    if (count === 0) return styles.level0;
    if (maxCount === 0) return styles.level0;
    const ratio = count / maxCount;
    if (ratio <= 0.25) return styles.level1;
    if (ratio <= 0.5) return styles.level2;
    if (ratio <= 0.75) return styles.level3;
    return styles.level4;
  }

  return (
    <div className={styles.heatmap}>
      <div className={styles.grid}>
        {cells.map(cell => (
          <div
            key={cell.date}
            className={`${styles.cell} ${getIntensity(cell.count)}`}
            title={`${cell.date}: ${cell.count} runs`}
          />
        ))}
      </div>
    </div>
  );
}

export default Heatmap;
