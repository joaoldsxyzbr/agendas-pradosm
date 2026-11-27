import type { ButtonHTMLAttributes } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

// Componente de propriedade do projeto, seguindo o padrao shadcn/ui.
const variants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-[5px] text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#90c8df] disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        default: "border border-[#90c8df] bg-[#90c8df] text-[#101a23] hover:bg-[#b2d9e8]",
        secondary: "border border-[#526777] bg-[#223443] text-slate-100 hover:bg-[#2c4254]",
        ghost: "text-slate-300 hover:bg-[#223443]",
        danger: "border border-rose-500/50 bg-rose-600/15 text-rose-200 hover:bg-rose-600/25",
      },
      size: {
        default: "h-9 px-3",
        sm: "h-8 px-2.5",
        icon: "size-9",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

type Props = ButtonHTMLAttributes<HTMLButtonElement> & VariantProps<typeof variants>;

export function Button({ className, variant, size, type = "button", ...props }: Props) {
  return <button type={type} className={cn(variants({ variant, size }), className)} {...props} />;
}
