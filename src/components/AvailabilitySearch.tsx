import type { ChangeEvent, Dispatch, SetStateAction } from 'react';
import ConflictMessage from './ConflictMessage';
import type { BusinessResult, RoomId, TimeRange } from '../types';

interface AvailabilityFormState {
  date: string;
  start: string;
  end: string;
}

interface AvailabilitySearchProps {
  input: AvailabilityFormState;
  onChange: Dispatch<SetStateAction<AvailabilityFormState>>;
  onSearch: () => void;
  result: BusinessResult | null;
}

interface AvailabilitySlot {
  roomId: RoomId;
  name: string;
  capacity?: number;
  status: 'active' | 'inactive';
  sourceRoomIds?: RoomId[];
  available: boolean;
  unavailableReasons: string[];
}

interface AvailabilityData {
  date?: string;
  range?: TimeRange;
  available?: AvailabilitySlot[];
  all?: AvailabilitySlot[];
}

function getAvailabilityData(result: BusinessResult | null): AvailabilityData {
  if (!result?.data || typeof result.data !== 'object') {
    return {};
  }

  return result.data as AvailabilityData;
}

function handleDateChange(event: ChangeEvent<HTMLInputElement>, onChange: Dispatch<SetStateAction<AvailabilityFormState>>): void {
  onChange((current) => ({ ...current, date: event.target.value }));
}

function handleTimeChange(
  field: 'start' | 'end',
  event: ChangeEvent<HTMLInputElement>,
  onChange: Dispatch<SetStateAction<AvailabilityFormState>>,
): void {
  onChange((current) => ({ ...current, [field]: event.target.value }));
}

export default function AvailabilitySearch(props: AvailabilitySearchProps) {
  const { input, onChange, onSearch, result } = props;
  const data = getAvailabilityData(result);
  const availableSlots = data.available ?? [];
  const allSlots = data.all ?? [];

  return (
    <div className="panel-content">
      <div className="section-heading">
        <div>
          <h2>查询可用会议室</h2>
          <p>选择日期与时段，业务服务会基于当前预约、不可预约规则和动态禁用状态返回真实结果。</p>
        </div>
      </div>

      <div className="form-grid two-columns">
        <label>
          <span>日期</span>
          <input type="date" value={input.date} onChange={(event) => handleDateChange(event, onChange)} />
        </label>
        <label>
          <span>开始时间</span>
          <input type="time" value={input.start} onChange={(event) => handleTimeChange('start', event, onChange)} />
        </label>
        <label>
          <span>结束时间</span>
          <input type="time" value={input.end} onChange={(event) => handleTimeChange('end', event, onChange)} />
        </label>
      </div>

      <button className="primary-button" type="button" onClick={onSearch}>
        查询可用资源
      </button>

      <ConflictMessage result={result} />

      {result && result.status === 'success' ? (
        <div className="result-stack">
          <section>
            <h3>可用资源（{availableSlots.length}）</h3>
            {availableSlots.length === 0 ? <p className="empty-text">当前条件下没有可用资源。</p> : null}
            <div className="result-list">
              {availableSlots.map((slot) => (
                <article className="result-item" key={slot.roomId}>
                  <div>
                    <strong>{slot.name}</strong>
                    <p>{slot.capacity ? `容量 ${slot.capacity}` : '容量未知'}{slot.sourceRoomIds ? ` · 来源：${slot.sourceRoomIds.join(' + ')}` : ''}</p>
                  </div>
                  <span className="status-pill active">可预约</span>
                </article>
              ))}
            </div>
          </section>

          {allSlots.length > 0 ? (
            <section>
              <h3>全部资源状态</h3>
              <div className="result-list">
                {allSlots.map((slot) => (
                  <article className={`result-item ${slot.available ? 'success' : 'warning'}`} key={slot.roomId}>
                    <div>
                      <strong>{slot.name}</strong>
                      <p>{slot.sourceRoomIds ? `来源：${slot.sourceRoomIds.join(' + ')} · ` : null}{slot.capacity ? `容量 ${slot.capacity}` : '容量未知'}</p>
                      {slot.unavailableReasons.length > 0 ? <p className="reason-text">{slot.unavailableReasons.join('；')}</p> : null}
                    </div>
                    <span className={`status-pill ${slot.available ? 'active' : 'inactive'}`}>{slot.available ? '可预约' : '不可预约'}</span>
                  </article>
                ))}
              </div>
            </section>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
