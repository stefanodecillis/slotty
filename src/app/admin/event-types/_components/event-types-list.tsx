'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
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
import { MoreVertical, Pencil, Copy, Archive, ArchiveRestore, Trash2, GripVertical, ChevronRight, ChevronDown } from 'lucide-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogHeader,
} from '@/components/ui/dialog';
import { toast } from 'sonner';
import {
  archiveEventType,
  deleteEventType,
  duplicateEventType,
  eventTypeKeys,
  reorderEventTypes,
} from '@/lib/api/event-types';

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
  const [confirmOpen, setConfirmOpen] = useState(false);

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`flex items-center gap-3 px-4 py-4 transition-colors hover:bg-muted/50 ${
        isFirst ? '' : 'border-t border-border'
      }`}
    >
      {/* Drag handle */}
      {draggable ? (
        <button
          {...listeners}
          {...attributes}
          type="button"
          className="cursor-grab text-muted-foreground transition-colors hover:text-foreground"
          aria-label="Drag to reorder"
        >
          <GripVertical className="h-5 w-5" />
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
            className="truncate text-base font-medium text-foreground hover:underline"
          >
            {eventType.title}
          </a>
          {eventType.hidden && (
            <span className="rounded-full bg-card px-2 py-0.5 text-xs text-muted-foreground">
              Hidden
            </span>
          )}
          {eventType.archived && (
            <span className="rounded-full bg-card px-2 py-0.5 text-xs text-muted-foreground">
              Archived
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
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
          className="hidden rounded-full px-3 py-1.5 text-sm font-medium text-primary transition-colors hover:bg-primary/[0.08] sm:inline-block"
        >
          Edit
        </a>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" aria-label="Actions">
              <MoreVertical className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuItem asChild className="sm:hidden">
              <Link href={`/admin/event-types/${eventType.id}`}>
                <Pencil className="mr-2 h-4 w-4" /> Edit
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onDuplicate(eventType.id)}>
              <Copy className="mr-2 h-4 w-4" /> Duplicate
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onArchive(eventType.id, !eventType.archived)}>
              {eventType.archived ? (
                <ArchiveRestore className="mr-2 h-4 w-4" />
              ) : (
                <Archive className="mr-2 h-4 w-4" />
              )}
              {eventType.archived ? 'Unarchive' : 'Archive'}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={(e) => {
                e.preventDefault();
                setConfirmOpen(true);
              }}
              className="text-destructive focus:text-destructive"
            >
              <Trash2 className="mr-2 h-4 w-4" /> Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Delete event type?</DialogTitle>
              <DialogDescription>
                Permanently delete <strong>{eventType.title}</strong>? This cannot be undone.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setConfirmOpen(false)}>
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={() => {
                  onDelete(eventType.id);
                  setConfirmOpen(false);
                }}
              >
                Delete
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Main list
// ─────────────────────────────────────────────────────────────

export function EventTypesList({ active: initialActive, archived: initialArchived }: EventTypesListProps) {
  const queryClient = useQueryClient();

  // Local state mirrors the props so we can do optimistic UI for reorder + archive.
  // Server-Component-rendered props are the source of truth on full page reloads;
  // mutations invalidate the eventTypes cache to trigger any on-page client queries.
  const [active, setActive] = useState(initialActive);
  const [archived, setArchived] = useState(initialArchived);
  const [showArchived, setShowArchived] = useState(false);

  // Keep local state in sync with new server props (e.g. after router.refresh()).
  useEffect(() => {
    setActive(initialActive);
  }, [initialActive]);
  useEffect(() => {
    setArchived(initialArchived);
  }, [initialArchived]);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const reorderMutation = useMutation({
    mutationFn: (vars: { ids: string[]; previous: EventTypeRow[] }) =>
      reorderEventTypes(vars.ids),
    onError: (_err, vars) => {
      toast.error('Failed to save order');
      setActive(vars.previous);
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: eventTypeKeys.all });
    },
  });

  const duplicateMutation = useMutation({
    mutationFn: (id: string) => duplicateEventType(id),
    onSuccess: () => {
      toast.success('Event type duplicated');
      void queryClient.invalidateQueries({ queryKey: eventTypeKeys.all });
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : 'Failed to duplicate event type');
    },
  });

  const archiveMutation = useMutation({
    mutationFn: ({ id, archived: nextArchived }: { id: string; archived: boolean }) =>
      archiveEventType(id, nextArchived),
    onSuccess: (_data, vars) => {
      toast.success(vars.archived ? 'Event type archived' : 'Event type restored');
      if (vars.archived) {
        const item = active.find((e) => e.id === vars.id);
        if (item) {
          setActive((prev) => prev.filter((e) => e.id !== vars.id));
          setArchived((prev) => [{ ...item, archived: true }, ...prev]);
        }
      } else {
        const item = archived.find((e) => e.id === vars.id);
        if (item) {
          setArchived((prev) => prev.filter((e) => e.id !== vars.id));
          setActive((prev) => [{ ...item, archived: false }, ...prev]);
        }
      }
      void queryClient.invalidateQueries({ queryKey: eventTypeKeys.all });
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : 'Failed to update event type');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteEventType(id),
    onSuccess: (_data, id) => {
      toast.success('Event type deleted');
      setActive((prev) => prev.filter((e) => e.id !== id));
      setArchived((prev) => prev.filter((e) => e.id !== id));
      void queryClient.invalidateQueries({ queryKey: eventTypeKeys.all });
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : 'Failed to delete event type');
    },
  });

  const handleDragEnd = (event: DragEndEvent) => {
    const { active: dragged, over } = event;
    if (!over || dragged.id === over.id) return;

    const oldIndex = active.findIndex((e) => e.id === dragged.id);
    const newIndex = active.findIndex((e) => e.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;

    const previous = active;
    const reordered = arrayMove(active, oldIndex, newIndex);
    setActive(reordered);
    reorderMutation.mutate({ ids: reordered.map((e) => e.id), previous });
  };

  const handleDuplicate = (id: string) => duplicateMutation.mutate(id);
  const handleArchive = (id: string, archive: boolean) =>
    archiveMutation.mutate({ id, archived: archive });
  const handleDelete = (id: string) => deleteMutation.mutate(id);

  return (
    <div className="flex flex-col gap-8">
      {/* Active list */}
      {active.length > 0 && (
        <section>
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={active.map((e) => e.id)} strategy={verticalListSortingStrategy}>
              <div className="overflow-hidden rounded-lg border border-border bg-card">
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
            className="mb-3 flex items-center gap-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            {showArchived ? (
              <ChevronDown className="h-4 w-4" />
            ) : (
              <ChevronRight className="h-4 w-4" />
            )}
            {archived.length} archived
          </button>

          {showArchived && (
            <div className="overflow-hidden rounded-lg border border-border bg-card opacity-70">
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
