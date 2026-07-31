import type { ChangeEvent, Dispatch, SetStateAction } from 'react';
import ConflictMessage from './ConflictMessage';
import type { BusinessResult, RoomId, RoomStatus } from '../types';

interface ResourceOption {
  id: RoomId;
  name: string;
  capacity?: number;
  sourceRoomIds?: RoomId[];
  status: RoomStatus;
}

interface BookingFormState {
  roomId: RoomId;
  title: string;
  organizer: string;
  date: string;
  start: string;
  end: string;
}

interface BookingFormProps {
  resources: ResourceOption[];
  form: BookingFormState;
  onChange: Dispatch<SetStateAction<BookingFormState>>;
  onCreate: () => void;
  result: BusinessResult | null;
}

function handleTextChange(
  field: keyof BookingFormState,
  event: ChangeEvent<HTMLInputElement | HTMLSelectElement>,
  onChange: Dispatch<SetStateAction<BookingFormState>>,
): void {
  onChange((current) => ({ ...current, [field]: event.target.value }));
}

function handleTimeChange(
  field: 'start' | 'end',
  event: ChangeEvent<HTMLInputElement>,
  onChange: Dispatch<SetStateAction<BookingFormState>>,
): void {
  onChange((current) => ({ ...current, [field]: event.target.value }));
}

export default function BookingForm(props: BookingFormProps) {
  const { resources, form, onChange, onCreate, result } = props;
  const activeResources = resources.filter((resource) => resource.status === 'active');

  return (
    <div className="panel-content">
      <div className="section-heading">
        <div>
          <h2>创建预约</h2>
          <p>提交后调用业务服务创建预约；如果与已有预约或规则冲突，会返回明确错误原因。</p>
        </div>
      </div>

      <div className="form-grid">
        <label>
          <span>房间</span>
          <select value={form.roomId} onChange={(event) => handleTextChange('roomId', event, onChange)}>
            {activeResources.length === 0 ? <option value="">暂无可用房间</option> : null}
            {activeResources.map((resource) => (
              <option key={resource.id} value={resource.id}>
                {resource.name}{resource.sourceRoomIds ? `（${resource.sourceRoomIds.join(' + ')}）` : ''}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>标题</span>
          <input type="text" value={form.title} placeholder="例如：项目周会" onChange={(event) => handleTextChange('title', event, onChange)} />
        </label>
        <label>
          <span>组织者</span>
          <input type="text" value={form.organizer} placeholder="例如：张三" onChange={(event) => handleTextChange('organizer', event, onChange)} />
        </label>
        <label>
          <span>日期</span>
          <input type="date" value={form.date} onChange={(event) => handleTextChange('date', event, onChange)} />
        </label>
        <label>
          <span>开始时间</span>
          <input type="time" value={form.start} onChange={(event) => handleTimeChange('start', event, onChange)} />
        </label>
        <label>
          <span>结束时间</span>
          <input type="time" value={form.end} onChange={(event) => handleTimeChange('end', event, onChange)} />
        </label>
      </div>

      <button className="primary-button" type="button" onClick={onCreate} disabled={activeResources.length === 0}>
        创建预约
      </button>

      <ConflictMessage result={result} />
    </div>
  );
}
