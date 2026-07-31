import type { Booking, DemoState } from '../types';

interface BookingListProps {
  bookings: Booking[];
  state: DemoState;
  onCancel: (bookingId: string) => void;
}

function roomName(state: DemoState, booking: Booking): string {
  const mergedRoom = state.mergedRooms.find((room) => room.id === booking.roomId);
  if (mergedRoom) {
    return mergedRoom.name;
  }

  if (booking.sourceRoomIds && booking.sourceRoomIds.length > 1) {
    return booking.sourceRoomIds.map((roomId) => state.rooms.find((room) => room.id === roomId)?.name ?? roomId).join(' + ');
  }

  return state.rooms.find((room) => room.id === booking.roomId)?.name ?? booking.roomId;
}

function bookingStatusLabel(status: Booking['status']): string {
  const labels: Record<Booking['status'], string> = {
    confirmed: '已确认',
    cancelled: '已取消',
    adjusted: '已调整',
    rejected: '已拒绝',
  };

  return labels[status];
}

export default function BookingList(props: BookingListProps) {
  const { bookings, state, onCancel } = props;
  const sortedBookings = [...bookings].sort((left, right) => right.createdAt.localeCompare(left.createdAt));

  return (
    <div className="panel-content">
      <div className="section-heading">
        <div>
          <h2>当前预约列表</h2>
          <p>取消预约会真实修改 booking.status，并写入 localStorage。</p>
        </div>
        <span className="count-badge">{bookings.length} 条</span>
      </div>

      {sortedBookings.length === 0 ? <p className="empty-text">暂无预约，可以先创建一条测试预约。</p> : null}

      <div className="result-list">
        {sortedBookings.map((booking) => (
          <article className={`result-item ${booking.status === 'confirmed' ? 'success' : 'muted'}`} key={booking.id}>
            <div>
              <div className="result-item-title-row">
                <strong>{booking.title}</strong>
                <span className={`status-pill ${booking.status === 'confirmed' ? 'active' : 'inactive'}`}>{bookingStatusLabel(booking.status)}</span>
              </div>
              <p>
                {roomName(state, booking)} · {booking.date} {booking.range.start}—{booking.range.end}
              </p>
              <p className="hint-text">组织者：{booking.organizer.name}</p>
              {booking.rejectionReason ? <p className="reason-text">取消原因：{booking.rejectionReason}</p> : null}
            </div>
            <button
              className="secondary-button danger"
              type="button"
              disabled={booking.status !== 'confirmed'}
              onClick={() => onCancel(booking.id)}
            >
              取消预约
            </button>
          </article>
        ))}
      </div>
    </div>
  );
}
