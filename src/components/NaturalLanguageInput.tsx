import type { Dispatch, SetStateAction } from 'react';
import ConflictMessage from './ConflictMessage';
import type { BusinessResult, StructuredIntent } from '../types';

interface NaturalLanguageInputProps {
  text: string;
  onChange: Dispatch<SetStateAction<string>>;
  onSubmit: () => void;
  result: BusinessResult | null;
  summary: string;
  intent?: StructuredIntent | null;
}

function formatIntent(intent: StructuredIntent): string {
  return `${intent.action} · ${intent.actorRole} · ${intent.entities ? Object.keys(intent.entities).join('、') : '无 entities'}`;
}

export default function NaturalLanguageInput(props: NaturalLanguageInputProps) {
  const { text, onChange, onSubmit, result, summary, intent } = props;

  return (
    <div className="panel-content natural-language-panel">
      <div className="section-heading">
        <div>
          <h2>自然语言输入框</h2>
          <p>前端只访问 API Server：先调用 /api/agent/query 解析意图，再通过 /api/intents/execute 执行业务状态变更。</p>
        </div>
        <span className="mode-pill">API Server</span>
      </div>

      <textarea
        value={text}
        rows={4}
        placeholder="例如：帮我查下周二 10 点到 11 点可用的小会议室"
        onChange={(event) => onChange(event.target.value)}
      />

      <div className="form-actions">
        <button className="primary-button" type="button" onClick={onSubmit}>
          执行自然语言
        </button>
        {summary ? <span className="hint-text parsed-summary">{summary}</span> : null}
      </div>

      {intent ? (
        <div className="reason-list">
          <strong>Agent 解析结果</strong>
          <p className="hint-text">{formatIntent(intent)}</p>
          <pre className="reason-text">{JSON.stringify(intent, null, 2)}</pre>
        </div>
      ) : null}

      <ConflictMessage result={result} />
    </div>
  );
}
