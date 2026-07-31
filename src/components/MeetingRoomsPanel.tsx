import type { Booking, DynamicDisablement, MergedRoom, Room, RoomId, UnavailabilityRule } from '../types';

interface MeetingRoomsPanelProps {
  rooms: Room[];
  mergedRooms: MergedRoom[];
  bookings: Booking[];
  dynamicDisables: DynamicDisablement[];
  rules: UnavailabilityRule[];
}

function statusLabel(status: Room['status']): string {
  return status === 'active' ? '可用' : '停用';
}

function roomNameById(rooms: Room[], roomId: RoomId): string {
  return rooms.find((room) => room.id === roomId)?.name ?? roomId;
}

function activeBookingCount(bookings: Booking[], roomId: RoomId): number {
  return bookings.filter((booking) => booking.status === 'confirmed' && (booking.roomId === roomId || booking.sourceRoomIds?.includes(roomId))).length;
}

function activeDisableReasons(dynamicDisables: DynamicDisablement[], roomId: RoomId): string[] {
  return dynamicDisables
    .filter((dynamic) => dynamic.active && dynamic.roomId === roomId)
    .map((dynamic) => `${dynamic.startDate}${dynamic.endDate && dynamic.endDate !== dynamic.startDate ? `—${dynamic.endDate}` : ''}：${dynamic.reason}`);
}

function activeRuleReasons(rules: UnavailabilityRule[], roomId: RoomId): string[] {
  return rules
    .filter((rule) => rule.active && rule.roomIds.includes(roomId))
    .map((rule) => `${rule.title}${rule.ranges.length > 0 ? `（${rule.ranges.map((range) => `${range.start}-${range.end}`).join('、')}）` : ''}`);
}

export default function MeetingRoomsPanel(props: MeetingRoomsPanelProps) {
  const { rooms, mergedRooms, bookings, dynamicDisables, rules } = props;

  return (
    <div className="panel-content">
      <div className="section-heading">
        <div>
          <h2>会议室列表</h2>
          <p>普通会议室与合并会议室均读取当前 demo state。</p>
        </div>
        <span className="count-badge">{rooms.length + mergedRooms.length} 个资源</span>
      </div>

      <div className="resource-grid">
        {rooms.map((room) => {
          const mergedRoomName = room.mergedRoomId ? roomNameById(rooms, room.mergedRoomId) : undefined;

          return (
            <article className={`resource-card ${room.status === 'active' ? 'active' : 'inactive'}`} key={room.id}>
              <div className="resource-card-header">
                <div>
                  <h3>{room.name}</h3>
                  <p>{room.location ?? '未标注位置'}</p>
                </div>
                <span className={`status-pill ${room.status}`}>{statusLabel(room.status)}</span>
              </div>
              <dl className="resource-meta">
                <div>
                  <dt>容量</dt>
                  <dd>{room.capacity ?? '未知'}</dd>
                </div>
                <div>
                  <dt>当前预约</dt>
                  <dd>{activeBookingCount(bookings, room.id)}</dd>
                </div>
              </dl>
              {room.equipment && room.equipment.length > 0 ? (
                <div className="chip-row">
                  {room.equipment.map((equipment) => (
                    <span className="chip" key={equipment}>{equipment}</span>
                  ))}
                </div>
              ) : null}
              {room.canMergeWith && room.canMergeWith.length > 0 ? (
                <p className="hint-text">可合并对象：{room.canMergeWith.map((roomId) => roomNameById(rooms, roomId)).join('、')}</p>
              ) : null}
              {mergedRoomName ? <p className="hint-text">已合并为：{mergedRoomName}</p> : null}
              {activeDisableReasons(dynamicDisables, room.id).length > 0 ? (
                <div className="reason-list">
                  <strong>动态禁用</strong>
                  <ul>
                    {activeDisableReasons(dynamicDisables, room.id).map((reason) => (
                      <li key={reason}>{reason}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {activeRuleReasons(rules, room.id).length > 0 ? (
                <div className="reason-list">
                  <strong>不可预约规则</strong>
                  <ul>
                    {activeRuleReasons(rules, room.id).map((reason) => (
                      <li key={reason}>{reason}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </article>
          );
        })}

        {mergedRooms.map((mergedRoom) => (
          <article className={`resource-card merged ${mergedRoom.status === 'active' ? 'active' : 'inactive'}`} key={mergedRoom.id}>
            <div className="resource-card-header">
              <div>
                <h3>{mergedRoom.name}</h3>
                <p>{mergedRoom.location ?? '未标注位置'}</p>
              </div>
              <span className={`status-pill ${mergedRoom.status}`}>{statusLabel(mergedRoom.status)}</span>
            </div>
            <dl className="resource-meta">
              <div>
                <dt>容量</dt>
                <dd>{mergedRoom.capacity ?? '未知'}</dd>
              </div>
              <div>
                <dt>当前预约</dt>
                <dd>{activeBookingCount(bookings, mergedRoom.id)}</dd>
              </div>
            </dl>
            <p className="hint-text">
              来源房间：{mergedRoom.sourceRoomIds.map((roomId) => roomNameById(rooms, roomId)).join(' + ')}
            </p>
            {mergedRoom.equipment && mergedRoom.equipment.length > 0 ? (
              <div className="chip-row">
                {mergedRoom.equipment.map((equipment) => (
                  <span className="chip" key={equipment}>{equipment}</span>
                ))}
              </div>
            ) : null}
          </article>
        ))}
      </div>
    </div>
  );
}
