interface AgentProviderGroupHeaderProps {
  provider: 'azure' | 'codex' | 'grok' | 'other';
  label: string;
  detail: string;
  remainingLabel?: string;
  resetLabel?: string;
  progress?: number;
  usageTestId?: string;
}

export default function AgentProviderGroupHeader({
  provider,
  label,
  detail,
  remainingLabel,
  resetLabel,
  progress,
  usageTestId,
}: AgentProviderGroupHeaderProps) {
  const hasPersonalQuota = (provider === 'codex' || provider === 'grok')
    && remainingLabel
    && resetLabel;

  return (
    <div className="mkr-agent-model-group-header" data-agent-provider-group={provider}>
      <span className="mkr-agent-model-group-identity">
        {(provider === 'codex' || provider === 'grok') && (
          <span className="mkr-agent-model-group-signal" aria-hidden="true" />
        )}
        <span className="mkr-agent-model-group-title">{label}</span>
      </span>
      {hasPersonalQuota ? (
        <>
          <span
            className="mkr-agent-model-group-quota"
            data-testid={usageTestId}
          >
            {remainingLabel}
          </span>
          <span className="mkr-agent-model-group-detail mkr-agent-model-group-reset">
            {resetLabel}
          </span>
        </>
      ) : (
        <span
          className="mkr-agent-model-group-detail"
          data-testid={usageTestId}
        >
          {detail}
        </span>
      )}
      {typeof progress === 'number' && (
        <span className="mkr-agent-model-group-track" aria-hidden="true">
          <span style={{ width: `${Math.max(0, Math.min(100, progress))}%` }} />
        </span>
      )}
    </div>
  );
}
