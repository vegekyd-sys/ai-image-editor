export type AgentPerfData = Record<string, string | number | boolean | null | undefined>;

export class AgentPerf {
  private readonly startMs = Date.now();
  private readonly traceId: string;

  constructor(
    private readonly name: string,
    data: AgentPerfData = {},
  ) {
    this.traceId = `${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 8)}`;
    this.mark('start', data);
  }

  get id() {
    return this.traceId;
  }

  elapsedMs() {
    return Date.now() - this.startMs;
  }

  mark(name: string, data: AgentPerfData = {}) {
    this.log('mark', name, data);
  }

  span(name: string, data: AgentPerfData = {}) {
    const startedAt = Date.now();
    this.log('span_start', name, data);
    return (endData: AgentPerfData = {}) => {
      this.log('span_end', name, {
        ...data,
        ...endData,
        durationMs: Date.now() - startedAt,
      });
    };
  }

  private log(event: string, point: string, data: AgentPerfData) {
    console.log(`[agent-perf] ${JSON.stringify({
      traceId: this.traceId,
      name: this.name,
      event,
      point,
      elapsedMs: this.elapsedMs(),
      ...data,
    })}`);
  }
}
