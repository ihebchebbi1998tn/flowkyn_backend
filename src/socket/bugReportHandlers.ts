/**
 * Socket.io event handlers for Bug Reports / Ticketing System
 * 
 * Real-time updates for:
 * - New ticket submissions
 * - Ticket status changes
 * - Admin notifications
 */

import { AuthenticatedSocket } from './types';

/**
 * Setup bug report socket handlers
 */
export function setupBugReportHandlers(io: any) {
  // Admin namespace for real-time updates
  const adminNamespace = io.of('/admin');

  adminNamespace.on('connection', (socket: AuthenticatedSocket) => {
    // Join admin room to receive all ticket updates
    socket.join('tickets:admin');

    socket.on('disconnect', () => {
      // User left
    });
  });

  // Main namespace for user updates (when their ticket is updated)
  io.on('connection', (socket: AuthenticatedSocket) => {
    // Users join personal ticket room
    if (socket.user?.userId) {
      socket.join(`user:${socket.user.userId}:tickets`);
    }

    socket.on('disconnect', () => {
      // User left
    });
  });
}

/**
 * Emit event when new ticket is created
 */
export function emitBugReportCreated(io: any, ticket: any) {
  // Notify admins about new ticket
  io.of('/admin').to('tickets:admin').emit('ticket:created', {
    id: ticket.id,
    title: ticket.title,
    type: ticket.type,
    priority: ticket.priority,
    userName: ticket.user_name,
    userEmail: ticket.user_email,
    createdAt: ticket.created_at,
  });

  // Notify user that their ticket was created
  io.to(`user:${ticket.user_id}:tickets`).emit('ticket:created', {
    id: ticket.id,
    message: 'Your ticket has been created',
  });
}

/**
 * Emit event when ticket status is updated
 */
export function emitBugReportStatusChanged(io: any, ticketId: string, userId: string, newStatus: string, adminName?: string) {
  // Notify admins
  io.of('/admin').to('tickets:admin').emit('ticket:updated', {
    id: ticketId,
    field: 'status',
    newValue: newStatus,
    updatedAt: new Date().toISOString(),
  });

  // Notify user
  io.to(`user:${userId}:tickets`).emit('ticket:updated', {
    id: ticketId,
    field: 'status',
    newValue: newStatus,
    message: `Your ticket status has been updated to "${newStatus}"${adminName ? ` by ${adminName}` : ''}`,
    updatedAt: new Date().toISOString(),
  });
}

/**
 * Emit event when ticket is assigned
 */
export function emitBugReportAssigned(io: any, ticketId: string, userId: string, adminId: string, adminName: string) {
  // Notify admins
  io.of('/admin').to('tickets:admin').emit('ticket:assigned', {
    id: ticketId,
    assignedToId: adminId,
    assignedToName: adminName,
  });

  // Notify user
  io.to(`user:${userId}:tickets`).emit('ticket:assigned', {
    id: ticketId,
    assignedToName: adminName,
    message: `Your ticket has been assigned to ${adminName}`,
  });
}

/**
 * Emit event when resolution notes are added
 */
export function emitBugReportNotesAdded(io: any, ticketId: string, userId: string, notes: string) {
  // Notify admins  
  io.of('/admin').to('tickets:admin').emit('ticket:notes-added', {
    id: ticketId,
    notes,
  });

  // Notify user
  io.to(`user:${userId}:tickets`).emit('ticket:notes-added', {
    id: ticketId,
    notes,
    message: 'New notes have been added to your ticket',
  });
}

/**
 * Emit event when attachment is added
 */
export function emitAttachmentAdded(io: any, ticketId: string, fileName: string) {
  // Notify admins
  io.of('/admin').to('tickets:admin').emit('attachment:added', {
    id: ticketId,
    fileName,
  });
}

/**
 * Emit event for ticket stats update (e.g., critical count changed)
 */
export function emitTicketsStatsUpdated(io: any, stats: any) {
  io.of('/admin').to('tickets:admin').emit('tickets:stats-updated', stats);
}
