import { useEffect, useRef } from 'react';
import { io } from 'socket.io-client';

export function useSocket(onNewOrder, onBotStatus, onUserModeChange) {
  const socketRef = useRef(null);

  useEffect(() => {
    const socket = io(window.location.origin, {
      transports: ['websocket', 'polling'],
    });
    socketRef.current = socket;

    socket.on('new_order', (order) => {
      if (onNewOrder) onNewOrder(order);
    });

    socket.on('bot_status', (data) => {
      if (onBotStatus) onBotStatus(data.status);
    });

    socket.on('user_mode_changed', (data) => {
      if (onUserModeChange) onUserModeChange(data);
    });

    return () => {
      socket.disconnect();
    };
  }, []);

  return socketRef;
}
