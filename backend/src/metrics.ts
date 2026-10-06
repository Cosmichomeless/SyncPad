type Labels = Record<string, string | number>;

const DEFAULT_BUCKETS = [1, 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000];

const series = (name: string, labels?: Labels) => {
  const entries = Object.entries(labels ?? {});
  if (!entries.length) return name;
  return `${name}{${entries.map(([key, value]) => `${key}="${String(value).replace(/[\\"\n]/g, '_')}"`).join(',')}}`;
};

type Histogram = { buckets: number[]; counts: number[]; sum: number; count: number };

/** Minimal in-process metrics in Prometheus text format; no labels ever carry note or user data. */
export function createMetrics() {
  const counters = new Map<string, number>();
  const histograms = new Map<string, Histogram>();
  const gauges = new Map<string, () => number>();
  const help = new Map<string, string>();

  return {
    describe(name: string, text: string) { help.set(name, text); },
    inc(name: string, labels?: Labels, by = 1) {
      const key = series(name, labels);
      counters.set(key, (counters.get(key) ?? 0) + by);
    },
    counter(name: string, labels?: Labels) { return counters.get(series(name, labels)) ?? 0; },
    gauge(name: string, read: () => number) { gauges.set(name, read); },
    observe(name: string, value: number, buckets: number[] = DEFAULT_BUCKETS) {
      let histogram = histograms.get(name);
      if (!histogram) {
        histogram = { buckets, counts: buckets.map(() => 0), sum: 0, count: 0 };
        histograms.set(name, histogram);
      }
      histogram.sum += value;
      histogram.count++;
      histogram.buckets.forEach((bound, index) => { if (value <= bound) histogram.counts[index]++; });
    },
    histogram(name: string) { return histograms.get(name); },
    render() {
      const lines: string[] = [];
      const header = (name: string, type: string) => {
        const text = help.get(name);
        if (text) lines.push(`# HELP ${name} ${text}`);
        lines.push(`# TYPE ${name} ${type}`);
      };
      const seen = new Set<string>();
      for (const [key, value] of [...counters].sort(([a], [b]) => a.localeCompare(b))) {
        const name = key.split('{')[0];
        if (!seen.has(name)) { seen.add(name); header(name, 'counter'); }
        lines.push(`${key} ${value}`);
      }
      for (const [name, read] of gauges) {
        header(name, 'gauge');
        lines.push(`${name} ${read()}`);
      }
      for (const [name, histogram] of histograms) {
        header(name, 'histogram');
        histogram.buckets.forEach((bound, index) => lines.push(`${name}_bucket{le="${bound}"} ${histogram.counts[index]}`));
        lines.push(`${name}_bucket{le="+Inf"} ${histogram.count}`, `${name}_sum ${histogram.sum}`, `${name}_count ${histogram.count}`);
      }
      return lines.join('\n') + '\n';
    },
  };
}

export type Metrics = ReturnType<typeof createMetrics>;
