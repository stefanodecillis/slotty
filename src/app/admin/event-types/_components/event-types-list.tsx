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
  draggable: boolean;
  isFirst: boolean;
}

interface EventTypesListProps {
  active: EventTypeRow[];
  archived: EventTypeRow[];
}

// ─────────────────────────────────────────────────────────────
// Sortable row
// ─────────────────────────────────────────────────────────────

function SortableItem({ eventType, onDuplicate, onArchive, onDelete, draggable, isFirst }: SortableItemProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: eventType.id,
    disabled: !draggable,
  });
  const [menuOpen, setMenuOpen] = useState(false);

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  // The outer container has `overflow-hidden rounded-shape-md` so per-row
  // rounded corners are unnecessary AND can show through as visual artifacts
  // (nested-card look) when the hover background paints inside the row.
  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`flex items-center gap-3 px-4 py-4 transition-colors hover:bg-surface-container-low ${
        isFirst ? '' : 'border-t border-outline-variant'
      }`}
    >
      {/* Drag handle */}
      {draggable ? (
        <button
          {...listeners}
          {...attributes}
          type="button"
          className="cursor-grab text-on-surface-variant transition-colors hover:text-on-surface"
          aria-label="Drag to reorder"
        >
          <span className="material-symbols-outlined text-[20px]">drag_indicator</span>
        </button>
      ) : (
        <span className="w-5" aria-hidden="true" />
      )}

      {/* Color dot */}
      <span
        className="h-3 w-3 shrink-0 rounded-full"
        style={{ backgroundColor: eventType.color }}
        aria-hidden="true"
      />

      {/* Info */}
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-2">
          <a
            href={`/admin/event-types/${eventType.id}`}
            className="truncate text-title-m text-on-surface hover:underline"
          >
            {eventType.title}
          </a>
          {eventType.hidden && (
            <span className="rounded-full bg-surface-container-high px-2 py-0.5 text-label-s text-on-surface-variant">
              Hidden
            </span>
          )}
          {eventType.archived && (
            <span className="rounded-full bg-surface-container-high px-2 py-0.5 text-label-s text-on-surface-variant">
              Archived
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 text-body-s text-on-surface-variant">
          <span className="truncate">/{eventType.slug}</span>
          <span aria-hidden="true">·</span>
          <span>{eventType.durationMinutes} min</span>
          {eventType.destinationCalendar && (
            <span className="truncate hidden items-center gap-2 sm:inline-flex">
              <span aria-hidden="true">·</span>
              {eventType.destinationCalendar.name}
            </span>
          )}
        </div>
      </div>

      {/* Actions */}
      <div className="flex shrink-0 items-center gap-1">
        <a
          href={`/admin/event-types/${eventType.id}`}
          className="hidden rounded-full px-3 py-1.5 text-label-l text-primary transition-colors hover:bg-primary/[0.08] sm:inline-block"
        >
          Edit
        </a>
        <ActionMenu
          open={menuOpen}
          onOpenChange={setMenuOpen}
          eventType={eventType}
          onDuplicate={() => {
            setMenuOpen(false);
            onDuplicate(eventType.id);
          }}
          onArchive={() => {
            setMenuOpen(false);
            onArchive(eventType.id, !eventType.archived);
          }}
          onDelete={() => onDelete(eventType.id)}
        />
      </div>
    </div>
  );
}

interface ActionMenuProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  eventType: EventTypeRow;
  onDuplicate: () => void;
  onArchive: () => void;
  onDelete: () => void;
}

function ActionMenu({ open, onOpenChange, eventType, onDuplicate, onArchive, onDelete }: ActionMenuProps) {
  const [confirmOpen, setConfirmOpen] = useState(false);

  return (
    <div className="relative">
      <button
        type="button"
        aria-label="Actions"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => onOpenChange(!open)}
        className="flex h-9 w-9 items-center justify-center rounded-full text-on-surface-variant transition-colors hover:bg-on-surface-variant/[0.08]"
      >
        <span className="material-symbols-outlined text-[20px]">more_vert</span>
      </button>

      {open && (
        <>
          {/* Backdrop to close on outside click */}
          <button
            type="button"
            className="fixed inset-0 z-20 cursor-default"
            aria-hidden="true"
            tabIndex={-1}
            onClick={() => onOpenChange(false)}
          />
          <div
            role="menu"
            className="absolute right-0 top-full z-30 mt-1 w-48 overflow-hidden rounded-shape-md border border-outline-variant bg-surface shadow-lg"
          >
            <a
              href={`/admin/event-types/${eventType.id}`}
              className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-body-m text-on-surface transition-colors hover:bg-surface-container-low sm:hidden"
              role="menuitem"
            >
              <span className="material-symbols-outlined text-[18px]">edit</span>
              Edit
            </a>
            <button
              type="button"
              role="menuitem"
              onClick={onDuplicate}
              className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-body-m text-on-surface transition-colors hover:bg-surface-container-low"
            >
              <span className="material-symbols-outlined text-[18px]">content_copy</span>
              Duplicate
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={onArchive}
              className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-body-m text-on-surface transition-colors hover:bg-surface-container-low"
            >
              <span className="material-symbols-outlined text-[18px]">
                {eventType.archived ? 'unarchive' : 'archive'}
              </span>
              {eventType.archived ? 'Unarchive' : 'Archive'}
            </button>
            <div className="border-t border-outline-variant" />
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                onOpenChange(false);
                setConfirmOpen(true);
              }}
              className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-body-m text-error transition-colors hover:bg-error/[0.08]"
            >
              <span className="material-symbols-outlined text-[18px]">delete</span>
              Delete
            </button>
          </div>
        </>
      )}

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <Dialog.Content>
          <DialogPrimitive.Title className="text-title-l text-on-surface mb-2">
            Delete event type?
          </DialogPrimitive.Title>
          <DialogPrimitive.Description className="text-body-m text-on-surface-variant mb-6">
            Permanently delete <strong>{eventType.title}</strong>? This cannot be undone.
          </DialogPrimitive.Description>
          <div className="flex justify-end gap-3">
            <Button variant="text" onClick={() => setConfirmOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="filled"
              onClick={() => {
                onDelete();
                setConfirmOpen(false);
              }}
              className="bg-error text-on-error hover:bg-error/90"
            >
              Delete
            </Button>
          </div>
        </Dialog.Content>
      </Dialog>
    </div>
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
    <div className="flex flex-col gap-8">
      {/* Active list */}
      {active.length > 0 && (
        <section>
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={active.map((e) => e.id)} strategy={verticalListSortingStrategy}>
              <div className="overflow-hidden rounded-shape-md border border-outline-variant bg-surface">
                {active.map((eventType, idx) => (
                  <SortableItem
                    key={eventType.id}
                    eventType={eventType}
                    onDuplicate={handleDuplicate}
                    onArchive={handleArchive}
                    onDelete={handleDelete}
                    draggable={active.length > 1}
                    isFirst={idx === 0}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        </section>
      )}

      {/* Archived section */}
      {archived.length > 0 && (
        <section>
          <button
            type="button"
            onClick={() => setShowArchived((v) => !v)}
            aria-expanded={showArchived}
            className="mb-3 flex items-center gap-2 text-label-l text-on-surface-variant transition-colors hover:text-on-surface"
          >
            <span className="material-symbols-outlined text-[18px]">
              {showArchived ? 'expand_more' : 'chevron_right'}
            </span>
            {archived.length} archived
          </button>

          {showArchived && (
            <div className="overflow-hidden rounded-shape-md border border-outline-variant bg-surface opacity-70">
              {archived.map((eventType, idx) => (
                <SortableItem
                  key={eventType.id}
                  eventType={eventType}
                  onDuplicate={handleDuplicate}
                  onArchive={handleArchive}
                  onDelete={handleDelete}
                  draggable={false}
                  isFirst={idx === 0}
                />
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
