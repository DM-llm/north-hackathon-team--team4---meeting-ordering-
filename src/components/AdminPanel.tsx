import type { ChangeEvent, Dispatch, SetStateAction } from 'react';
import ConflictMessage from './ConflictMessage';
import type { Booking, BusinessResult, MergedRoom, Room, RoomId, UnavailabilityRule } from '../types';

interface DisableFormState {
  roomId: RoomId;
  reason: string;
  date: string;
  start: string;
  end: string;
}

interface RuleFormState {
  roomId: RoomId;
  title: string;
  date: string;
  start: string;
  end: string;
}

interface AdminPanelProps {
  rooms: Room[];
  mergedRooms: MergedRoom[];
  rules: UnavailabilityRule[];
  disableForm: DisableFormState;
  onDisableFormChange: Dispatch<SetStateAction<DisableFormState>>;
  enableRoomId: RoomId;
  onEnableRoomIdChange: Dispatch<SetStateAction<RoomId>>;
  ruleForm: RuleFormState;
  onRuleFormChange: Dispatch<SetStateAction<RuleFormState>>;
  activeDynamicRoomIds: RoomId[];
  confirmedBookings: Booking[];
  result: BusinessResult | null;
  onDynamicDisable: () => void;
  onDynamicEnable: () => void;
  onCreateRule: () => void;
  onMergeRooms: () => void;
  onSplitMergedRoom: (mergedRoomId: RoomId) => void;
}

function handleDisableTextChange(field: keyof DisableFormState, event: ChangeEvent<HTMLInputElement | HTMLSelectElement>, onChange: Dispatch<SetStateAction<DisableFormState>>): void {
  onChange((current) => ({ ...current, [field]: event.target.value }));
}

function handleRuleTextChange(field: keyof RuleFormState, event: ChangeEvent<HTMLInputElement | HTMLSelectElement>, onChange: Dispatch<SetStateAction<RuleFormState>>): void {
  onChange((current) => ({ ...current, [field]: event.target.value }));
}

export default function AdminPanel(props: AdminPanelProps) {
  const { rooms, mergedRooms, disableForm, onDisableFormChange, enableRoomId, onEnableRoomIdChange, ruleForm, onRuleFormChange, activeDynamicRoomIds, confirmedBookings, result, onDynamicDisable, onDynamicEnable, onCreateRule, onMergeRooms, onSplitMergedRoom } = props;
  const activeRooms = rooms.filter((room) => room.status === 'active');
  const mergeable = rooms.some((room) => room.id === 'meeting-room-1') && rooms.some((room) => room.id === 'meeting-room-2');
  const canSplit = mergedRooms.some((mergedRoom) => mergedRoom.id === 'meeting-room-1-2');

  return (
    <div className="panel-content">
      <div className="section-heading"><div><h2>管理员模式</h2><p>管理员操作会真实写入动态禁用、临时规则、合并会议室等状态。</p></div></div>
      <ConflictMessage result={result} />
      <section className="admin-section"><h3>动态禁用 / 启用房间</h3><div className="form-grid"><label><span>禁用房间</span><select value={disableForm.roomId} onChange={(event) => handleDisableTextChange('roomId', event, onDisableFormChange)}>{activeRooms.map((room) => <option key={room.id} value={room.id}>{room.name}</option>)}</select></label><label><span>禁用原因</span><input type="text" value={disableForm.reason} placeholder="例如：临时维修" onChange={(event) => handleDisableTextChange('reason', event, onDisableFormChange)} /></label><label><span>日期</span><input type="date" value={disableForm.date} onChange={(event) => handleDisableTextChange('date', event, onDisableFormChange)} /></label><label><span>开始时间</span><input type="time" value={disableForm.start} onChange={(event) => handleDisableTextChange('start', event, onDisableFormChange)} /></label><label><span>结束时间</span><input type="time" value={disableForm.end} onChange={(event) => handleDisableTextChange('end', event, onDisableFormChange)} /></label></div><button className="secondary-button danger" type="button" onClick={onDynamicDisable}>动态禁用房间</button><div className="form-grid two-columns compact"><label><span>启用房间</span><select value={enableRoomId} onChange={(event) => onEnableRoomIdChange(event.target.value)}>{activeRooms.map((room) => <option key={room.id} value={room.id}>{room.name}</option>)}</select></label><label className="align-end"><span>&nbsp;</span><button className="secondary-button" type="button" disabled={!enableRoomId} onClick={onDynamicEnable}>动态启用房间</button></label></div>{activeDynamicRoomIds.length > 0 ? <p className="hint-text">当前动态禁用房间：{activeDynamicRoomIds.map((roomId) => rooms.find((room) => room.id === roomId)?.name ?? roomId).join('、')}</p> : null}</section>
      <section className="admin-section"><h3>新增临时规则</h3><div className="form-grid"><label><span>适用房间</span><select value={ruleForm.roomId} onChange={(event) => handleRuleTextChange('roomId', event, onRuleFormChange)}>{activeRooms.map((room) => <option key={room.id} value={room.id}>{room.name}</option>)}</select></label><label><span>规则标题</span><input type="text" value={ruleForm.title} placeholder="例如：下午临时不可预约" onChange={(event) => handleRuleTextChange('title', event, onRuleFormChange)} /></label><label><span>日期</span><input type="date" value={ruleForm.date} onChange={(event) => handleRuleTextChange('date', event, onRuleFormChange)} /></label><label><span>开始时间</span><input type="time" value={ruleForm.start} onChange={(event) => handleRuleTextChange('start', event, onRuleFormChange)} /></label><label><span>结束时间</span><input type="time" value={ruleForm.end} onChange={(event) => handleRuleTextChange('end', event, onRuleFormChange)} /></label></div><button className="secondary-button" type="button" onClick={onCreateRule}>新增临时规则</button></section>
      <section className="admin-section"><h3>合并 / 拆分会议室一和会议室二</h3><p className="hint-text">合并后会写入 mergedRooms，并把源房间标记为 inactive；拆分后恢复源房间为 active。</p><div className="form-actions"><button className="secondary-button" type="button" disabled={!mergeable} onClick={onMergeRooms}>合并会议室一和二</button><button className="secondary-button" type="button" disabled={!canSplit} onClick={() => onSplitMergedRoom('meeting-room-1-2')}>拆分会议室一/二合并</button></div></section>
      <section className="admin-section"><h3>当前已确认预约</h3><p className="hint-text">共 {confirmedBookings.length} 条已确认预约。</p></section>
    </div>
  );
}
