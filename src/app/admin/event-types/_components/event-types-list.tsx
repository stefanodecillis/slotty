'use client';

import React, { useState, useCallback } from 'react';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Button } from '@/components/ui/Button';
import { Dialog, DialogPrimitive } from '@/components/ui/Dialog';
import { useSnackbar } from '@/components/ui/Snackbar';

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

export interface EventTypeRow {
  id: string;
  title: string;
  slug: string;
  durationMinutes: number;
  color: string;
  hidden: boolean;
  archived: boolean;
  destinationCalendar: { name: string } | null;
}

interface SortableItemProps {
  eventType: EventTypeRow;
  onDuplicate: (id: string) => void;
  onArchive: (id: string, archive: boolean) => void;
  onDelete: (id: string) => void;
}

interface EventTypesListProps {
  active: EventTypeRow[];
  archived: EventTypeRow[];
}

// ─────────────────────────────────────────────────────────────
// Sortable row
// ─────────────────────────────────────────────────────────────

function SortableItem({ eventType, onDuplicate, onArchive, onDelete }: SortableItemProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: eventType.id,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="flex items-center gap-4 rounded-shape-sm border border-outline-variant bg-surface p-4"
    >
      {/* Drag handle */}
      <button
        {...listeners}
        {...attributes}
        type="button"
        className="cursor-grab text-on-surface-variant hover:text-on-surface"
        aria-label="Drag to reorder"
      >
        <span className="material-symbols-outlined text-[20px]">drag_indicator</span>
      </button>

      {/* Color dot */}
      <div
        className="h-4 w-4 shrink-0 rounded-full"
        style={{ backgroundColor: eventType.color }}
      />

      {/* Info */}
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-2">
          <span className="text-body-l font-medium text-on-surface truncate">{eventType.title}</span>
          {eventType.hidden && (
            <span className="rounded bg-surface-container-high px-1.5 py-0.5 text-label-s text-on-surface-variant">
              Hidden
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 text-body-s text-on-surface-variant">
          <span>/{eventType.slug}</span>
          <span>&middot;</span>
          <span>{eventType.durationMinutes} min</span>
          {eventType.destinationCalendar && (
            <>
              <span>&middot;</span>
              <span>{eventType.destinationCalendar.name}</span>
            </>
          )}
        </div>
      </div>

      {/* Actions */}
      <div className="flex shrink-0 items-center gap-2">
        <a
          href={`/admin/event-types/${eventType.id}`}
          className="text-label-m text-primary hover:underline"
        >
          Edit
        </a>
        <button
          type="button"
          onClick={() => onDuplicate(eventType.id)}
          className="text-label-m text-on-surface-variant hover:text-on-surface"
        >
          Duplicate
        </button>
        <button
          type="button"
          onClick={() => onArchive(eventType.id, !eventType.archived)}
          className="text-label-m text-on-surface-variant hover:text-on-surface"
        >
          {eventType.archived ? 'Unarchive' : 'Archive'}
        </button>
        <DeleteButton eventType={eventType} onDelete={onDelete} />
      </div>
    </div>
  );
}

function DeleteButton({
  eventType,
  onDelete,
}: {
  eventType: EventTypeRow;
  onDelete: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-label-m text-error hover:underline"
      >
        Delete
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <Dialog.Content>
          <DialogPrimitive.Title className="text-headline-s text-on-surface mb-2">
            Delete event type?
          </DialogPrimitive.Title>
          <DialogPrimitive.Description className="text-body-m text-on-surface-variant mb-6">
            Permanently delete <strong>{eventType.title}</strong>? This cannot be undone.
          </DialogPrimitive.Description>
          <div className="flex justify-end gap-3">
            <Button variant="outlined" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="filled"
              onClick={() => {
                onDelete(eventType.id);
                setOpen(false);
              }}
              className="bg-error text-on-error"
            >
              Delete
            </Button>
          </div>
        </Dialog.Content>
      </Dialog>
    </>
  );
}

// ─────────────────────────────────────────────────────────────
// Main list
// ─────────────────────────────────────────────────────────────

export function EventTypesList({ active: initialActive, archived: initialArchived }: EventTypesListProps) {
  const { show } = useSnackbar();
  const [active, setActive] = useState(initialActive);
  const [archived, setArchived] = useState(initialArchived);
  const [showArchived, setShowArchived] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleDragEnd = useCallback(
    async (event: DragEndEvent) => {
      const { active: dragged, over } = event;
      if (!over || dragged.id === over.id) return;

      const oldIndex = active.findIndex((e) => e.id === dragged.id);
      const newIndex = active.findIndex((e) => e.id === over.id);
      if (oldIndex === -1 || newIndex === -1) return;

      const reordered = arrayMove(active, oldIndex, newIndex);
      setActive(reordered);

      try {
        const res = await fetch('/api/admin/event-types/reorder', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ids: reordered.map((e) => e.id) }),
        });
        if (!res.ok) throw new Error('Reorder failed');
      } catch {
        show({ message: 'Failed to save order' });
        setActive(initialActive);
      }
    },
    [active, initialActive, show],
  );

  const handleDuplicate = useCallback(
    async (id: string) => {
      try {
        const res = await fetch(`/api/admin/event-types/${id}/duplicate`, { method: 'POST' });
        if (!res.ok) throw new Error('Duplicate failed');
        show({ message: 'Event type duplicated' });
        window.location.reload();
      } catch {
        show({ message: 'Failed to duplicate event type' });
      }
    },
    [show],
  );

  const handleArchive = useCallback(
    async (id: string, archive: boolean) => {
      try {
        const res = await fetch(`/api/admin/event-types/${id}/archive`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ archived: archive }),
        });
        if (!res.ok) throw new Error('Archive failed');
        show({ message: archive ? 'Event type archived' : 'Event type restored' });

        if (archive) {
          const item = active.find((e) => e.id === id);
          if (item) {
            setActive((prev) => prev.filter((e) => e.id !== id));
            setArchived((prev) => [{ ...item, archived: true }, ...prev]);
          }
        } else {
          const item = archived.find((e) => e.id === id);
          if (item) {
            setArchived((prev) => prev.filter((e) => e.id !== id));
            setActive((prev) => [{ ...item, archived: false }, ...prev]);
          }
        }
      } catch {
        show({ message: 'Failed to update event type' });
      }
    },
    [active, archived, show],
  );

  const handleDelete = useCallback(
    async (id: string) => {
      try {
        const res = await fetch(`/api/admin/event-types/${id}`, { method: 'DELETE' });
        if (!res.ok) throw new Error('Delete failed');
        show({ message: 'Event type deleted' });
        setActive((prev) => prev.filter((e) => e.id !== id));
        setArchived((prev) => prev.filter((e) => e.id !== id));
      } catch {
        show({ message: 'Failed to delete event type' });
      }
    },
    [show],
  );

  return (
    <div className="flex flex-col gap-4">
      {/* Active list */}
      {active.length === 0 ? null : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={active.map((e) => e.id)} strategy={verticalListSortingStrategy}>
            <div className="flex flex-col gap-2">
              {active.map((eventType) => (
                <SortableItem
                  key={eventType.id}
                  eventType={eventType}
                  onDuplicate={handleDuplicate}
                  onArchive={handleArchive}
                  onDelete={handleDelete}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}

      {/* Archived section */}
      {archived.length > 0 && (
        <div className="flex flex-col gap-2">
          <button
            type="button"
            onClick={() => setShowArchived((v) => !v)}
            className="flex items-center gap-2 text-label-m text-on-surface-variant hover:text-on-surface"
          >
            <span className="material-symbols-outlined text-[18px]">
              {showArchived ? 'expand_less' : 'expand_more'}
            </span>
            {archived.length} archived
          </button>

          {showArchived && (
            <div className="flex flex-col gap-2 opacity-60">
              {archived.map((eventType) => (
                <SortableItem
                  key={eventType.id}
                  eventType={eventType}
                  onDuplicate={handleDuplicate}
                  onArchive={handleArchive}
                  onDelete={handleDelete}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
