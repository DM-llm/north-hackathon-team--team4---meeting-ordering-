import type { BusinessResult } from '../types';

interface ConflictMessageProps {
  result: BusinessResult | null;
}

export default function ConflictMessage(props: ConflictMessageProps) {
  const { result } = props;

  if (!result) {
    return null;
  }

  const className = result.status === 'success' ? 'message success' : result.status === 'conflict' ? 'message conflict' : result.status === 'failed' ? 'message error' : 'message warning';

  return (
    <div className={className} role="status">
      <strong>{result.status}</strong>
      <span>{result.message}</span>
    </div>
  );
}
