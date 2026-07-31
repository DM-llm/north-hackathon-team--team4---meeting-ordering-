import type { BusinessResult } from '../types';

interface BusinessResultPanelProps {
  results: BusinessResult[];
}

function statusLabel(status: BusinessResult['status']): string {
  const labels: Record<BusinessResult['status'], string> = {
    success: '成功',
    failed: '失败',
    conflict: '冲突',
    notFound: '未找到',
  };

  return labels[status];
}

function statusClass(status: BusinessResult['status']): string {
  return status === 'success' ? 'active' : status === 'conflict' ? 'inactive' : status === 'notFound' ? 'warning' : 'inactive';
}

export default function BusinessResultPanel(props: BusinessResultPanelProps) {
  const { results } = props;

  return (
    <div className="panel-content">
      <div className="section-heading">
        <div>
          <h2>业务结果与冲突原因</h2>
          <p>展示最近由 API Server 写入的业务结果，包括 Agent 意图执行后的成功、失败、冲突和未找到状态。</p>
        </div>
        <span className="count-badge">{results.length} 条</span>
      </div>

      {results.length === 0 ? <p className="empty-text">暂无业务结果，可以先执行一条自然语言请求。</p> : null}

      <div className="result-list">
        {results.map((result) => (
          <article className={`result-item ${result.status === 'success' ? 'success' : result.status === 'conflict' ? 'warning' : 'muted'}`} key={result.id}>
            <div>
              <div className="result-item-title-row">
                <strong>{statusLabel(result.status)}</strong>
                <span className={`status-pill ${statusClass(result.status)}`}>{result.status}</span>
              </div>
              <p>{result.message}</p>
              <p className="hint-text">{result.createdAt}</p>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
