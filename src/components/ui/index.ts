// ──────────────────────────────────────────────────────────────────────────
// shadcn-style UI kit, M3 (Material You) design language.
//
// Each primitive lives in this folder, owned by the project. Both individual
// named exports and (where present) namespaced object exports are provided
// for backwards compatibility.
// ──────────────────────────────────────────────────────────────────────────

// Button + IconButton
export { Button, buttonVariants } from './Button';
export type { ButtonProps } from './Button';

export { IconButton, iconButtonVariants } from './IconButton';
export type { IconButtonProps } from './IconButton';

// Card
export {
  Card,
  CardRoot,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardActions,
  cardVariants,
} from './Card';
export type { CardProps } from './Card';

// Dialog
export {
  Dialog,
  DialogTrigger,
  DialogClose,
  DialogPortal,
  DialogOverlay,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DialogBody,
  DialogFooter,
  DialogActions,
  DialogPrimitive,
} from './Dialog';

// Snackbar / Toaster
export {
  Snackbar,
  SnackbarProvider,
  SnackbarAction,
  Toaster,
  useSnackbar,
  snackbarVariants,
} from './Snackbar';
export type { SnackbarVariant, SnackbarActionProps } from './Snackbar';

// Switch
export { Switch } from './Switch';
export type { SwitchProps } from './Switch';

// Select
export {
  Select,
  SelectRoot,
  SelectGroup,
  SelectValue,
  SelectTrigger,
  SelectContent,
  SelectItem,
  SelectLabel,
  SelectSeparator,
} from './Select';
export type { SelectProps, SelectOption } from './Select';

// TextField + bare Input/Textarea/Label
export { TextField } from './TextField';
export type { TextFieldProps } from './TextField';

export { Input } from './Input';
export type { InputProps } from './Input';

export { Textarea } from './Textarea';
export type { TextareaProps } from './Textarea';

export { Label } from './Label';

// Navigation
export { NavigationRail, NavigationRailItem } from './NavigationRail';
export type { NavigationRailProps, NavItem } from './NavigationRail';

export { NavigationBar, NavigationBarItem } from './NavigationBar';
export type { NavigationBarProps } from './NavigationBar';

// Misc primitives
export { Separator } from './Separator';

export {
  Tooltip,
  TooltipProvider,
  TooltipRoot,
  TooltipTrigger,
  TooltipContent,
} from './Tooltip';

export { Tabs, TabsList, TabsTrigger, TabsContent } from './Tabs';

export { Checkbox } from './Checkbox';

export { RadioGroup, RadioGroupItem } from './RadioGroup';

export { Skeleton } from './Skeleton';
export type { SkeletonProps } from './Skeleton';

export { Badge, badgeVariants } from './Badge';
export type { BadgeProps } from './Badge';
