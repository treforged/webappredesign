import {
  Receipt, ShoppingCart, Fuel, UtensilsCrossed, Gamepad2,
  Repeat, Landmark, PiggyBank, TrendingUp, Car, Plane, MoreHorizontal
} from 'lucide-react';
import { cn } from '@/lib/utils';

const iconMap: Record<string, React.ElementType> = {
  Bills: Receipt,
  Groceries: ShoppingCart,
  Gas: Fuel,
  Dining: UtensilsCrossed,
  Entertainment: Gamepad2,
  Subscriptions: Repeat,
  'Debt Payments': Landmark,
  Savings: PiggyBank,
  Investing: TrendingUp,
  Car: Car,
  Travel: Plane,
  Other: MoreHorizontal,
};

type Props = {
  category: string;
  size?: number;
  className?: string;
};

export default function CategoryIcon({ category, size = 14, className }: Props) {
  const Icon = iconMap[category] || MoreHorizontal;
  return <Icon size={size} className={cn("text-muted-foreground", className)} />;
}
